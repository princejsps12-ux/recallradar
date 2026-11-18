import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_KEY_PREFIX,
  DEVICE_SOURCES,
  WRITE_BATCH_SIZE,
  WRITE_CONCURRENCY,
  deviceKey,
  normalizeDevice,
  normalizeDevices,
  createDeviceStore,
} from './deviceStore.js';
import { fakeKv } from './fakeKv.mjs';

const pump = {
  id: 'dev-001',
  name: 'Alaris infusion pump',
  type: 'infusion pump',
  manufacturer: 'Becton Dickinson',
  model: '8015',
  lotOrSerial: 'SN-1',
  ward: 'ICU',
  udiDi: '',
  source: 'demo',
};

test('deviceKey puts every device under the shared prefix', () => {
  assert.equal(deviceKey('dev-001'), `${DEVICE_KEY_PREFIX}dev-001`);
});

test('normalizeDevice trims text and keeps all fields', () => {
  const device = normalizeDevice({ ...pump, name: '  Alaris infusion pump ', ward: ' ICU ' });
  assert.deepEqual(device, pump);
});

test('normalizeDevice defaults optional fields to empty strings', () => {
  const { lotOrSerial, ward, udiDi, source, ...required } = pump;
  const device = normalizeDevice(required);
  assert.equal(device.lotOrSerial, '');
  assert.equal(device.ward, '');
  assert.equal(device.source, DEVICE_SOURCES.MANUAL);
});

test('normalizeDevice treats an unknown source as manual', () => {
  assert.equal(normalizeDevice({ ...pump, source: 'something-else' }).source, 'manual');
});

test('normalizeDevice rejects each missing required field', () => {
  for (const field of ['id', 'name', 'type', 'manufacturer', 'model']) {
    assert.throws(() => normalizeDevice({ ...pump, [field]: '  ' }), new RegExp(`"${field}"`));
    assert.throws(() => normalizeDevice({ ...pump, [field]: undefined }), new RegExp(`"${field}"`));
  }
});

test('normalizeDevice rejects non-objects and non-string fields', () => {
  assert.throws(() => normalizeDevice(null), /must be an object/);
  assert.throws(() => normalizeDevice('pump'), /must be an object/);
  assert.throws(() => normalizeDevice({ ...pump, model: 8015 }), /"model"/);
});

test('normalizeDevices requires an array and unique ids', () => {
  assert.throws(() => normalizeDevices({}), /must be an array/);
  assert.throws(() => normalizeDevices([pump, { ...pump, name: 'Other' }]), /Duplicate device id "dev-001"/);
  assert.equal(normalizeDevices([pump, { ...pump, id: 'dev-002' }]).length, 2);
});

test('saveDevices stores each device under its own key and returns the count', async () => {
  const kv = fakeKv();
  const store = createDeviceStore(kv);
  const count = await store.saveDevices([pump, { ...pump, id: 'dev-002' }]);
  assert.equal(count, 2);
  assert.deepEqual(kv.data.get('device:dev-001'), pump);
  assert.ok(kv.data.has('device:dev-002'));
});

test('listDevices returns devices sorted by id and ignores unrelated keys', async () => {
  const kv = fakeKv({ 'settings:theme': { dark: true } });
  const store = createDeviceStore(kv);
  await store.saveDevices([
    { ...pump, id: 'dev-003' },
    { ...pump, id: 'dev-001' },
    { ...pump, id: 'dev-002' },
  ]);
  const devices = await store.listDevices();
  assert.deepEqual(devices.map((d) => d.id), ['dev-001', 'dev-002', 'dev-003']);
});

test('listDevices returns an empty list when nothing is stored', async () => {
  assert.deepEqual(await createDeviceStore(fakeKv()).listDevices(), []);
});

test('saveDevices validates everything before writing anything', async () => {
  const kv = fakeKv();
  const store = createDeviceStore(kv);
  await assert.rejects(store.saveDevices([pump, { ...pump, id: 'dev-002', model: '' }]), /"model"/);
  assert.equal(kv.data.size, 0);
});

test('saveDevices limits parallel writes to a few batches at a time', async () => {
  const kv = fakeKv();
  const store = createDeviceStore(kv);
  const many = Array.from({ length: WRITE_BATCH_SIZE * WRITE_CONCURRENCY * 2 + 5 }, (_, i) => ({
    ...pump,
    id: `dev-${String(i).padStart(3, '0')}`,
  }));
  await store.saveDevices(many);
  assert.equal(kv.data.size, many.length);
  assert.ok(kv.maxInFlight <= WRITE_BATCH_SIZE * WRITE_CONCURRENCY, `max in flight was ${kv.maxInFlight}`);
  assert.ok(kv.maxInFlight > WRITE_BATCH_SIZE, 'and the groups really do run together');
});

test('removeDevices deletes just the devices with these ids', async () => {
  const kv = fakeKv();
  const store = createDeviceStore(kv);
  await store.saveDevices([{ ...pump, id: 'a' }, { ...pump, id: 'b' }, { ...pump, id: 'c' }]);
  assert.equal(await store.removeDevices(['a', 'c', 'nope']), 2);
  assert.deepEqual((await store.listDevices()).map((d) => d.id), ['b']);
});

test('clear removes only devices and reports how many', async () => {
  const kv = fakeKv({ 'settings:theme': { dark: true } });
  const store = createDeviceStore(kv);
  await store.saveDevices([pump, { ...pump, id: 'dev-002' }]);
  assert.equal(await store.clear(), 2);
  assert.deepEqual(await store.listDevices(), []);
  assert.ok(kv.data.has('settings:theme'));
});

test('removeBySource removes only devices from that source', async () => {
  const kv = fakeKv({ 'settings:theme': { dark: true } });
  const store = createDeviceStore(kv);
  await store.saveDevices([
    { ...pump, id: 'a', source: 'demo' },
    { ...pump, id: 'b', source: 'manual' },
    { ...pump, id: 'c', source: 'demo' },
    { ...pump, id: 'd', source: 'assets' },
  ]);
  assert.equal(await store.removeBySource('demo'), 2);
  assert.deepEqual((await store.listDevices()).map((d) => d.id), ['b', 'd']);
  assert.ok(kv.data.has('settings:theme'));
});

test('removeBySource returns 0 when nothing matches', async () => {
  const store = createDeviceStore(fakeKv());
  await store.saveDevices([{ ...pump, source: 'manual' }]);
  assert.equal(await store.removeBySource('demo'), 0);
  assert.equal((await store.listDevices()).length, 1);
});

test('replaceAll swaps the whole list', async () => {
  const store = createDeviceStore(fakeKv());
  await store.saveDevices([pump, { ...pump, id: 'dev-002' }]);
  const count = await store.replaceAll([{ ...pump, id: 'dev-009' }]);
  assert.equal(count, 1);
  assert.deepEqual((await store.listDevices()).map((d) => d.id), ['dev-009']);
});

test('replaceAll with invalid data keeps the existing devices', async () => {
  const store = createDeviceStore(fakeKv());
  await store.saveDevices([pump]);
  await assert.rejects(store.replaceAll([{ ...pump, id: 'dev-002', type: '' }]), /"type"/);
  assert.deepEqual((await store.listDevices()).map((d) => d.id), ['dev-001']);
});

test('replaceAll is idempotent: running it twice gives the same list', async () => {
  const store = createDeviceStore(fakeKv());
  const input = [pump, { ...pump, id: 'dev-002' }];
  await store.replaceAll(input);
  await store.replaceAll(input);
  assert.equal((await store.listDevices()).length, 2);
});

test('normalizeDevice keeps a valid UDI-DI as 14 digits and rejects one that is not a GTIN', () => {
  assert.equal(normalizeDevice({ ...pump, udiDi: '884838102842' }).udiDi, '00884838102842');
  assert.equal(normalizeDevice({ ...pump, udiDi: ' (01)00884838102842 ' }).udiDi, '00884838102842');
  assert.equal(normalizeDevice({ ...pump, udiDi: '' }).udiDi, '');
  assert.throws(() => normalizeDevice({ ...pump, udiDi: '00884838102843' }), /invalid UDI-DI/, 'a wrong check digit');
  assert.throws(() => normalizeDevice({ ...pump, udiDi: 'abc' }), /invalid UDI-DI/);
});

// A storage that can write up to 25 records in one call, like Forge's batchSet / batchDelete, and refuses more.
function batchKv() {
  const kv = fakeKv();
  kv.calls = { setMany: [], deleteMany: [] };
  kv.setMany = async (entries) => {
    if (entries.length > 25) throw new Error('more than 25 in a batch');
    kv.calls.setMany.push(entries.length);
    for (const { key, value } of entries) kv.data.set(key, structuredClone(value));
  };
  kv.deleteMany = async (keys) => {
    if (keys.length > 25) throw new Error('more than 25 in a batch');
    kv.calls.deleteMany.push(keys.length);
    for (const key of keys) kv.data.delete(key);
  };
  const single = kv.set;
  kv.set = async (...args) => {
    kv.singleWrites = (kv.singleWrites || 0) + 1;
    return single(...args);
  };
  return kv;
}

test('with a storage that writes in batches, 1,000 devices are saved in 40 calls of 25 and not in 1,000 single writes', async () => {
  const kv = batchKv();
  const store = createDeviceStore(kv);
  const devices = Array.from({ length: 1000 }, (_, i) => ({ id: `own-${i}`, name: `Pump ${i}`, type: 'pump', manufacturer: 'Acme', model: 'M-1', lotOrSerial: `SN${i}`, ward: 'ICU' }));
  assert.equal(await store.saveDevices(devices), 1000);
  assert.equal(kv.calls.setMany.length, 40);
  assert.ok(kv.calls.setMany.every((n) => n === 25));
  assert.equal(kv.singleWrites || 0, 0);
  assert.equal((await store.listDevices()).length, 1000);
});

test('with a storage that deletes in batches, removing and clearing use them, in groups of at most 25', async () => {
  const kv = batchKv();
  const store = createDeviceStore(kv);
  const devices = Array.from({ length: 60 }, (_, i) => ({ id: `own-${i}`, name: `Pump ${i}`, type: 'pump', manufacturer: 'Acme', model: 'M-1', lotOrSerial: `SN${i}`, ward: 'ICU', source: i < 30 ? 'demo' : 'manual' }));
  await store.saveDevices(devices);
  assert.equal(await store.removeDevices(devices.slice(0, 10).map((d) => d.id)), 10);
  assert.equal(await store.removeBySource('demo'), 20);
  assert.equal(await store.clear(), 30);
  assert.equal(kv.data.size, 0);
  assert.ok(kv.calls.deleteMany.every((n) => n <= 25) && kv.calls.deleteMany.length >= 3);
});

test('a batch that the storage fails stops the save instead of pretending it worked', async () => {
  const kv = batchKv();
  kv.setMany = async () => {
    throw new Error('Storage could not save 3 of 25 records (X)');
  };
  await assert.rejects(() => createDeviceStore(kv).saveDevices([{ id: 'a', name: 'n', type: 't', manufacturer: 'm', model: 'mod' }]), /could not save/);
});
