import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoDevices, loadDemoHospital } from './demoHospital.js';
import { createDeviceStore, normalizeDevices, DEVICE_SOURCES } from './deviceStore.js';
import { fakeKv } from './fakeKv.mjs';

test('the demo hospital has 30 valid, uniquely identified devices', () => {
  const devices = buildDemoDevices();
  assert.equal(devices.length, 30);
  // normalizeDevices throws on a missing required field or a duplicate id.
  assert.equal(normalizeDevices(devices).length, 30);
});

test('every demo device is marked as demo and has a ward', () => {
  for (const device of buildDemoDevices()) {
    assert.equal(device.source, DEVICE_SOURCES.DEMO, device.id);
    assert.ok(device.ward, `${device.id} has no ward`);
  }
});

test('demo ids are namespaced so they cannot collide with the hospital\'s own devices', () => {
  assert.ok(buildDemoDevices().every((d) => d.id.startsWith('demo-')));
});

test('the demo covers a realistic mix of device types and manufacturers', () => {
  const devices = buildDemoDevices();
  const types = new Set(devices.map((d) => d.type));
  const makers = new Set(devices.map((d) => d.manufacturer));
  for (const type of ['infusion pump', 'patient monitor', 'ventilator', 'defibrillator']) {
    assert.ok(types.has(type), `missing type ${type}`);
  }
  assert.ok(makers.size >= 10, `only ${makers.size} manufacturers`);
});

test('the devices meant to match a recall exactly all carry a serial or lot number', () => {
  const exactGroup = buildDemoDevices().slice(0, 12);
  assert.ok(exactGroup.every((d) => d.lotOrSerial), 'exact group needs serial/lot numbers');
});

test('buildDemoDevices returns fresh copies each call', () => {
  const first = buildDemoDevices();
  first[0].name = 'changed';
  assert.notEqual(buildDemoDevices()[0].name, 'changed');
});

test('loadDemoHospital stores all 30 devices', async () => {
  const store = createDeviceStore(fakeKv());
  assert.equal(await loadDemoHospital(store), 30);
  assert.equal((await store.listDevices()).length, 30);
});

test('loadDemoHospital is safe to run repeatedly', async () => {
  const store = createDeviceStore(fakeKv());
  await loadDemoHospital(store);
  await loadDemoHospital(store);
  assert.equal((await store.listDevices()).length, 30);
});

test('loadDemoHospital keeps the hospital\'s own devices', async () => {
  const store = createDeviceStore(fakeKv());
  await store.saveDevices([
    {
      id: 'own-1',
      name: 'Our pump',
      type: 'infusion pump',
      manufacturer: 'ICU Medical',
      model: '1',
      source: 'manual',
    },
  ]);
  await loadDemoHospital(store);
  const devices = await store.listDevices();
  assert.equal(devices.length, 31);
  assert.ok(devices.some((d) => d.id === 'own-1'));
});

test('loadDemoHospital removes stale demo devices before reloading', async () => {
  const store = createDeviceStore(fakeKv());
  await store.saveDevices([
    {
      id: 'demo-999',
      name: 'Old demo device',
      type: 'pump',
      manufacturer: 'X',
      model: 'Y',
      source: 'demo',
    },
  ]);
  await loadDemoHospital(store);
  const ids = (await store.listDevices()).map((d) => d.id);
  assert.ok(!ids.includes('demo-999'));
  assert.equal(ids.length, 30);
});
