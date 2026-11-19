import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssetsClient, mapAttributes, objectsToTsv, readAssetsDevices, friendlyAssetsError, ASSETS_PAGE_SIZE } from './assets.js';
import { previewDeviceCsv, parseDeviceCsv } from './deviceCsv.js';

const route = (strings, ...values) => strings.reduce((out, s, i) => out + s + (i < values.length ? encodeURIComponent(String(values[i])) : ''), '');
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

const attributes = [
  { id: '11', name: 'Name' }, { id: '12', name: 'Manufacturer' }, { id: '13', name: 'Model Number' }, { id: '14', name: 'Serial Number' },
  { id: '15', name: 'Location' }, { id: '16', name: 'UDI-DI' }, { id: '17', name: 'Purchase price' },
];
const obj = (label, v) => ({ label, attributes: Object.entries(v).map(([id, value]) => ({ objectTypeAttributeId: id, objectAttributeValues: [typeof value === 'object' ? value : { value }] })) });

test('attribute names are read like column headers; unknown ones are ignored', () => {
  const { columns } = mapAttributes(attributes);
  assert.deepEqual(columns.map((c) => c.label), ['Name', 'Manufacturer', 'Model', 'Serial or lot', 'Ward', 'UDI-DI', '']);
});

test('without a Name attribute the object label is the device name', () => {
  const tsv = objectsToTsv(attributes.slice(1), [obj('Impella 1', { 12: 'Abiomed', 13: '0042-0000-US', 14: '12345' })]);
  assert.equal(tsv.split('\n')[0].split('\t')[0], 'Name');
  assert.equal(tsv.split('\n')[1].split('\t')[0], 'Impella 1');
});

test('the text goes through the same import as a paste, and a reference uses its display value', () => {
  const tsv = objectsToTsv(attributes, [
    obj('Pump 1', { 11: 'Alaris pump', 12: 'CareFusion', 13: '8015', 14: 'SN123456', 15: { value: '77', displayValue: 'ICU' }, 16: '00884838085282' }),
    obj('Pump 2', { 11: 'Alaris pump', 12: 'CareFusion', 13: '8015', 14: 'SN123457', 15: { value: '78', displayValue: 'ER' } }),
  ]);
  const { devices, errors } = parseDeviceCsv(tsv);
  assert.deepEqual(errors, []);
  assert.deepEqual(devices.map((d) => [d.manufacturer, d.model, d.lotOrSerial, d.ward, d.udiDi]), [['CareFusion', '8015', 'SN123456', 'ICU', '00884838085282'], ['CareFusion', '8015', 'SN123457', 'ER', '']]);
  assert.equal(previewDeviceCsv(tsv).valid, true);
});

test('tabs and line breaks inside a value cannot break the row', () => {
  const tsv = objectsToTsv(attributes, [obj('x', { 11: 'A\tB\nC', 12: 'M', 13: 'X1' })]);
  assert.equal(tsv.split('\n').length, 2);
});

test('the client reads the workspace once, then schemas, types, attributes and objects, all read-only', async () => {
  const calls = [];
  const client = createAssetsClient({
    route,
    request: async (path, options = {}) => {
      calls.push(`${options.method || 'GET'} ${path}`);
      if (path.includes('/rest/servicedeskapi')) return ok({ values: [{ workspaceId: 'ws-1' }] });
      if (path.endsWith('/objectschema/list')) return ok({ values: [{ id: 4, displayName: 'Business Portfolio', objectCount: 21 }] });
      if (path.endsWith('/objecttypes/flat')) return ok([{ id: 9, name: 'Medical device', objectCount: 3 }]);
      if (path.endsWith('/attributes')) return ok([{ id: 11, name: 'Manufacturer' }, { id: 12, name: 'Model' }]);
      if (path.includes('/object/aql')) return ok({ total: 1, values: [obj('Pump', { 11: 'Acme', 12: 'X1' })] });
      throw new Error(`unexpected ${path}`);
    },
  });
  assert.deepEqual(await client.schemas(), [{ id: '4', name: 'Business Portfolio', objectCount: 21 }]);
  assert.deepEqual(await client.objectTypes('4'), [{ id: '9', name: 'Medical device', objectCount: 3 }]);
  const read = await readAssetsDevices(client, '9');
  assert.equal(read.total, 1);
  assert.match(read.text, /Acme\tX1/);
  assert.equal(calls.filter((c) => c.includes('/rest/servicedeskapi')).length, 1, 'the workspace id is read once');
  assert.ok(calls.every((c) => c.startsWith('GET') || c.includes('/object/aql')), 'the only POST is the read-only AQL search');
});

test('objects are read in pages and stop one past the import limit', async () => {
  let pages = 0;
  const client = createAssetsClient({
    route,
    request: async (path) => {
      if (path.includes('/rest/servicedeskapi')) return ok({ values: [{ workspaceId: 'ws-1' }] });
      pages += 1;
      return ok({ total: 5000, values: Array.from({ length: ASSETS_PAGE_SIZE }, (_, i) => obj(`d${pages}-${i}`, {})) });
    },
  });
  const { objects, truncated } = await client.objects('9');
  assert.equal(objects.length, 1001);
  assert.equal(truncated, true);
  assert.equal(pages, 11);
});

test('errors become one plain sentence each', () => {
  assert.match(friendlyAssetsError({ status: 403 }), /permission/);
  assert.match(friendlyAssetsError({ status: 404 }), /not found/);
  assert.match(friendlyAssetsError({ status: 401 }), /administrator/);
  assert.match(friendlyAssetsError(new Error('boom')), /Could not read Assets/);
});

test('a site without Assets answers 404 and the client says so', async () => {
  const client = createAssetsClient({ route, request: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  await assert.rejects(client.schemas(), (e) => e.status === 404);
});
