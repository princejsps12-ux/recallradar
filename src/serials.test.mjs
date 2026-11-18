import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSerialConstraints, serialInConstraints, splitSerial, hasSerialConstraints } from './serials.js';

const inRange = (serial, text) => serialInConstraints(serial, parseSerialConstraints(text));

test('a range after the word serial: "through", "to" and a hyphen', () => {
  assert.ok(inRange('1200', 'Serial numbers 1000 through 1500'));
  assert.ok(inRange('2100', 'SN: 2001-2500'));
  assert.ok(inRange('300', 'Serial No. 100 to 400'), 'a three digit serial is compared too');
  assert.equal(inRange('1500', 'Serial numbers 1000 through 1500').text, '1000 through 1500', 'the bounds are inclusive and the words are the recall\'s own');
  assert.equal(inRange('999', 'Serial numbers 1000 through 1500'), null);
  assert.equal(inRange('1501', 'Serial numbers 1000 through 1500'), null);
});

test('limits: "<", "below", "up to", "through N", "and above", ">="', () => {
  assert.ok(inRange('2000', 'serial number < 2224'));
  assert.equal(inRange('2224', 'serial number < 2224'), null, '"<" does not include the limit');
  assert.ok(inRange('2224', 'serial number <= 2224'));
  assert.ok(inRange('2223', 'Serial numbers below 2224'));
  assert.ok(inRange('3500', 'all serial numbers up to 3500'), '"up to" includes the limit');
  assert.ok(inRange('3500', 'serial numbers through 3500'));
  assert.equal(inRange('3501', 'serial numbers through 3500'), null);
  assert.ok(inRange('3000', 'Serial numbers 3000 and above'));
  assert.equal(inRange('2999', 'Serial numbers 3000 and above'), null);
  assert.equal(inRange('3000', 'serial numbers > 3000'), null);
  assert.ok(inRange('3001', 'serial numbers > 3000'));
  assert.ok(inRange('3000', 'serial numbers >= 3000'));
});

test('the real Astral recall: "Serial number < 22241890149"', () => {
  const text = 'Catalog Number: Astral 100 UDI-DI code: 00619498003259 Serial Numbers: Astral Ventilators-Serial number < 22241890149 PCBA Spare Parts-Serial number < 2707658';
  assert.ok(inRange('22241800001', text), 'a serial below the limit is affected');
  assert.equal(inRange('22241890149', text), null, 'the limit itself is not');
  assert.equal(inRange('22250000000', text), null);
});

test('lot codes that look like ranges are NOT ranges: only text after "serial" counts', () => {
  const lots = 'Product Code: NZ3309; UDI-DI: 09421901970369; Lots: 2008-1459; 2009-1864; 2011-2331, 2012-2961';
  assert.equal(hasSerialConstraints(parseSerialConstraints(lots)), false);
  assert.equal(inRange('2100', lots), null);
  assert.equal(inRange('2100', 'Lot numbers 2001-2500'), null, '"lot numbers" are not serial numbers');
});

test('a serial clause stops before the lot numbers', () => {
  const c = parseSerialConstraints('Serial Nos. AB1000-AB1999; Lot numbers 2000-3000');
  assert.equal(c.ranges.length, 1);
  assert.equal(inRange('AB1500', 'Serial Nos. AB1000-AB1999; Lot numbers 2000-3000').text, 'AB1000-AB1999');
  assert.equal(inRange('2500', 'Serial numbers 1000-1500 Lot numbers 2000-3000'), null);
});

test('a range whose end is below its start is a code, not a range', () => {
  assert.equal(hasSerialConstraints(parseSerialConstraints('Serial: 2008-1459')), false);
});

test('a letter prefix has to match, in any case', () => {
  assert.ok(inRange('AB1500', 'Serial numbers AB1000-AB1999'));
  assert.ok(inRange('ab1500', 'Serial numbers AB1000-AB1999'));
  assert.equal(inRange('XY1500', 'Serial numbers AB1000-AB1999'), null);
  assert.equal(inRange('1500', 'Serial numbers AB1000-AB1999'), null, 'no prefix is not the AB prefix');
});

test('only a serial that is a number can be judged: letters after the digits are never compared', () => {
  assert.equal(splitSerial('US001A00AW'), null);
  assert.equal(splitSerial('IC1014').digits, '1014');
  assert.equal(splitSerial('77'), null, 'shorter than three digits');
  assert.equal(splitSerial(''), null);
  assert.equal(splitSerial(undefined), null);
  assert.equal(inRange('US001A00AW', 'serial number < 99999999999'), null);
  assert.equal(inRange('77', 'serial number < 2224'), null);
});

test('big serial numbers do not lose digits', () => {
  assert.ok(inRange('9007199254740993', 'serial numbers 9007199254740992 through 9007199254740994'));
  assert.equal(inRange('9007199254740995', 'serial numbers 9007199254740992 through 9007199254740994'), null);
});

test('nothing to find in empty or unrelated text', () => {
  for (const text of ['', undefined, 'Lot Numbers: 1, 2, 3', 'Model 1000-2000']) assert.equal(hasSerialConstraints(parseSerialConstraints(text)), false, String(text));
  assert.equal(serialInConstraints('1200', undefined), null);
});

test('a limit only applies to serials with the same number of digits, a range to lengths between its ends', () => {
  const text = 'Astral Ventilators-Serial number < 22241890149 PCBA Spare Parts-Serial number < 2707658';
  assert.ok(inRange('22241800001', text), 'an 11-digit serial is judged by the 11-digit limit');
  assert.ok(inRange('2000000', text), 'a 7-digit serial is judged by the 7-digit limit');
  assert.equal(inRange('123456', text), null, 'a 6-digit serial is judged by neither');
  assert.equal(inRange('2900000', text), null, 'above the 7-digit limit, and the 11-digit one is not its limit');
  assert.ok(inRange('1000', 'serial numbers 950 through 1050'), 'a range with ends of different length covers the lengths between');
  assert.equal(inRange('99999', 'serial numbers 1000 through 5000'), null);
});

test('serialOutsideConstraints: outside every constraint that applies, never inside, never when nothing applies', async () => {
  const { parseSerialConstraints, serialOutsideConstraints } = await import('./serials.js');
  const c = parseSerialConstraints('serial numbers 100000 through 100500; serial number < 22241890149');
  assert.equal(serialOutsideConstraints('100900', c).text, '100000 through 100500');
  assert.equal(serialOutsideConstraints('100200', c), null);
  assert.equal(serialOutsideConstraints('22250000001', c).text.includes('22241890149'), true);
  assert.equal(serialOutsideConstraints('5000', c), null, 'no constraint judges a 4-digit serial');
  assert.equal(serialOutsideConstraints('US001A00AW', c), null, 'not a comparable serial');
  assert.equal(serialOutsideConstraints('100900', null), null);
});
