import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MATCH_CACHE_KEY,
  CACHE_TTL_HOURS,
  CACHE_TTL_MS,
  MAX_CACHE_BYTES,
  fingerprintDevices,
  createMatchCache,
} from './matchCache.js';
import { fakeKv } from './fakeKv.mjs';

const device = (id, extra = {}) => ({
  id,
  name: `Device ${id}`,
  type: 'infusion pump',
  manufacturer: 'ICU Medical',
  model: '400020401',
  lotOrSerial: '50003704',
  ward: 'ICU',
  ...extra,
});

const devices = [device('a'), device('b')];
const result = { deviceCount: 2, recallCount: 5, matches: [], failedQueries: 0, cappedQueries: 0 };
const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);

// A cache whose clock we control.
function cacheAt(kv, nowRef) {
  return createMatchCache(kv, () => nowRef.now);
}

// --- Fingerprint ---------------------------------------------------------------------------------

test('the fingerprint is the same for the same devices, in any order', () => {
  assert.equal(fingerprintDevices([device('a'), device('b')]), fingerprintDevices([device('b'), device('a')]));
});

test('the fingerprint changes when a device is added or removed', () => {
  const base = fingerprintDevices(devices);
  assert.notEqual(base, fingerprintDevices([...devices, device('c')]));
  assert.notEqual(base, fingerprintDevices([device('a')]));
});

test('the fingerprint changes when any displayed or matched field changes', () => {
  const base = fingerprintDevices(devices);
  for (const change of [
    { name: 'Renamed' },
    { type: 'ventilator' },
    { manufacturer: 'Other' },
    { model: '999' },
    { lotOrSerial: '1234' },
    { ward: 'ER' },
  ]) {
    assert.notEqual(base, fingerprintDevices([device('a', change), device('b')]), JSON.stringify(change));
  }
});

test('fields cannot run together to fake an unchanged fingerprint', () => {
  const one = fingerprintDevices([device('a', { name: 'ab', type: 'c' })]);
  const two = fingerprintDevices([device('a', { name: 'a', type: 'bc' })]);
  assert.notEqual(one, two);
});

test('the fingerprint of an empty list is stable', () => {
  assert.equal(fingerprintDevices([]), fingerprintDevices([]));
});

// --- Reading -------------------------------------------------------------------------------------

test('read returns nothing when nothing is saved', async () => {
  assert.equal(await createMatchCache(fakeKv()).read(devices), null);
});

test('a saved result is returned with its checked-at time', async () => {
  const now = { now: T0 };
  const cache = cacheAt(fakeKv(), now);
  assert.equal(await cache.write(devices, result), true);
  const entry = await cache.read(devices);
  assert.deepEqual(entry.result, result);
  assert.equal(entry.checkedAt, new Date(T0).toISOString());
});

test('a saved result is still valid just before it expires', async () => {
  const now = { now: T0 };
  const cache = cacheAt(fakeKv(), now);
  await cache.write(devices, result);
  now.now = T0 + CACHE_TTL_MS - 1;
  assert.ok(await cache.read(devices));
});

test('a saved result expires exactly at the time limit', async () => {
  const now = { now: T0 };
  const cache = cacheAt(fakeKv(), now);
  await cache.write(devices, result);
  now.now = T0 + CACHE_TTL_MS;
  assert.equal(await cache.read(devices), null);
});

test('the time limit is six hours', () => {
  assert.equal(CACHE_TTL_HOURS, 6);
  assert.equal(CACHE_TTL_MS, 6 * 60 * 60 * 1000);
});

test('a saved result is ignored once the device list has changed', async () => {
  const now = { now: T0 };
  const cache = cacheAt(fakeKv(), now);
  await cache.write(devices, result);
  assert.equal(await cache.read([...devices, device('c')]), null);
  assert.equal(await cache.read([device('a', { model: 'changed' }), device('b')]), null);
});

test('a result dated in the future is ignored', async () => {
  const now = { now: T0 };
  const cache = cacheAt(fakeKv(), now);
  await cache.write(devices, result);
  now.now = T0 - 60 * 1000; // the clock went backwards
  assert.equal(await cache.read(devices), null);
});

test('damaged saved data is ignored, not fatal', async () => {
  for (const bad of [
    'text',
    42,
    {},
    { checkedAt: 'not a date', fingerprint: fingerprintDevices(devices), result },
    { checkedAt: new Date(T0).toISOString(), fingerprint: fingerprintDevices(devices) }, // no result
    { fingerprint: fingerprintDevices(devices), result }, // no time
  ]) {
    const cache = createMatchCache(fakeKv({ [MATCH_CACHE_KEY]: bad }), () => T0);
    assert.equal(await cache.read(devices), null, JSON.stringify(bad));
  }
});

test('a storage error while reading is treated as "nothing saved"', async () => {
  const kv = fakeKv();
  kv.get = async () => {
    throw new Error('storage down');
  };
  assert.equal(await createMatchCache(kv, () => T0).read(devices), null);
});

// --- Writing -------------------------------------------------------------------------------------

test('write uses the given checked-at time', async () => {
  const kv = fakeKv();
  const cache = createMatchCache(kv, () => T0);
  await cache.write(devices, result, '2026-11-14T10:00:00.000Z');
  assert.equal(kv.data.get(MATCH_CACHE_KEY).checkedAt, '2026-11-14T10:00:00.000Z');
});

test('a result that is too large is not saved', async () => {
  const kv = fakeKv();
  const cache = createMatchCache(kv, () => T0);
  const big = { ...result, matches: ['x'.repeat(MAX_CACHE_BYTES)] };
  assert.equal(await cache.write(devices, big), false);
  assert.equal(kv.data.has(MATCH_CACHE_KEY), false);
});

test('the size limit counts bytes, not characters', async () => {
  const cache = createMatchCache(fakeKv(), () => T0);
  // 3 bytes per character: fewer characters than the limit, more bytes than the limit.
  const wide = { ...result, matches: ['€'.repeat(Math.ceil(MAX_CACHE_BYTES / 3) + 100)] };
  assert.equal(await cache.write(devices, wide), false);
});

test('a storage error while writing returns false instead of throwing', async () => {
  const kv = fakeKv();
  kv.set = async () => {
    throw new Error('storage down');
  };
  assert.equal(await createMatchCache(kv, () => T0).write(devices, result), false);
});

test('writing again replaces the earlier result', async () => {
  const now = { now: T0 };
  const cache = cacheAt(fakeKv(), now);
  await cache.write(devices, result);
  now.now = T0 + 1000;
  await cache.write(devices, { ...result, recallCount: 99 });
  assert.equal((await cache.read(devices)).result.recallCount, 99);
});

test('clear removes the saved result', async () => {
  const cache = createMatchCache(fakeKv(), () => T0);
  await cache.write(devices, result);
  await cache.clear();
  assert.equal(await cache.read(devices), null);
});
