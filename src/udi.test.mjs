import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gs1CheckDigitValid, normalizeDi, diVariants, extractUdis } from './udi.js';

// The recall texts below are real code_info values from openFDA (device enforcement), whitespace tidied.

test('the GS1 check digit: right numbers pass, a changed digit fails, other lengths are not GTINs', () => {
  for (const di of ['00884838085282', '00848838001796', '00840682123129', '10889942499953', '05030267044528', '00661392048157']) assert.equal(gs1CheckDigitValid(di), true, di);
  assert.equal(gs1CheckDigitValid('00884838085283'), false);
  assert.equal(gs1CheckDigitValid('1234567'), false);
  assert.equal(gs1CheckDigitValid('abc'), false);
});

test('normalizeDi gives 14 digits from every shape a GTIN is written in', () => {
  assert.equal(normalizeDi('(01)00884838085282'), '00884838085282');
  assert.equal(normalizeDi('0088 4838 0852 82'), '00884838085282');
  assert.equal(normalizeDi('848838001796'), '00848838001796', 'UPC-A, 12 digits');
  assert.equal(normalizeDi('5030267049844'), '05030267049844', 'EAN-13');
  assert.equal(normalizeDi(5030267049844), '05030267049844', 'a number from a spreadsheet cell');
  assert.equal(normalizeDi('12345670'), '00000012345670', 'GTIN-8 is padded too');
});

test('normalizeDi refuses what is not a GTIN, and with strict a wrong check digit', () => {
  for (const bad of ['', '123', '1234567890', 'abcdefghijklmn', null, undefined, {}]) assert.equal(normalizeDi(bad), null, String(bad));
  assert.equal(normalizeDi('00884838085283'), '00884838085283', 'not strict: a typo in a recall text still compares');
  assert.equal(normalizeDi('00884838085283', { strict: true }), null, 'strict: a typo in the device list is caught');
});

test('diVariants: the forms a GTIN has in recall text (14, 13 and 12 digits)', () => {
  assert.deepEqual(diVariants('00848838001796'), ['00848838001796', '0848838001796', '848838001796']);
  assert.deepEqual(diVariants('10889942499953'), ['10889942499953'], 'a leading 1 is not dropped');
  assert.deepEqual(diVariants('nonsense'), []);
});

test('extractUdis reads a GS1 element string with its serial (21)', () => {
  const found = extractUdis('Model No.989605431531; UDI: (01)00884838070806(21)B29W3Y; Serial No. B29W3Y.');
  assert.deepEqual(found, [{ di: '00884838070806', serials: ['B29W3Y'], lots: [] }]);
});

test('extractUdis reads the lot (10) and ignores the expiry (17)', () => {
  const found = extractUdis('Lot Code: Model No. 2519CP; UDI-DI 00661392048157; Lot# 5G3119 GTIN: (01)00661392048157(10)5G3119(17)260731');
  assert.equal(found.length, 1, 'the same DI named twice is one DI');
  assert.deepEqual(found[0].lots, ['5G3119']);
});

test('extractUdis reads every serial of a long element list, per DI', () => {
  const text = 'UDI (01)00884838085282(21)209, (01)00884838099210(21)100, (01)00884838099210(21)254, (01)00884838085282(21)260';
  const found = Object.fromEntries(extractUdis(text).map((u) => [u.di, u.serials]));
  assert.deepEqual(found, { '00884838085282': ['209', '260'], '00884838099210': ['100', '254'] });
});

test('extractUdis reads labelled lists, with package levels in brackets', () => {
  assert.deepEqual(extractUdis('1) DYNDH1193, UDI-DI: 10889942499953(each), 40889942499954(case), Lot Number: 24ABA808').map((u) => u.di), ['10889942499953', '40889942499954']);
  assert.deepEqual(extractUdis('REF: 1000035; Single Unit UDI: 5030267049844; Case UDI: 05030267044528; Lot No. 32190425').map((u) => u.di), ['05030267049844', '05030267044528']);
  assert.deepEqual(extractUdis('UDI-DI/GTIN: 00840682135269, 00195278010797. System ID: 415353UMR2, 082427110162').map((u) => u.di), ['00840682135269', '00195278010797'], 'a list stops at the full stop; the System IDs after it are not DIs');
  assert.deepEqual(extractUdis('UDI/DI 05413765852428, All Serial Numbers').map((u) => u.di), ['05413765852428']);
  assert.deepEqual(extractUdis('Product Code: NZ3309; UDI-DI: 09421901970369; Lots: 2008-1459; 2009-1864').map((u) => u.di), ['09421901970369']);
  assert.deepEqual(extractUdis('Alaris Pump Module Model 8100- All Serial Numbers/ UDI(s): 10885403222054, 10885403517723, 10885403810015').map((u) => u.di), ['10885403222054', '10885403517723', '10885403810015']);
});

test('extractUdis reads a 12-digit DI and keeps lot numbers and serials that are not DIs out', () => {
  assert.deepEqual(extractUdis('R01460 - GC Agar Base 10/PK UDI-DI 848838001796 Lots 338950 356898 359912').map((u) => u.di), ['00848838001796']);
  assert.deepEqual(extractUdis('Lots: 16188647 16210212 Serial Numbers: SQAD01037 SQAD01038'), []);
  assert.deepEqual(extractUdis('UDI Not Required'), []);
  assert.deepEqual(extractUdis(''), []);
  assert.deepEqual(extractUdis(undefined), []);
});

test('extractUdis reads "UDI-DI code:" (the real ResMed Astral recall) and "UDI Numbers:"', () => {
  assert.deepEqual(extractUdis('Catalog Number: Astral 100 UDI-DI code: 00619498003259 Serial Numbers: Astral Ventilators-Serial number < 22241890149').map((u) => u.di), ['00619498003259']);
  assert.deepEqual(extractUdis('Model Number: 10432915. UDI Numbers: (01)04056869006703(21)45046, (01)04056869006703(21)45115').map((u) => u.di), ['04056869006703']);
});
