import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MATCH_CACHE_KEY,
  CACHE_TTL_HOURS,
  CACHE_TTL_MS,
  MAX_RETENTION_MS,
  MAX_RETENTION_HOURS,
  MAX_CACHE_BYTES,
  splitText,
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

const manyMatches = (n) => Array.from({ length: n }, (_, i) => ({ deviceId: `d${i}`, recallNumber: `Z-${i}-2026`, reason: 'r'.repeat(400), device: '€ünïcode '.repeat(5) }));

test('a result of 1,500 matches is saved in parts, every stored value is small, and it reads back whole', async () => {
  const kv = fakeKv();
  const cache = createMatchCache(kv, () => T0);
  const big = { ...result, matches: manyMatches(1500) };
  assert.equal(await cache.write(devices, big), true);
  const head = kv.data.get(MATCH_CACHE_KEY);
  assert.equal(head.v, 2);
  assert.ok(head.chunks > 5, `a big result is several parts (${head.chunks})`);
  for (const [key, value] of kv.data) {
    if (key.startsWith(`${MATCH_CACHE_KEY}:part:`)) assert.ok(Buffer.byteLength(value) <= 150 * 1024, 'each part fits one storage value');
  }
  const back = await cache.read(devices);
  assert.deepEqual(back.result, big);
});

test('parts are cut between characters, never inside a surrogate pair', () => {
  const text = '😀'.repeat(7); // each is two UTF-16 units
  for (const size of [3, 4, 5, 7]) {
    const pieces = splitText(text, size);
    assert.equal(pieces.join(''), text);
    for (const piece of pieces) assert.ok(!/[\ud800-\udbff]$/.test(piece), `no piece ends on half a pair (size ${size})`);
  }
});

test('a result needing more than MAX_CHUNKS parts is not saved, and nothing is left behind', async () => {
  const kv = fakeKv();
  const cache = createMatchCache(kv, () => T0);
  const tooBig = { ...result, matches: ['x'.repeat(MAX_CACHE_BYTES + 10)] };
  assert.equal(await cache.write(devices, tooBig), false);
  assert.equal(kv.data.size, 0);
});

test('a shorter result replaces a longer one and the unused parts are deleted; clear and expiry delete every part', async () => {
  const kv = fakeKv();
  let now = T0;
  const cache = createMatchCache(kv, () => now);
  await cache.write(devices, { ...result, matches: manyMatches(1500) });
  const long = kv.data.get(MATCH_CACHE_KEY).chunks;
  await cache.write(devices, { ...result, matches: manyMatches(10) });
  const short = kv.data.get(MATCH_CACHE_KEY).chunks;
  assert.ok(short < long);
  const parts = () => [...kv.data.keys()].filter((k) => k.includes(':part:'));
  assert.equal(parts().length, short);
  await cache.clear();
  assert.equal(kv.data.size, 0, 'clear removes the head and every part');
  await cache.write(devices, { ...result, matches: manyMatches(300) });
  now += 25 * 60 * 60 * 1000;
  assert.equal(await cache.purgeExpired(), true);
  assert.equal(kv.data.size, 0, 'the 24-hour purge removes the parts too');
});

test('a missing or damaged part makes the saved result unusable instead of wrong, and a different device list does not read the parts at all', async () => {
  const kv = fakeKv();
  const cache = createMatchCache(kv, () => T0);
  await cache.write(devices, { ...result, matches: manyMatches(400) });
  const reads = [];
  const get = kv.get;
  kv.get = async (key) => { reads.push(key); return get(key); };
  assert.equal(await cache.peek([{ ...devices[0], id: 'other' }]), null);
  assert.deepEqual(reads, [MATCH_CACHE_KEY], 'only the head was read');
  kv.get = get;
  const partKeys = [...kv.data.keys()].filter((k) => k.includes(':part:')).sort();
  kv.data.set(partKeys[1], '{ not json');
  assert.equal(await cache.peek(devices), null);
  kv.data.delete(partKeys[0]);
  assert.equal(await cache.peek(devices), null);
});

// --- Saving never mixes two results ----------------------------------------------------------------------

// Two results of the same shape and almost the same length: cut at the same places, the parts of one can sit beside the parts of
// the other and still read as valid JSON, with a damaged value inside. (The earlier design overwrote the parts in place.)
const resultWith = (mark) => ({ ...result, matches: manyMatches(400).map((m, i) => ({ ...m, reason: `${mark}${m.reason}${i}` })) });
const partKeysOf = (kv) => [...kv.data.keys()].filter((k) => k.includes(':part:'));

test('a save that dies before its head leaves the earlier result whole, and the next save sweeps the orphans', async () => {
  const kv = fakeKv();
  let n = 0;
  const cache = createMatchCache(kv, () => T0, () => `gen${++n}`);
  await cache.write(devices, resultWith('A'));
  const realSet = kv.set.bind(kv);
  kv.set = async (key, value) => {
    if (key === MATCH_CACHE_KEY) throw new Error('storage down'); // the parts of the new save are written, its head is not
    return realSet(key, value);
  };
  assert.equal(await cache.write(devices, resultWith('B')), false);
  kv.set = realSet;
  assert.deepEqual((await cache.read(devices)).result, resultWith('A'), 'the earlier result is intact, no piece of B in it');
  assert.ok(!partKeysOf(kv).some((k) => k.includes('gen2')), 'the failed save cleaned up after itself');

  // An orphan that a crash left (the function was cut off before it could clean up) is swept by the next save.
  kv.data.set('cache:matches:part:gen9:0', 'orphan');
  await cache.write(devices, resultWith('C'));
  assert.ok(!kv.data.has('cache:matches:part:gen9:0'));
  assert.deepEqual((await cache.read(devices)).result, resultWith('C'));
  assert.ok(partKeysOf(kv).every((k) => k.startsWith('cache:matches:part:gen3:')), 'only the newest generation is left');
});

test('a reader that already holds the old head when a new save is committed gets nothing, never a mix of the two', async () => {
  const kv = fakeKv();
  let n = 0;
  const cache = createMatchCache(kv, () => T0, () => `gen${++n}`);
  await cache.write(devices, resultWith('A'));
  const oldHead = structuredClone(kv.data.get(MATCH_CACHE_KEY));
  await cache.write(devices, resultWith('B'));
  const realGet = kv.get.bind(kv);
  let first = true;
  kv.get = async (key) => {
    if (key === MATCH_CACHE_KEY && first) {
      first = false;
      return oldHead; // the reader looked at the head just before the new one was written
    }
    return realGet(key);
  };
  assert.equal(await cache.peek(devices), null, 'the old parts are gone: recompute, never a half-and-half result');
  kv.get = realGet;
  assert.deepEqual((await cache.read(devices)).result, resultWith('B'));
});

test('a result saved before generations existed (parts at "...:part:<i>") is still read, and the next save replaces it', async () => {
  const kv = fakeKv();
  const text = JSON.stringify(resultWith('A'));
  const pieces = splitText(text, 20_000);
  pieces.forEach((piece, i) => kv.data.set(`cache:matches:part:${i}`, piece));
  kv.data.set(MATCH_CACHE_KEY, { v: 2, checkedAt: new Date(T0).toISOString(), fingerprint: fingerprintDevices(devices), chunks: pieces.length });
  const cache = createMatchCache(kv, () => T0, () => 'newgen');
  assert.deepEqual((await cache.read(devices)).result, resultWith('A'));
  await cache.write(devices, resultWith('B'));
  assert.deepEqual((await cache.read(devices)).result, resultWith('B'));
  assert.ok(partKeysOf(kv).every((k) => k.startsWith('cache:matches:part:newgen:')), 'the old-style parts were swept');
});

test('a head with a generation that is not a plain token is not trusted', async () => {
  const kv = fakeKv({ [MATCH_CACHE_KEY]: { v: 2, gen: '../x', checkedAt: new Date(T0).toISOString(), fingerprint: fingerprintDevices(devices), chunks: 1 } });
  assert.equal(await createMatchCache(kv, () => T0).peek(devices), null);
});

test('an entry saved the old way (the whole result inline) is still read', async () => {
  const kv = fakeKv({ [MATCH_CACHE_KEY]: { checkedAt: new Date(T0).toISOString(), fingerprint: fingerprintDevices(devices), result } });
  const cache = createMatchCache(kv, () => T0);
  assert.deepEqual((await cache.read(devices)).result, result);
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

// --- Never kept longer than 24 hours --------------------------------------------------------------------

test('the retention limit is 24 hours and longer than the freshness window', () => {
  assert.equal(MAX_RETENTION_HOURS, 24);
  assert.ok(MAX_RETENTION_MS > CACHE_TTL_MS);
});

test('an expired result is still shown as old, up to the retention limit', async () => {
  const kv = fakeKv();
  const clock = { now: T0 };
  const cache = cacheAt(kv, clock);
  await cache.write(devices, result);
  clock.now = T0 + MAX_RETENTION_MS - 1;
  const found = await cache.peek(devices);
  assert.equal(found.fresh, false);
  assert.ok(found.entry);
});

test('at 24 hours the result is gone and is deleted from storage', async () => {
  const kv = fakeKv();
  const clock = { now: T0 };
  const cache = cacheAt(kv, clock);
  await cache.write(devices, result);
  clock.now = T0 + MAX_RETENTION_MS;
  assert.equal(await cache.peek(devices), null);
  assert.equal(await cache.read(devices), null);
  assert.equal(kv.data.has(MATCH_CACHE_KEY), false);
});

test('purgeExpired deletes only a result that is too old or damaged', async () => {
  const kv = fakeKv();
  const clock = { now: T0 };
  const cache = cacheAt(kv, clock);
  assert.equal(await cache.purgeExpired(), false); // nothing saved
  await cache.write(devices, result);
  clock.now = T0 + MAX_RETENTION_MS - 1;
  assert.equal(await cache.purgeExpired(), false);
  assert.equal(kv.data.has(MATCH_CACHE_KEY), true);
  clock.now = T0 + MAX_RETENTION_MS;
  assert.equal(await cache.purgeExpired(), true);
  assert.equal(kv.data.has(MATCH_CACHE_KEY), false);
  kv.data.set(MATCH_CACHE_KEY, 'garbage');
  assert.equal(await cache.purgeExpired(), true);
});

test('the UDI-DI is part of the fingerprint: a changed identifier is a changed device list', () => {
  const plain = { id: 'a', name: 'Pump', type: 'pump', manufacturer: 'ICU Medical', model: 'M1', lotOrSerial: 'S1', ward: 'ICU' };
  assert.notEqual(fingerprintDevices([plain]), fingerprintDevices([{ ...plain, udiDi: '00884838085282' }]));
  assert.notEqual(fingerprintDevices([{ ...plain, udiDi: '00884838085282' }]), fingerprintDevices([{ ...plain, udiDi: '00884838099210' }]));
  assert.equal(fingerprintDevices([plain]), fingerprintDevices([{ ...plain, udiDi: '' }]), 'no identifier and an empty one are the same');
});
