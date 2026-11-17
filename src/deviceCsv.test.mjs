import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeviceCsv, splitLine, detectDelimiter, importDevices, MAX_IMPORT_ROWS } from './deviceCsv.js';

const csv = 'Device,Manufacturer,Model,Serial,Ward\nSigma pump,Baxter Healthcare,35700BAX2,SP-1,Med-Surg 4E\nVentilator,Getinge,6487800,SI-7,ICU';

test('a comma separated sheet becomes devices with ids, source and defaults', () => {
  const { devices, errors } = parseDeviceCsv(csv);
  assert.deepEqual(errors, []);
  assert.equal(devices.length, 2);
  assert.deepEqual(devices[0], { id: 'own-001', name: 'Sigma pump', type: 'medical device', manufacturer: 'Baxter Healthcare', model: '35700BAX2', lotOrSerial: 'SP-1', ward: 'Med-Surg 4E', udiDi: '', source: 'manual' });
  assert.equal(devices[1].id, 'own-002');
});

test('a sheet pasted from a spreadsheet uses tabs', () => {
  const { devices } = parseDeviceCsv('Maker\tModel\tLocation\nGetinge\t6487800\tICU');
  assert.equal(devices[0].manufacturer, 'Getinge');
  assert.equal(devices[0].ward, 'ICU');
  assert.equal(devices[0].name, 'Getinge 6487800'); // name defaults from maker and model
});

test('column names are matched loosely', () => {
  const { devices, errors } = parseDeviceCsv('Vendor,Catalog Number,Serial / Lot #,Unit,Kind\nMasimo,9847,6000062119,ER,pulse oximeter');
  assert.deepEqual(errors, []);
  assert.deepEqual([devices[0].manufacturer, devices[0].model, devices[0].lotOrSerial, devices[0].ward, devices[0].type], ['Masimo', '9847', '6000062119', 'ER', 'pulse oximeter']);
});

test('quoted cells may contain commas and doubled quotes', () => {
  assert.deepEqual(splitLine('a,"b, c","say ""hi"""', ','), ['a', 'b, c', 'say "hi"']);
  const { devices } = parseDeviceCsv('Manufacturer,Model,Name\n"Baxter, Inc.",X1,"Pump ""A"""');
  assert.equal(devices[0].manufacturer, 'Baxter, Inc.');
  assert.equal(devices[0].name, 'Pump "A"');
});

test('windows line endings and blank lines are fine', () => {
  const { devices } = parseDeviceCsv('Manufacturer,Model\r\n\r\nGetinge,1\r\n\r\n');
  assert.equal(devices.length, 1);
});

test('delimiter detection', () => {
  assert.equal(detectDelimiter('a\tb'), '\t');
  assert.equal(detectDelimiter('a,b'), ',');
});

test('empty paste, header only, and missing columns each say what is wrong', () => {
  assert.match(parseDeviceCsv('').errors[0], /Paste your device list/);
  assert.match(parseDeviceCsv('Manufacturer,Model').errors[0], /no devices/);
  const missing = parseDeviceCsv('Name,Ward\nx,y').errors;
  assert.equal(missing.length, 2);
  assert.match(missing[0], /"manufacturer" column/);
  assert.match(missing[1], /"model" column/);
});

test('a bad row is reported with its line number and NOTHING is imported', () => {
  const out = parseDeviceCsv('Manufacturer,Model\nGetinge,1\n,2\nBaxter,\n');
  assert.deepEqual(out.devices, []);
  assert.deepEqual(out.errors, ['Line 3: manufacturer is empty.', 'Line 4: model is empty.']);
});

test('too many rows and over-long fields are refused', () => {
  const many = 'Manufacturer,Model\n' + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `M,${i}`).join('\n');
  assert.match(parseDeviceCsv(many).errors[0], /Too many rows/);
  assert.match(parseDeviceCsv(`Manufacturer,Model\n${'x'.repeat(121)},1`).errors[0], /longer than 120/);
});

test('only the first few errors are listed', () => {
  const rows = Array.from({ length: 12 }, () => ',1').join('\n');
  const { errors } = parseDeviceCsv(`Manufacturer,Model\n${rows}`);
  assert.equal(errors.length, 9);
  assert.equal(errors[8], '...and 4 more.');
});

test('importDevices replaces earlier pasted devices, keeps demo devices, and saves nothing on error', async () => {
  const calls = [];
  const store = { removeBySource: async (s) => calls.push(['remove', s]), saveDevices: async (d) => { calls.push(['save', d.length]); return d.length; } };
  assert.deepEqual(await importDevices(store, csv), { ok: true, count: 2 });
  assert.deepEqual(calls, [['remove', 'manual'], ['save', 2]]);
  calls.length = 0;
  const bad = await importDevices(store, 'Manufacturer,Model\n,1');
  assert.equal(bad.ok, false);
  assert.deepEqual(calls, []);
});

test('a UDI-DI column is read, checked and stored as 14 digits (UDI, UDI-DI, DI and GTIN all work as its name)', () => {
  for (const header of ['UDI-DI', 'UDI', 'GTIN', 'DI', 'Device Identifier']) {
    const { devices, errors } = parseDeviceCsv(`Manufacturer,Model,Serial,${header}\nPhilips,867232,US001A00AW,884838102842\nBaxter,40800BAXUS,BX-1,(01)05413765852428`);
    assert.deepEqual(errors, [], header);
    assert.deepEqual(devices.map((d) => d.udiDi), ['00884838102842', '05413765852428'], header);
  }
});

test('a wrong UDI-DI is refused with its line number, and the check digit is the test', () => {
  const { devices, errors } = parseDeviceCsv('Manufacturer,Model,UDI-DI\nPhilips,867232,00884838102842\nBaxter,40800,00884838102843\nAcme,Z9,12345');
  assert.deepEqual(devices, []);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /Line 3: UDI-DI "00884838102843" is not a valid GTIN/);
  assert.match(errors[1], /Line 4: UDI-DI "12345" is not a valid GTIN/);
});

test('the UDI-DI is optional, and an empty cell is fine', () => {
  const { devices, errors } = parseDeviceCsv('Manufacturer,Model,UDI-DI\nPhilips,867232,');
  assert.deepEqual(errors, []);
  assert.equal(devices[0].udiDi, '');
});
