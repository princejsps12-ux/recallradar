import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIDENCE,
  RULES,
  MIN_MODEL_LENGTH,
  MIN_LOT_LENGTH,
  MIN_MODEL_LENGTH_OTHER_MAKER,
  makerWords,
  manufacturersMatch,
  modelInRecall,
  lotInRecall,
  recallCoversAllUnits,
  typeInRecall,
  evaluateMatch,
  matchDeviceToRecall,
  matchDevicesToRecalls,
} from './matching.js';

// --- Fixtures, shaped like real recalls --------------------------------------------------

const plumRecall = {
  recallNumber: 'Z-2723-2026',
  recallClass: 'II',
  date: '2026-07-22',
  firm: 'ICU Medical, Inc.',
  product: 'ICU Medical Plum Duo Infusion Pump',
  productText: 'ICU Medical Plum Duo Infusion Pump, v1.2.3: 1) Item Number 400020401 and 2) Item Number 400020403; infusion pump',
  codeText: '1) UDI/DI +M335400021, Serial Numbers: 50003704, 50003710, 50004046, 50004072',
};

const novumRecall = {
  recallNumber: 'Z-3065-2026',
  recallClass: 'II',
  date: '2026-09-09',
  firm: 'Baxter Healthcare Corporation',
  product: 'Baxter Novum IQ Syringe Pump',
  productText: 'Baxter Novum IQ Syringe Pump, Model Number 40800BAXUS',
  codeText: 'UDI-DI 05413765852428, all serial numbers',
};

const servoRecall = {
  recallNumber: 'Z-2963-2026',
  recallClass: 'II',
  date: '2026-08-26',
  firm: 'Maquet Critical Care AB',
  product: 'GETINGE Y SENSOR Module',
  productText: 'GETINGE Y SENSOR Module, SERVO-U, SERVO-N, Model Number 6693662; part of the ventilator system',
  codeText: 'DUI/DI 07325710000304, Serial/Lot Numbers: 21049, 21088, 21089',
};

const serialOnlyRecall = {
  recallNumber: 'Z-9000-2026',
  recallClass: 'I',
  date: '2026-10-01',
  firm: 'Acme Medical, Inc.',
  product: 'Acme infusion pump',
  productText: 'Acme infusion pump',
  codeText: 'Serial Numbers: ACM-77120 ACM-77121',
};

const plumDevice = {
  id: 'd1',
  name: 'Plum Duo pump',
  type: 'infusion pump',
  manufacturer: 'ICU Medical',
  model: '400020401',
  lotOrSerial: '50003704',
  ward: 'ICU',
};

// --- Fact 1: manufacturer ------------------------------------------------------------------

test('makerWords drops legal suffixes but keeps the identifying words', () => {
  assert.deepEqual(makerWords('Baxter Healthcare Corporation'), ['baxter', 'healthcare']);
  assert.deepEqual(makerWords('Datex-Ohmeda, Inc.'), ['datex', 'ohmeda']);
  assert.deepEqual(makerWords('Maquet Critical Care AB'), ['maquet', 'critical', 'care']);
  assert.deepEqual(makerWords(undefined), []);
});

test('manufacturersMatch ignores case, punctuation and legal suffixes', () => {
  assert.equal(manufacturersMatch('ICU Medical', 'ICU Medical, Inc.'), true);
  assert.equal(manufacturersMatch('datex-ohmeda', 'Datex-Ohmeda Inc'), true);
  assert.equal(manufacturersMatch('Baxter Healthcare', 'Baxter Healthcare Corporation'), true);
});

test('manufacturersMatch accepts a short name contained in a longer one, both ways', () => {
  assert.equal(manufacturersMatch('Philips', 'Philips North America Llc'), true);
  assert.equal(manufacturersMatch('Philips North America Llc', 'Philips'), true);
  assert.equal(manufacturersMatch('Mindray', 'Mindray DS USA, Inc.'), true);
});

test('manufacturersMatch rejects different makers', () => {
  assert.equal(manufacturersMatch('Getinge', 'Philips Respironics'), false);
  assert.equal(manufacturersMatch('Baxter Healthcare', 'ICU Medical, Inc.'), false);
});

test('manufacturersMatch will not match on generic words alone', () => {
  assert.equal(manufacturersMatch('Medical Systems', 'GE Medical Systems Information Technologies'), false);
  assert.equal(manufacturersMatch('Healthcare', 'Baxter Healthcare Corporation'), false);
});

test('manufacturersMatch is false when a name is missing or only a suffix', () => {
  assert.equal(manufacturersMatch('', 'ICU Medical'), false);
  assert.equal(manufacturersMatch('ICU Medical', undefined), false);
  assert.equal(manufacturersMatch('Inc.', 'Inc.'), false);
});

// --- Fact 2: model ---------------------------------------------------------------------------

test('modelInRecall finds a model in the product text', () => {
  assert.equal(modelInRecall('400020401', plumRecall), true);
});

test('modelInRecall finds a model in the code text', () => {
  const recall = { productText: 'Midmark IQvitals Zone', codeText: 'Model No: 1-200-0330; UDI-DI: 0084' };
  assert.equal(modelInRecall('1-200-0330', recall), true);
});

test('modelInRecall ignores punctuation differences', () => {
  const recall = { productText: 'MiniMed 780G Insulin Pump, Model: MMT-1885CLW', codeText: 'MMT-1885CLW/00763000442187' };
  assert.equal(modelInRecall('MMT 1885CLW', recall), true);
});

test('modelInRecall matches whole words only', () => {
  const recall = { productText: 'Monitor N150', codeText: '' };
  assert.equal(modelInRecall('N15', recall), false);
});

test('modelInRecall matches a model inside a list of models', () => {
  const recall = { productText: 'Patient Monitor: N12/N15/N17/N19/N22', codeText: '' };
  assert.equal(modelInRecall('N15', recall), true);
});

test('modelInRecall rejects models shorter than the minimum length', () => {
  const recall = { productText: 'Pump A1 and 10', codeText: '' };
  assert.equal(MIN_MODEL_LENGTH, 3);
  assert.equal(modelInRecall('A1', recall), false);
  assert.equal(modelInRecall('10', recall), false);
});

test('modelInRecall honours a stricter minimum length', () => {
  const recall = { productText: 'Monitor N15', codeText: '' };
  assert.equal(modelInRecall('N15', recall, MIN_MODEL_LENGTH_OTHER_MAKER), false);
});

test('modelInRecall is false for an empty model or empty recall', () => {
  assert.equal(modelInRecall('', plumRecall), false);
  assert.equal(modelInRecall('400020401', {}), false);
});

// --- Fact 3: lot / serial --------------------------------------------------------------------

test('lotInRecall finds a serial in the code text', () => {
  assert.equal(lotInRecall('50004072', plumRecall), true);
});

test('lotInRecall does not look in the product text', () => {
  assert.equal(lotInRecall('400020401', plumRecall), false);
});

test('lotInRecall matches whole identifiers only', () => {
  assert.equal(lotInRecall('5000', plumRecall), false);
  assert.equal(lotInRecall('50003', plumRecall), false);
});

test('lotInRecall ignores punctuation inside the identifier', () => {
  assert.equal(lotInRecall('ACM 77120', serialOnlyRecall), true);
  assert.equal(lotInRecall('acm-77120', serialOnlyRecall), true);
});

test('lotInRecall rejects identifiers shorter than the minimum length and empty ones', () => {
  const recall = { codeText: 'Lots 12 AB7 1234' };
  assert.equal(MIN_LOT_LENGTH, 4);
  assert.equal(lotInRecall('12', recall), false);
  assert.equal(lotInRecall('AB7', recall), false);
  assert.equal(lotInRecall('1234', recall), true);
  assert.equal(lotInRecall('', recall), false);
  assert.equal(lotInRecall(undefined, recall), false);
});

test('recallCoversAllUnits recognises each "all units" phrase', () => {
  for (const text of [
    'UDI-DI 0541, all serial numbers',
    'All Model No; All UDI; All Serial No.',
    'Lot Numbers: All unexpired',
    'Every lot: ALL LOT NUMBERS affected',
    'All units distributed',
  ]) {
    assert.equal(recallCoversAllUnits({ codeText: text }), true, text);
  }
});

test('recallCoversAllUnits is false for ordinary lists and missing text', () => {
  assert.equal(recallCoversAllUnits({ codeText: 'Serial Numbers: 1, 2, 3' }), false);
  assert.equal(recallCoversAllUnits({ codeText: 'overall serial range' }), false);
  assert.equal(recallCoversAllUnits({}), false);
});

// --- Device type (used by the weakest rule) ---------------------------------------------------

test('typeInRecall needs every word of the type in the product text', () => {
  assert.equal(typeInRecall('infusion pump', plumRecall), true);
  assert.equal(typeInRecall('infusion pump', novumRecall), false);
  assert.equal(typeInRecall('syringe pump', novumRecall), true);
});

test('typeInRecall is false for an empty type', () => {
  assert.equal(typeInRecall('', plumRecall), false);
  assert.equal(typeInRecall(undefined, plumRecall), false);
});

// --- The six rules ----------------------------------------------------------------------------

test('RULE exact-manufacturer-model-lot: maker, model and listed serial', () => {
  const match = evaluateMatch(plumDevice, plumRecall);
  assert.equal(match.confidence, CONFIDENCE.EXACT);
  assert.equal(match.rule, RULES.EXACT_MODEL_AND_LOT);
  assert.match(match.reason, /50003704/);
  assert.match(match.reason, /400020401/);
});

test('RULE exact-manufacturer-model-all: maker and model, recall covers every unit', () => {
  const device = { ...plumDevice, manufacturer: 'Baxter Healthcare', model: '40800BAXUS', lotOrSerial: 'BX-20431' };
  const match = evaluateMatch(device, novumRecall);
  assert.equal(match.confidence, CONFIDENCE.EXACT);
  assert.equal(match.rule, RULES.EXACT_MODEL_ALL_UNITS);
  assert.match(match.reason, /all serial\/lot numbers/);
});

test('RULE exact-manufacturer-model-all also applies when the device has no serial recorded', () => {
  const device = { ...plumDevice, manufacturer: 'Baxter Healthcare', model: '40800BAXUS', lotOrSerial: '' };
  assert.equal(evaluateMatch(device, novumRecall).rule, RULES.EXACT_MODEL_ALL_UNITS);
});

test('RULE likely-manufacturer-model: serial not listed in the recall', () => {
  const match = evaluateMatch({ ...plumDevice, lotOrSerial: 'ICU-PD-7731' }, plumRecall);
  assert.equal(match.confidence, CONFIDENCE.LIKELY);
  assert.equal(match.rule, RULES.LIKELY_MODEL);
  assert.match(match.reason, /ICU-PD-7731/);
  assert.match(match.reason, /not among the numbers listed/);
});

test('RULE likely-manufacturer-model: device with no serial recorded says so', () => {
  const match = evaluateMatch({ ...plumDevice, lotOrSerial: '' }, plumRecall);
  assert.equal(match.rule, RULES.LIKELY_MODEL);
  assert.match(match.reason, /no serial\/lot recorded/);
});

test('RULE likely-manufacturer-lot: maker and serial listed, model not mentioned', () => {
  const device = { id: 'd2', name: 'Acme pump', type: 'infusion pump', manufacturer: 'Acme Medical', model: 'ZX-900', lotOrSerial: 'ACM-77120' };
  const match = evaluateMatch(device, serialOnlyRecall);
  assert.equal(match.confidence, CONFIDENCE.LIKELY);
  assert.equal(match.rule, RULES.LIKELY_LOT);
  assert.match(match.reason, /ACM-77120/);
  assert.match(match.reason, /ZX-900/);
});

test('RULE possible-model-other-maker: distinctive model from a different firm (a distributor or relabelled product)', () => {
  const device = { id: 'd3', name: 'SERVO-U', type: 'ventilator', manufacturer: 'Acme Surgical Supply', model: '6693662', lotOrSerial: '21500' };
  const match = evaluateMatch(device, servoRecall);
  assert.equal(match.confidence, CONFIDENCE.POSSIBLE);
  assert.equal(match.rule, RULES.POSSIBLE_MODEL_OTHER_MAKER);
  assert.match(match.reason, /Maquet Critical Care AB/);
  assert.match(match.reason, /Acme Surgical Supply/);
});

test('RULE possible-model-other-maker needs a distinctive (long enough) model', () => {
  const recall = { ...servoRecall, productText: 'Monitor N15', codeText: '' };
  const device = { id: 'd3', name: 'Monitor', type: 'monitor', manufacturer: 'Acme Surgical Supply', model: 'N15', lotOrSerial: '' };
  assert.equal(evaluateMatch(device, recall), null);
});

test('RULE possible-manufacturer-type: same maker and kind of device, model not mentioned', () => {
  const device = { ...plumDevice, model: '40002-9999', lotOrSerial: '' };
  const match = evaluateMatch(device, plumRecall);
  assert.equal(match.confidence, CONFIDENCE.POSSIBLE);
  assert.equal(match.rule, RULES.POSSIBLE_TYPE);
  assert.match(match.reason, /infusion pump/);
});

// --- Cases that must NOT match ------------------------------------------------------------------

test('no match when only the model matches but the maker differs and the model is short', () => {
  const recall = { ...plumRecall, firm: 'Other Co', productText: 'Pump 400', codeText: '' };
  const device = { ...plumDevice, manufacturer: 'ICU Medical', model: '400', lotOrSerial: '' };
  assert.equal(evaluateMatch({ ...device, manufacturer: 'Someone Else' }, recall), null);
});

test('no match when the maker matches but the device is a different kind of device', () => {
  const device = { ...plumDevice, type: 'hospital bed', model: 'XB-12345', lotOrSerial: '' };
  assert.equal(evaluateMatch(device, plumRecall), null);
});

test('no match when nothing lines up', () => {
  const device = { id: 'd9', name: 'Bed', type: 'hospital bed', manufacturer: 'Hillrom', model: 'P7900', lotOrSerial: 'CB-1204' };
  assert.equal(evaluateMatch(device, plumRecall), null);
});

test('same serial from a different maker is not a match', () => {
  const device = { ...plumDevice, manufacturer: 'Baxter Healthcare', model: 'ZZ-0001', type: 'pump' };
  assert.equal(evaluateMatch(device, plumRecall), null);
});

test('a serial found by chance in another maker\'s recall does not count', () => {
  const device = { id: 'd5', name: 'X', type: 'pump', manufacturer: 'Zeta Corp', model: 'QQ-1000', lotOrSerial: '50003704' };
  assert.equal(evaluateMatch(device, plumRecall), null);
});

// --- Strongest rule wins ----------------------------------------------------------------------------

test('the strongest applicable rule is reported (exact beats likely beats possible)', () => {
  // This device also satisfies the weaker "same maker and type" rule; exact must win.
  const match = evaluateMatch(plumDevice, plumRecall);
  assert.equal(match.rule, RULES.EXACT_MODEL_AND_LOT);
});

// --- Whole lists -------------------------------------------------------------------------------------

test('matchDeviceToRecall flattens the verdict with device and recall facts', () => {
  const match = matchDeviceToRecall(plumDevice, plumRecall);
  assert.equal(match.deviceId, 'd1');
  assert.equal(match.ward, 'ICU');
  assert.equal(match.recallNumber, 'Z-2723-2026');
  assert.equal(match.recallClass, 'II');
  assert.equal(match.firm, 'ICU Medical, Inc.');
  assert.equal(match.confidence, 'exact');
});

test('matchDeviceToRecall returns null when there is no match', () => {
  assert.equal(matchDeviceToRecall({ ...plumDevice, manufacturer: 'Nobody', model: 'NOPE-1', type: 'bed', lotOrSerial: '' }, plumRecall), null);
});

test('matchDevicesToRecalls returns every matching pair', () => {
  const second = { ...plumDevice, id: 'd2', lotOrSerial: '50004072' };
  const matches = matchDevicesToRecalls([plumDevice, second], [plumRecall, novumRecall]);
  assert.equal(matches.length, 2);
  assert.ok(matches.every((m) => m.recallNumber === 'Z-2723-2026'));
});

test('matchDevicesToRecalls sorts by confidence, then recall class, then newest date', () => {
  const classI = { ...serialOnlyRecall, recallNumber: 'Z-1', recallClass: 'I', date: '2026-01-01' };
  const classIINew = { ...serialOnlyRecall, recallNumber: 'Z-2', recallClass: 'II', date: '2026-09-01' };
  const classIIOld = { ...serialOnlyRecall, recallNumber: 'Z-3', recallClass: 'II', date: '2026-02-01' };
  const device = { id: 'd2', name: 'Acme pump', type: 'infusion pump', manufacturer: 'Acme Medical', model: 'ZX-900', lotOrSerial: 'ACM-77120' };
  const exactDevice = { ...plumDevice };
  const matches = matchDevicesToRecalls([device, exactDevice], [classIIOld, classIINew, classI, plumRecall]);
  assert.deepEqual(
    matches.map((m) => m.recallNumber),
    ['Z-2723-2026', 'Z-1', 'Z-2', 'Z-3'], // exact first, then likely: class I, then class II newest first
  );
});

test('matchDevicesToRecalls puts unknown recall classes last within a confidence', () => {
  const known = { ...serialOnlyRecall, recallNumber: 'Z-K', recallClass: 'III' };
  const unknown = { ...serialOnlyRecall, recallNumber: 'Z-U', recallClass: '' };
  const device = { id: 'd2', name: 'Acme pump', type: 'infusion pump', manufacturer: 'Acme Medical', model: 'ZX-900', lotOrSerial: 'ACM-77120' };
  assert.deepEqual(matchDevicesToRecalls([device], [unknown, known]).map((m) => m.recallNumber), ['Z-K', 'Z-U']);
});

test('matchDevicesToRecalls gives the same order every time', () => {
  const a = { ...plumDevice, id: 'a' };
  const b = { ...plumDevice, id: 'b' };
  const forward = matchDevicesToRecalls([a, b], [plumRecall]).map((m) => m.deviceId);
  const reverse = matchDevicesToRecalls([b, a], [plumRecall]).map((m) => m.deviceId);
  assert.deepEqual(forward, ['a', 'b']);
  assert.deepEqual(reverse, ['a', 'b']);
});

test('matchDevicesToRecalls handles empty inputs', () => {
  assert.deepEqual(matchDevicesToRecalls([], [plumRecall]), []);
  assert.deepEqual(matchDevicesToRecalls([plumDevice], []), []);
});

// --- UDI-DI, serial ranges and the qualified "all serial numbers" (recall texts are real openFDA code_info values) ------

const philipsRecall = {
  recallNumber: 'Z-2579-2026', recallClass: 'II', date: '2026-07-01', firm: 'Philips North America Llc',
  product: 'IntelliVue Telemetry Monitor 5500', productText: 'Philips IntelliVue Telemetry Monitor 5500, telemetry monitor',
  codeText: 'Model Number: 867232. UDI-DI: (01)00884838102842. Software Version Number: 4.0.0.0. Serial Numbers: US001A002F, US001A00AW, US001A00C9, US001A00EW, US001A00F0',
};
const monitor = { manufacturer: 'Philips', model: '867232', type: 'telemetry monitor', lotOrSerial: 'US001A00AW', udiDi: '00884838102842' };

test('UDI-DI and this unit\'s serial both listed: exact, by the UDI rule', () => {
  const m = evaluateMatch(monitor, philipsRecall);
  assert.equal(m.confidence, CONFIDENCE.EXACT);
  assert.equal(m.rule, RULES.EXACT_UDI_UNIT);
  assert.match(m.reason, /UDI-DI 00884838102842 is listed/);
  assert.match(m.reason, /serial\/lot "US001A00AW" is listed/);
});

test('the UDI-DI finds a recall filed under another firm, with no maker or model text to go on', () => {
  const relabelled = { manufacturer: 'Some Brand Medical', model: 'XYZ-77', type: 'monitor', lotOrSerial: 'US001A00AW', udiDi: '00884838102842' };
  const m = evaluateMatch(relabelled, philipsRecall);
  assert.equal(m.rule, RULES.EXACT_UDI_UNIT);
  assert.equal(evaluateMatch({ ...relabelled, udiDi: '' }, philipsRecall), null, 'without the UDI-DI there is nothing to match on');
});

test('a UDI-DI written without its leading zeros in the recall still matches the 14-digit one on the device', () => {
  const recall = { ...philipsRecall, codeText: 'UDI-DI 884838102842 Serial Numbers: US001A00AW' };
  assert.equal(evaluateMatch(monitor, recall).rule, RULES.EXACT_UDI_UNIT);
});

test('UDI-DI listed and the recall covers all serial numbers: exact', () => {
  const recall = { recallNumber: 'Z-3065-2026', recallClass: 'II', date: '2026-09-09', firm: 'Baxter Healthcare Corporation', product: 'Novum IQ', productText: 'Novum IQ syringe pump', codeText: 'UDI-DI 05413765852428, all serial numbers ' };
  const m = evaluateMatch({ manufacturer: 'Baxter', model: 'NOVUMX', type: 'pump', lotOrSerial: 'ZZ-1234', udiDi: '05413765852428' }, recall);
  assert.equal(m.confidence, CONFIDENCE.EXACT);
  assert.equal(m.rule, RULES.EXACT_UDI_ALL_UNITS);
});

test('"all serial numbers WITH radio software versions..." is not every unit: the UDI-DI alone is only likely', () => {
  const recall = { recallNumber: 'Z-2582-2024', recallClass: 'II', date: '2024-08-28', firm: 'Baxter Healthcare Corporation', product: 'Sigma Spectrum', productText: 'Sigma Spectrum infusion pump', codeText: 'Pump UDI/DI GTIN 00085412498683; All serial numbers with radio software versions 22D28, 22D29, and 22D30 ' };
  const m = evaluateMatch({ manufacturer: 'Baxter Healthcare', model: '35700BAX2', type: 'pump', lotOrSerial: 'SP-30977', udiDi: '00085412498683' }, recall);
  assert.equal(m.confidence, CONFIDENCE.LIKELY);
  assert.equal(m.rule, RULES.LIKELY_UDI);
  assert.match(m.reason, /is not among the numbers listed/);
});

test('a device with a UDI-DI but no serial recorded is likely, and the reason says what is missing', () => {
  const m = evaluateMatch({ ...monitor, lotOrSerial: '' }, philipsRecall);
  assert.equal(m.rule, RULES.LIKELY_UDI);
  assert.match(m.reason, /no serial\/lot recorded/);
});

test('recallCoversAllUnits: a condition after "all serial numbers" means some units only', () => {
  const all = (text) => recallCoversAllUnits({ codeText: text });
  assert.equal(all('All Serial Numbers. Not model or lot specific.'), true);
  assert.equal(all('All serial numbers with radio software versions 22D28'), false);
  assert.equal(all('All serial numbers manufactured between 2019 and 2021'), false);
  assert.equal(all('All lot numbers having firmware 3.1'), false);
  assert.equal(all('UDI-DI 05413765852428, all serial numbers '), true);
  assert.equal(all('All units distributed'), true, 'a bare phrase is still every unit');
});

const astralRecall = {
  recallNumber: 'Z-2735-2026', recallClass: 'I', date: '2026-08-05', firm: 'ResMed Ltd.', product: 'Astral 100/150 ventilator', productText: 'ResMed Astral 100 and Astral 150 ventilators',
  codeText: 'Catalog Number: Astral 100 UDI-DI code: 00619498003259 Serial Numbers: Astral Ventilators-Serial number < 22241890149 PCBA Spare Parts-Serial number < 2707658',
};

test('the real Astral recall: a serial below the stated limit is exact (before: only likely)', () => {
  const inside = evaluateMatch({ manufacturer: 'ResMed', model: 'Astral 100', type: 'ventilator', lotOrSerial: '22241800001' }, astralRecall);
  assert.equal(inside.confidence, CONFIDENCE.EXACT);
  assert.equal(inside.rule, RULES.EXACT_MODEL_AND_RANGE);
  assert.match(inside.reason, /falls inside the range the recall gives \("< 22241890149"\)/);
  const outside = evaluateMatch({ manufacturer: 'ResMed', model: 'Astral 100', type: 'ventilator', lotOrSerial: '22250000001' }, astralRecall);
  assert.equal(outside.confidence, CONFIDENCE.POSSIBLE, 'above the stated limit: the recall leaves this unit out');
  assert.equal(outside.rule, RULES.POSSIBLE_UNIT_OUT);
});

test('a range and the UDI-DI together: exact by the UDI rule, and the reason names the range', () => {
  const m = evaluateMatch({ manufacturer: 'ResMed', model: 'Astral 100', type: 'ventilator', lotOrSerial: '22241800001', udiDi: '00619498003259' }, astralRecall);
  assert.equal(m.rule, RULES.EXACT_UDI_UNIT);
  assert.match(m.reason, /falls inside the range/);
});

test('a serial inside a range, with no model or product to tie it to, is NOT a match (the Getinge vaporizer / ventilator case)', () => {
  const vaporizer = { recallNumber: 'Z-1877-2024', recallClass: 'I', date: '2024-06-12', firm: 'Getinge Usa Sales Inc', product: 'Vaporizer Sevoflurane Maquet Filling', productText: 'Vaporizer Sevoflurane Maquet Filling, Product code/REF number (6682282), Component of: Flow-i C20, Flow-e.', codeText: 'Part Number 6682282; UDI/DI: 07325710000212: Serial Numbers: 17003 - 23454.' };
  const ventilator = { manufacturer: 'Getinge', model: '6693662', type: 'ventilator', lotOrSerial: '21500' };
  assert.equal(evaluateMatch(ventilator, vaporizer), null, 'same maker and a serial in the range, but a different product');
  assert.equal(evaluateMatch({ ...ventilator, model: '6682282', type: 'vaporizer' }, vaporizer).rule, RULES.EXACT_MODEL_AND_RANGE, 'with the right model it is exact');
});

test('lot codes that look like ranges never make a unit "inside a range"', () => {
  const recall = { recallNumber: 'Z-1-2025', recallClass: 'II', date: '2025-01-01', firm: 'Acme Medical Inc', product: 'Acme pump', productText: 'Acme pump model A100', codeText: 'Model A100; Lots: 2008-1459; 2011-2331; 2012-2961' };
  const m = evaluateMatch({ manufacturer: 'Acme Medical', model: 'A100', type: 'pump', lotOrSerial: '2100' }, recall);
  assert.equal(m.rule, RULES.LIKELY_MODEL, 'only likely: 2100 is not "inside" 2011-2331, that is a lot code');
});

test('a serial with letters after its digits is never judged by a range', () => {
  const recall = { ...astralRecall, codeText: 'Serial number < 99999999999' };
  const m = evaluateMatch({ manufacturer: 'ResMed', model: 'Astral 100', type: 'ventilator', lotOrSerial: 'US001A00AW' }, recall);
  assert.equal(m.rule, RULES.LIKELY_MODEL);
});

test('the match carries the device\'s UDI-DI for display', () => {
  const match = matchDeviceToRecall({ id: 'd1', name: 'Monitor', ward: 'Telemetry', ...monitor }, philipsRecall);
  assert.equal(match.deviceUdiDi, '00884838102842');
  assert.equal(matchDeviceToRecall({ id: 'd2', name: 'Monitor', ward: 'Telemetry', ...monitor, udiDi: undefined }, philipsRecall).deviceUdiDi, '');
});

test('a short serial tied to the device\'s own UDI-DI counts as listed ((21) serial 209), while a bare 3-digit number does not', () => {
  const recall = { recallNumber: 'Z-2285-2026', recallClass: 'II', date: '2026-06-10', firm: 'PHILIPS MEDICAL SYSTEMS NEDERLAND B.V.', product: 'Philips Azurion 3M15', productText: 'Philips Azurion 3M15, Model Numbers: 722064, 722222', codeText: 'UDI (01)00884838085282(21)209, (01)00884838099210(21)100, (01)00884838099210(21)254' };
  const withUdi = evaluateMatch({ manufacturer: 'Philips Medical Systems', model: '722064', type: 'azurion', lotOrSerial: '209', udiDi: '00884838085282' }, recall);
  assert.equal(withUdi.rule, RULES.EXACT_UDI_UNIT);
  assert.match(withUdi.reason, /serial\/lot "209" is listed with it/);
  const otherDi = evaluateMatch({ manufacturer: 'Philips Medical Systems', model: '722064', type: 'azurion', lotOrSerial: '100', udiDi: '00884838085282' }, recall);
  assert.equal(otherDi.rule, RULES.LIKELY_UDI, '100 belongs to the other DI, not this one');
  const noUdi = evaluateMatch({ manufacturer: 'Philips Medical Systems', model: '722064', type: 'azurion', lotOrSerial: '209' }, recall);
  assert.equal(noUdi.rule, RULES.LIKELY_MODEL, 'without the DI, a 3-digit number in the text proves nothing');
});

test('"all serial numbers" or a range for one model of a multi-product recall does not make another model exact', () => {
  const base = { recallNumber: 'Z-9', recallClass: 'II', date: '2026-11-01', firm: 'Acme Medical', product: 'WX family' };
  const recall = { ...base, productText: 'WX-200 and WX-300 monitors', codeText: 'WX-200: all serial numbers. WX-300: serial numbers 12345 through 12400.' };
  const dev = (model, lotOrSerial) => ({ id: 'd', name: 'Monitor', type: 'monitor', manufacturer: 'Acme Medical', model, lotOrSerial, ward: 'ICU' });
  assert.equal(evaluateMatch(dev('WX-200', '55555'), recall).rule, RULES.EXACT_MODEL_ALL_UNITS, 'its own model: all units');
  assert.notEqual(evaluateMatch(dev('WX-300', '99999'), recall).confidence, 'exact', 'outside WX-300 range; the all-units of WX-200 is not its');
  assert.equal(evaluateMatch(dev('WX-300', '12350'), recall).rule, RULES.EXACT_MODEL_AND_RANGE);
  const lots = { ...recall, codeText: 'WX-200: lots A1234, B5678. WX-300: lots C9999.' };
  assert.equal(evaluateMatch(dev('WX-300', 'A1234'), lots).confidence, 'likely', "a lot listed for WX-200 is not WX-300's");
  assert.equal(evaluateMatch(dev('WX-200', 'A1234'), lots).rule, RULES.EXACT_MODEL_AND_LOT);
});

test('exclusions in the code text switch the unit-level rules off: the answer stays "likely"', () => {
  const recall = { recallNumber: 'Z-8', recallClass: 'II', date: '2026-11-01', firm: 'Acme Medical', product: 'WX', productText: 'WX-200 monitor', codeText: 'All lot numbers except lot 12345.' };
  const dev = (lotOrSerial) => ({ id: 'd', name: 'M', type: 'monitor', manufacturer: 'Acme Medical', model: 'WX-200', lotOrSerial, ward: 'ICU' });
  assert.equal(evaluateMatch(dev('77777'), recall).confidence, 'likely');
  assert.equal(evaluateMatch(dev('12345'), recall).confidence, 'possible', 'the lot the text excludes by name is ruled out, never exact');
  const range = { ...recall, codeText: 'Serial numbers 1000 through 1500, excluding 1200.' };
  assert.equal(evaluateMatch(dev('1200'), range).confidence, 'possible', 'named as excluded');
  assert.equal(evaluateMatch(dev('1300'), range).confidence, 'likely', 'with an exclusion in the text a person decides');
});

// --- Real code texts of recalls with several products ---------------------------------------------------
// The texts below are copied from real openFDA records (the same ones are in eval/recalls.json). Real recalls do not write
// "WX-200: lots A1234." on one line: the model, the UDI-DI and the lots of one product are separate sentences or fields, so
// scoping has to find where one product's entry ends and the next begins.
const real = (recallNumber, firm, productText, codeText) => ({ recallNumber, recallClass: 'II', date: '2026-09-30', firm, product: productText.slice(0, 60), productText, codeText });
const own = (manufacturer, model, lotOrSerial, udiDi = '') => ({ id: 'd', name: `${manufacturer} ${model}`, type: 'device', manufacturer, model, lotOrSerial, udiDi, ward: 'ICU' });

test('Cooper INCA (Z-3140-2026): fields in separate sentences, one lot per model: a lot of another model is never exact', () => {
  const recall = real(
    'Z-3140-2026', 'CooperSurgical, Inc.', 'INCA Neonatal Nasal CPAP, Replacement Set. Model Numbers: 44-0712, 44-0707, 44-0709, 44-0715.',
    '1. Model Number: 44-0712. UDI-DI: (01)60888937009516. Lot Code: 550031624. 2. Model Number: 44-0707. UDI-DI: (01)20888937009488. Lot Code: 550021057. 3. Model Number: 44-0709. UDI-DI: (01)20888937009495. Lot Code: 550031623. 4. Model Number: 44-0715. UDI-DI: (01)20888937009525. Lot Code: 550031625.',
  );
  assert.equal(evaluateMatch(own('CooperSurgical', '44-0707', '550021057'), recall).rule, RULES.EXACT_MODEL_AND_LOT);
  assert.equal(evaluateMatch(own('CooperSurgical', '44-0709', '550031623'), recall).rule, RULES.EXACT_MODEL_AND_LOT);
  assert.equal(evaluateMatch(own('CooperSurgical', '44-0707', '550031624'), recall).rule, RULES.LIKELY_MODEL, "the lot of 44-0712 is not 44-0707's");
  // By UDI-DI alone (another maker's name, another model number): the lot has to be the one listed for THAT DI.
  assert.equal(evaluateMatch(own('Zenith', 'ZX-9', '550031625', '20888937009495'), recall).rule, RULES.LIKELY_UDI, "the lot of 44-0715 is not the lot of the DI of 44-0709");
  assert.equal(evaluateMatch(own('Zenith', 'ZX-9', '550031623', '20888937009495'), recall).confidence, 'exact');
});

test('restor3d (Z-2987-2026): "Model No ...; UDI-DI ...; Lot Numbers ..." entries with no full stops between them', () => {
  const recall = real(
    'Z-2987-2026', 'restor3d Inc.', 'Veritas Standard Glenoid Baseplate Model/Catalog Number: 1500-1030; 1500-1035',
    'Lot Code: Model No 1500-1030; UDI-DI 00840097513225; Lot Numbers A00030, A00065, A09828, A09830 Model No 1500-1035; UDI-DI 00840097513232; Lot Numbers A00064, A09829',
  );
  assert.equal(evaluateMatch(own('restor3d', '1500-1035', 'A00064'), recall).rule, RULES.EXACT_MODEL_AND_LOT, 'its own lot, listed after a model it does not belong to');
  assert.equal(evaluateMatch(own('restor3d', '1500-1030', 'A09830'), recall).rule, RULES.EXACT_MODEL_AND_LOT);
  assert.equal(evaluateMatch(own('restor3d', '1500-1035', 'A00030'), recall).confidence, 'likely', "a lot of 1500-1030 is not 1500-1035's");
  assert.equal(evaluateMatch(own('restor3d', '1500-1030', 'A09829'), recall).confidence, 'likely');
});

test('Henry Schein (Z-3015-2026): list numbers "1)", "2)" start the entries, and the manufacturer code inside an entry does not split it', () => {
  const recall = real(
    'Z-3015-2026', 'Henry Schein Inc.', 'Structur 2 SC Temporary Resin Cartridge Refill 75Gm, Product Codes: 1) 114-3933, 2) 114-3934',
    'Product Codes: 1) 114-3933, Mfr Product Code 1479, Lot Numbers: 2536179, 2606429; 2) 114-3934, Mfr Product Code 1480, Lot Numbers: 2539064; 3) 114-3935, Mfr Product Code 1481, Lot Numbers: 2533123; 4) 114-3937, Mfr Product Code 1482, Lot Numbers: 2533203, 2607170.',
  );
  assert.equal(evaluateMatch(own('Henry Schein', '114-3934', '2539064'), recall).confidence, 'exact');
  assert.equal(evaluateMatch(own('Henry Schein', '114-3937', '2607170'), recall).confidence, 'exact');
  assert.equal(evaluateMatch(own('Henry Schein', '114-3934', '2536179'), recall).confidence, 'likely', "a lot of 114-3933 is not 114-3934's");
  assert.equal(evaluateMatch(own('Henry Schein', '1480', '2536179'), recall).confidence, 'likely', "the manufacturer's own code finds the same entry");
});

test('a recall that shares lots between parts: only the lots of the device\'s own part count (IL GEM Premier, Z-2900-2026)', () => {
  const recall = real(
    'Z-2900-2026', 'Instrumentation Laboratory', 'GEM Premier 5000 PAK Part Numbers: 00055360010 00055360011 00055407504',
    'Part No. 00055360010 UDI-DI 08426950807599 Lots 260505K, 260504AG, 260505F; Part No. 00055360011 UDI-DI 08426950807605 Lots 260505F and 260505J; Part No. 00055407504 UDI-DI 08426950807537 Lot 260505R;',
  );
  assert.equal(evaluateMatch(own('Instrumentation Laboratory', '00055360011', '260505F'), recall).confidence, 'exact', 'a lot shared by two parts is exact for both');
  assert.equal(evaluateMatch(own('Instrumentation Laboratory', '00055360010', '260505F'), recall).confidence, 'exact');
  assert.equal(evaluateMatch(own('Instrumentation Laboratory', '00055407504', '260505K'), recall).confidence, 'likely', 'listed for another part only');
  assert.equal(evaluateMatch(own('Instrumentation Laboratory', '00055407504', '260505R'), recall).confidence, 'exact');
});

test('Maquet Cardiohelp (Z-0420-2024): an exclusion belongs to its own part; the other part\'s list still counts', () => {
  const recall = real(
    'Z-0420-2024', 'Maquet Medical Systems USA', 'CARDIOHELP Emergency Drive, Part Numbers 701048002 and 701076205.',
    'Part No. 701048002: UDI - 04037691643526; Serial Numbers 90425259 to 90425748 (Excluding 90425438, 90425443, 90425568, 90425570, 90425588, 90425716) [***Updated 1/8/24 to include Serial numbers 90421507, 90421980, 90424277. Serial numbers 90425366 and 90423121 are additionally included in the scope***] Part No. 701076205: No UDI; Serial Numbers 90425438, 90425443, 90425568, 90425570, 90425588, 90425716, 90425747, 90425748',
  );
  assert.equal(evaluateMatch(own('Maquet Medical Systems', '701076205', '90425438'), recall).rule, RULES.EXACT_MODEL_AND_LOT, 'listed under its own part, which has no exclusion');
  assert.equal(evaluateMatch(own('Maquet Medical Systems', '701048002', '90425438'), recall).confidence, 'possible', 'named in the exclusion of ITS part: ruled out, never exact');
  assert.equal(evaluateMatch(own('Maquet Medical Systems', '701048002', '90425300'), recall).confidence, 'likely', 'with an exclusion in its entry a person decides');
});

test('a label inside one product\'s own header does not split its entry, and one product with several labels is not "several products"', () => {
  const two = real('Z-1', 'Acme Medical', 'WX monitors', 'Model No 123-A, Catalog No 456-B, Lot Numbers: LOT1234, LOT5678. Model No 789-C, Catalog No 012-D, Lot Numbers: LOT9999.');
  assert.equal(evaluateMatch(own('Acme Medical', '123-A', 'LOT5678'), two).confidence, 'exact');
  assert.equal(evaluateMatch(own('Acme Medical', '456-B', 'LOT1234'), two).confidence, 'exact', 'the catalog number of the same product');
  assert.equal(evaluateMatch(own('Acme Medical', '789-C', 'LOT1234'), two).confidence, 'likely');
  const one = real('Z-2', 'Acme Medical', 'WX monitor, Model 123-A', 'Model No 123-A, Catalog No 456-B. Lot Numbers: LOT1234, LOT5678.');
  assert.equal(evaluateMatch(own('Acme Medical', '123-A', 'LOT5678'), one).confidence, 'exact');
  assert.equal(evaluateMatch(own('Acme Medical', '456-B', 'LOT1234'), one).confidence, 'exact');
});

test('"1.05.06.00", a part of a sentence and GS1 identifiers are not entries', () => {
  const recall = real('Z-3', 'Philips Respironics, Inc.', 'Trilogy Evo, all software versions except 1.05.06.00.', 'Model No. DS2000X11B; UDI-DI: 606959052000; All units except those with software version 1.05.06.00.');
  assert.equal(evaluateMatch(own('Philips Respironics', 'DS2000X11B', 'ABC12345'), recall).confidence, 'likely', 'the exclusion stays in force');
  const ai = real('Z-4', 'Acme Medical', 'WX-200 monitor', 'UDI (01) 00884838085282 (10) LOT1234 (21) 5555. Serial numbers 1000 through 1500.');
  assert.equal(evaluateMatch(own('Acme Medical', 'WX-200', '1200', ''), ai).rule, RULES.EXACT_MODEL_AND_RANGE, '"(10) " and "(21) " are not list numbers: nothing is cut, the model is not in the code text, the whole text is used as before');
});


// --- Found by independent review: wordings that left units out, and conditions after "all units" ----------------------------

test('"not affected", "unaffected", "not included", "excludes" and "exception" name units that are left out: the answer stays likely', () => {
  const dev = (lotOrSerial, udiDi = '') => ({ id: 'd', name: 'M', type: 'monitor', manufacturer: 'Acme Medical', model: 'WX-200', lotOrSerial, udiDi, ward: 'ICU' });
  const recall = (codeText) => ({ recallNumber: 'Z-7', recallClass: 'II', date: '2026-11-01', firm: 'Acme Medical', product: 'WX', productText: 'WX-200 monitor', codeText });
  const cases = [
    ['Lot numbers 12345 and 67890 are not affected.', '12345'],
    ['Serial numbers 1000 through 1500 are not affected by this recall.', '1200'],
    ['Unaffected lots: 12345.', '12345'],
    ['All lot numbers; lot 12345 is not included.', '77777'],
    ['Lot numbers 12345, 67890. Lot 12345 is not subject to this recall.', '12345'],
    ['This recall excludes lot 12345. Lots 12345, 67890.', '67890'],
    ['Lots 12345 and 67890, with the exception of units already corrected.', '67890'],
  ];
  for (const [text, lot] of cases) assert.equal(evaluateMatch(dev(lot), recall(text)).confidence, 'likely', text);
  // The same words about the OTHER units are only a closing remark: the listed units stay listed.
  assert.equal(evaluateMatch(dev('1200'), recall('Serial numbers 1000 through 1500. Units with other serial numbers are not affected.')).confidence, 'exact');
  assert.equal(evaluateMatch(dev('12345'), recall('Lot numbers 12345 and 67890. All remaining lots are not affected.')).confidence, 'exact');
  assert.equal(evaluateMatch(dev('12345'), recall('Lot numbers 12345 and 67890. Lots not listed are unaffected.')).confidence, 'exact');
});

test('the UDI-DI path does not call a unit exact when the text says it is left out', () => {
  const recall = { recallNumber: 'Z-6', recallClass: 'II', date: '2026-11-01', firm: 'Acme Medical', product: 'WX', productText: 'WX-200 monitor', codeText: 'All units except (01)00884838085282(21)209.' };
  const unit = { id: 'd', name: 'M', type: 'monitor', manufacturer: 'Acme Medical', model: 'WX-200', lotOrSerial: '209', udiDi: '00884838085282', ward: 'ICU' };
  assert.equal(evaluateMatch(unit, recall).confidence, 'likely');
  const noted = { ...recall, codeText: 'UDI-DI 00884838085282. Serial numbers 1000 through 1500 are not affected.' };
  assert.equal(evaluateMatch({ ...unit, lotOrSerial: '1200' }, noted).confidence, 'likely');
  const plain = { ...recall, codeText: '(01)00884838085282(21)209' };
  assert.equal(evaluateMatch(unit, plain).rule, RULES.EXACT_UDI_UNIT, 'without the exclusion the tied serial is still exact');
});

test('"all units FROM lot 12345", "all serial numbers from 5000 onward" and "all units built in 2019" are some units, not every unit', () => {
  for (const text of ['Model WX-200: all units from lot 12345.', 'All serial numbers from 5000 onward.', 'All units built in 2019.', 'All units that were shipped after March 2024.', 'All lots since lot 4500.']) {
    assert.equal(recallCoversAllUnits({ codeText: text }), false, text);
  }
  assert.equal(recallCoversAllUnits({ codeText: 'All units distributed' }), true);
  assert.equal(recallCoversAllUnits({ codeText: 'All serial numbers' }), true);
});

test('a maker written with umlauts is the same maker as its two-letter spelling (Dräger / Draeger)', () => {
  assert.equal(manufacturersMatch('Dräger', 'Draeger Medical Systems, Inc.'), true);
  assert.equal(manufacturersMatch('Draeger', 'Dräger Medical GmbH'), true);
  assert.equal(manufacturersMatch('Müller Medizintechnik', 'Mueller Medizintechnik GmbH'), true);
  assert.equal(manufacturersMatch('Dräger', 'Drägerwerk AG & Co. KGaA'), true, 'the parent company is on the family list');
  assert.equal(manufacturersMatch('Dräger', 'Draegerx Medical'), false, 'a different word stays different');
  const recall = { recallNumber: 'Z-5', recallClass: 'I', date: '2026-11-01', firm: 'Draeger Medical Systems, Inc.', product: 'Evita V500', productText: 'Evita V500 ventilator, model MK14000', codeText: 'All serial numbers' };
  const match = evaluateMatch({ manufacturer: 'Dräger', model: 'MK14000', type: 'ventilator', lotOrSerial: 'ASDF-1234', ward: 'ICU' }, recall);
  assert.equal(match.rule, RULES.EXACT_MODEL_ALL_UNITS, 'a true exact match is no longer downgraded to "possible" (no task)');
});

// --- Makers that go by more than one name (src/makerAliases.js) ------------------------------------------------------

test('two names of one company are the same maker: BD, GE, Baxter and the others on the family list', () => {
  const same = [
    ['BD', 'Becton, Dickinson and Company'], ['BD', 'CareFusion 303, Inc.'], ['Bard', 'Becton Dickinson'], ['C. R. Bard, Inc.', 'BD'],
    ['GE Healthcare', 'GE Medical Systems, LLC'], ['GE HealthCare', 'Datex-Ohmeda, Inc.'], ['GE', 'Wipro GE Healthcare'], ['Marquette', 'GE Healthcare'],
    ['Hill-Rom', 'Baxter Healthcare Corporation'], ['Hillrom', 'Baxter'], ['Welch Allyn', 'Baxter Healthcare Corporation'],
    ['Hospira', 'ICU Medical, Inc.'], ['Smiths Medical', 'ICU Medical'],
    ['Covidien', 'Medtronic, Inc.'], ['Nellcor', 'Medtronic'], ['Puritan Bennett', 'Medtronic'], ['MiniMed', 'Medtronic MiniMed, Inc.'],
    ['Respironics', 'Koninklijke Philips N.V.'], ['Volcano', 'Philips'],
    ['Maquet', 'Getinge'], ['Getinge', 'Maquet Critical Care AB'],
    ['Dräger', 'Draeger Medical Systems, Inc.'], ['Drager', 'Drägerwerk AG & Co. KGaA'],
    ['3M', 'Solventum Corporation'], ['Sorin', 'LivaNova'], ['Physio-Control', 'Stryker Corporation'], ['Varian', 'Siemens Healthineers'],
    ['Abiomed', 'Johnson & Johnson'], ['St. Jude Medical', 'Abbott Laboratories'], ['Zimmer', 'Biomet'], ['NxStage', 'Fresenius Medical Care'],
  ];
  for (const [a, b] of same) {
    assert.equal(manufacturersMatch(a, b), true, `${a} / ${b}`);
    assert.equal(manufacturersMatch(b, a), true, `${b} / ${a} (the rule is symmetric)`);
  }
});

test('different companies stay different, and a short name joins a family only at the start of the maker', () => {
  const different = [
    ['BD', 'Baxter Healthcare Corporation'], ['GE Healthcare', 'Philips'], ['Hill-Rom', 'Hologic'], ['Hospira', 'Pfizer'],
    ['Bardex Corporation', 'Becton Dickinson'], ['Sage Software', 'Stryker'], ['Vege Medical', 'GE Healthcare'], ['Mage Devices', 'GE Healthcare'],
    ['Medtronic', 'Boston Scientific'], ['Siemens', 'Philips'],
  ];
  for (const [a, b] of different) assert.equal(manufacturersMatch(a, b), false, `${a} / ${b}`);
  assert.equal(manufacturersMatch('Acme GE Supply', 'GE Healthcare'), false, '"ge" in the middle of a name is not GE');
  assert.equal(manufacturersMatch('Wipro GE Healthcare', 'GE Medical Systems'), true, 'but "Wipro GE" is on the list as a name of its own');
});

test('a device recorded as "BD" is matched to a Becton Dickinson recall, and the reason says they are one company', () => {
  const recall = { recallNumber: 'Z-3', recallClass: 'I', date: '2026-09-01', firm: 'Becton, Dickinson and Company', product: 'Alaris Pump Module', productText: 'Alaris Pump Module, Model 8100', codeText: 'Serial Numbers: 12345678, 12345679' };
  const device = (lotOrSerial) => ({ id: 'd', name: 'Alaris pump', type: 'pump module', manufacturer: 'BD', model: '8100', lotOrSerial, ward: 'ICU' });
  const listed = evaluateMatch(device('12345678'), recall);
  assert.equal(listed.confidence, 'exact');
  assert.equal(listed.rule, RULES.EXACT_MODEL_AND_LOT);
  assert.match(listed.reason, /"BD" and the recalling firm "Becton, Dickinson and Company" are the same company/);
  const unlisted = evaluateMatch(device('99999999'), recall);
  assert.equal(unlisted.rule, RULES.LIKELY_MODEL);
  assert.match(unlisted.reason, /are the same company/);
  assert.doesNotMatch(evaluateMatch({ ...device('12345678'), manufacturer: 'Becton Dickinson' }, recall).reason, /same company/, 'no note when the words already match');
});

test('Hill-Rom beds recalled by Baxter (the real Z-0228-2025 shape): the company is the same, the bed must still be the bed', () => {
  const recall = { recallNumber: 'Z-0228-2025', recallClass: 'II', date: '2025-01-10', firm: 'Baxter Healthcare Corporation', product: 'Progressa bed', productText: 'Progressa hospital bed, Model P7900B000001', codeText: 'UDI-DI 00887761985162, all serial numbers' };
  const bed = { id: 'd', name: 'Progressa', type: 'hospital bed', manufacturer: 'Hill-Rom', model: 'P7900B000001', lotOrSerial: 'A1B2C3D4', ward: 'ICU' };
  assert.equal(evaluateMatch(bed, recall).rule, RULES.EXACT_MODEL_ALL_UNITS);
  assert.equal(evaluateMatch({ ...bed, model: 'P3200B000001' }, recall).rule, RULES.POSSIBLE_TYPE, 'another Hill-Rom bed: same company and kind of device, a look but no task');
  assert.equal(evaluateMatch({ ...bed, model: 'P3200B000001', type: 'patient monitor' }, recall), null, 'another kind of Hill-Rom device: nothing');
});

test('matchDevicesToRecalls gives exactly what comparing every pair gives, for devices that share a maker, model and UDI-DI', () => {
  const recalls = [
    { recallNumber: 'Z-1', recallClass: 'I', date: '2026-10-01', firm: 'Becton, Dickinson and Company', product: 'Alaris', productText: 'Alaris Pump Module Model 8100', codeText: 'Serial Numbers: 12345678, 12345679' },
    { recallNumber: 'Z-2', recallClass: 'II', date: '2026-09-01', firm: 'Acme Medical', product: 'WX', productText: 'WX-200 monitor', codeText: 'UDI-DI 00884838085282. All serial numbers' },
    { recallNumber: 'Z-3', recallClass: 'II', date: '2026-08-01', firm: 'Other Firm', product: 'Pump', productText: 'Pump model 8100 relabelled', codeText: 'Lot 55555' },
    { recallNumber: 'Z-4', recallClass: 'III', date: '2026-07-01', firm: 'Unrelated Corp', product: 'Chair', productText: 'Dental chair QX-5150', codeText: 'Lot 99999' },
  ];
  const devices = [
    { id: 'a', name: 'Pump', type: 'pump module', manufacturer: 'BD', model: '8100', lotOrSerial: '12345678', ward: 'ICU' },
    { id: 'b', name: 'Pump', type: 'pump module', manufacturer: 'BD', model: '8100', lotOrSerial: '77777777', ward: 'ER' },
    { id: 'c', name: 'Monitor', type: 'monitor', manufacturer: 'Zenith', model: 'ZX-1', lotOrSerial: '', udiDi: '00884838085282', ward: 'ICU' },
    { id: 'd', name: 'Chair', type: 'chair', manufacturer: 'Zenith', model: 'QX-5150', lotOrSerial: '99999', ward: 'Dental' },
    { id: 'e', name: 'Nothing', type: 'x', manufacturer: 'Nobody', model: 'NN', lotOrSerial: '', ward: 'X' },
  ];
  const everyPair = devices.flatMap((device) => recalls.map((recall) => matchDeviceToRecall(device, recall)).filter(Boolean));
  const fast = matchDevicesToRecalls(devices, recalls);
  const key = (m) => `${m.deviceId}|${m.recallNumber}|${m.confidence}|${m.rule}`;
  assert.deepEqual(fast.map(key).sort(), everyPair.map(key).sort());
  assert.ok(fast.length >= 4, `${fast.length} matches`);
});

// --- Ruling a unit out (possible-unit-ruled-out) -------------------------------------------------------------------
// The product matches, the recall itself leaves this unit out, and nothing in the text can cover it another way.

const rangeRecall = real('Z-5-2026', 'Acme Medical Inc', 'Acme Pump Model QX-200', 'Model QX-200: serial numbers 100000 through 100500');

test('a serial outside the only range the recall states is ruled out, with the recall\'s own words, and no task', () => {
  const v = evaluateMatch(own('Acme Medical', 'QX-200', '100900'), rangeRecall);
  assert.equal(v.confidence, CONFIDENCE.POSSIBLE);
  assert.equal(v.rule, RULES.POSSIBLE_UNIT_OUT);
  assert.match(v.reason, /outside the range the recall gives/);
  assert.match(v.reason, /100000 through 100500/);
});

test('a serial inside the range is still exact', () => {
  assert.equal(evaluateMatch(own('Acme Medical', 'QX-200', '100200'), rangeRecall).confidence, CONFIDENCE.EXACT);
});

test('no serial recorded: nothing can be ruled out, the unit stays likely', () => {
  assert.equal(evaluateMatch(own('Acme Medical', 'QX-200', ''), rangeRecall).confidence, CONFIDENCE.LIKELY);
});

test('a serial of a different length than the range is not judged by it', () => {
  assert.equal(evaluateMatch(own('Acme Medical', 'QX-200', '5000'), rangeRecall).confidence, CONFIDENCE.LIKELY);
});

test('a recall that also lists lots or adds units is never used to rule a unit out', () => {
  for (const code of [
    'Model QX-200: serial numbers 100000 through 100500; Lot numbers A1, B2',
    'Model QX-200: serial numbers 100000 through 100500. Updated to also include serial numbers 100900',
    'Model QX-200: all serial numbers except 100000 through 100500',
    'Model QX-200: serial numbers 100000 through 100500, and units shipped before 2019',
    'Model QX-200: serial numbers 100000 through 100500; units with software version 2.1',
    'Model QX-200: serial numbers 100000 through 100500. Distributed between March and May',
  ]) {
    const recall = real('Z-6-2026', 'Acme Medical Inc', 'Acme Pump Model QX-200', code);
    assert.notEqual(evaluateMatch(own('Acme Medical', 'QX-200', '100900'), recall).rule, RULES.POSSIBLE_UNIT_OUT, code);
  }
});

test('a serial named in a plain "excluding" list is ruled out; one the text also adds back is not', () => {
  const plain = real('Z-7-2026', 'Acme Medical Inc', 'Acme Pump Model QX-200', 'Model QX-200: serial numbers 100000 through 100500 (Excluding 100123, 100456)');
  assert.equal(evaluateMatch(own('Acme Medical', 'QX-200', '100123'), plain).rule, RULES.POSSIBLE_UNIT_OUT);
  assert.equal(evaluateMatch(own('Acme Medical', 'QX-200', '100124'), plain).confidence, CONFIDENCE.LIKELY, 'an unnamed unit stays with a person');
  const added = real('Z-8-2026', 'Acme Medical Inc', 'Acme Pump Model QX-200', 'Model QX-200: serial numbers 100000 through 100500 (Excluding 100123) [Updated to include serial numbers 100123]');
  assert.notEqual(evaluateMatch(own('Acme Medical', 'QX-200', '100123'), added).rule, RULES.POSSIBLE_UNIT_OUT);
});

test('the UDI-DI rule rules a unit out the same way', () => {
  const recall = real('Z-9-2026', 'Acme Medical Inc', 'Acme Pump Model QX-200', 'Model QX-200 UDI-DI 00884838085282: serial numbers 100000 through 100500');
  const v = evaluateMatch(own('Other Name', 'zz', '100900', '00884838085282'), recall);
  assert.equal(v.rule, RULES.POSSIBLE_UNIT_OUT);
});
