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
  assert.equal(manufacturersMatch('Getinge', 'Maquet Critical Care AB'), false);
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

test('RULE possible-model-other-maker: distinctive model from a different firm', () => {
  const device = { id: 'd3', name: 'SERVO-U', type: 'ventilator', manufacturer: 'Getinge', model: '6693662', lotOrSerial: '21500' };
  const match = evaluateMatch(device, servoRecall);
  assert.equal(match.confidence, CONFIDENCE.POSSIBLE);
  assert.equal(match.rule, RULES.POSSIBLE_MODEL_OTHER_MAKER);
  assert.match(match.reason, /Maquet Critical Care AB/);
  assert.match(match.reason, /Getinge/);
});

test('RULE possible-model-other-maker needs a distinctive (long enough) model', () => {
  const recall = { ...servoRecall, productText: 'Monitor N15', codeText: '' };
  const device = { id: 'd3', name: 'Monitor', type: 'monitor', manufacturer: 'Getinge', model: 'N15', lotOrSerial: '' };
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
