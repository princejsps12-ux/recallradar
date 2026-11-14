import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMatches, getCachedMatches } from './matchService.js';
import { createMatchCache, MATCH_CACHE_KEY } from './matchCache.js';
import { fakeKv } from './fakeKv.mjs';

const devices = [
  { id: 'a', name: 'A', type: 'pump', manufacturer: 'ICU Medical', model: '400020401', lotOrSerial: '1', ward: 'ICU' },
];
const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);

const computed = (extra = {}) => ({
  deviceCount: 1,
  recallCount: 3,
  matches: [{ deviceId: 'a' }],
  failedQueries: 0,
  cappedQueries: 0,
  ...extra,
});

// A compute function that counts its calls, and a clock that advances 1.5 s per call to now().
function setup({ result = computed(), kv = fakeKv() } = {}) {
  const clock = { now: T0 };
  const nowMs = () => {
    const value = clock.now;
    clock.now += 1500;
    return value;
  };
  const state = { computeCalls: 0 };
  const compute = async () => {
    state.computeCalls += 1;
    return result;
  };
  const cache = createMatchCache(kv, () => clock.now);
  return { clock, nowMs, state, compute, cache, kv };
}

test('the first check runs the real check, stamps the time and reports how long it took', async () => {
  const { nowMs, state, compute, cache } = setup();
  const out = await getMatches({ devices, cache, compute, nowMs });
  assert.equal(state.computeCalls, 1);
  assert.equal(out.fromCache, false);
  assert.equal(out.elapsedMs, 1500);
  assert.equal(out.recallCount, 3);
  assert.ok(Number.isFinite(Date.parse(out.checkedAt)));
});

test('a second check uses the saved result and does not run the real check again', async () => {
  const { nowMs, state, compute, cache } = setup();
  await getMatches({ devices, cache, compute, nowMs });
  const again = await getMatches({ devices, cache, compute, nowMs });
  assert.equal(state.computeCalls, 1);
  assert.equal(again.fromCache, true);
  assert.equal(again.elapsedMs, 0);
  assert.equal(again.recallCount, 3);
});

test('the saved result keeps the original checked-at time', async () => {
  const { nowMs, compute, cache } = setup();
  const first = await getMatches({ devices, cache, compute, nowMs });
  const second = await getMatches({ devices, cache, compute, nowMs });
  assert.equal(second.checkedAt, first.checkedAt);
});

test('refresh runs the real check even though a result is saved, and saves the new one', async () => {
  const { nowMs, state, compute, cache } = setup();
  await getMatches({ devices, cache, compute, nowMs });
  const refreshed = await getMatches({ devices, cache, compute, nowMs, refresh: true });
  assert.equal(state.computeCalls, 2);
  assert.equal(refreshed.fromCache, false);
  const next = await getMatches({ devices, cache, compute, nowMs });
  assert.equal(next.fromCache, true);
  assert.equal(next.checkedAt, refreshed.checkedAt);
});

test('changing the devices makes the saved result unusable', async () => {
  const { nowMs, state, compute, cache } = setup();
  await getMatches({ devices, cache, compute, nowMs });
  await getMatches({ devices: [...devices, { ...devices[0], id: 'b' }], cache, compute, nowMs });
  assert.equal(state.computeCalls, 2);
});

test('an expired saved result is replaced by a new check', async () => {
  const { clock, nowMs, state, compute, cache } = setup();
  await getMatches({ devices, cache, compute, nowMs });
  clock.now += 7 * 60 * 60 * 1000; // seven hours later
  const out = await getMatches({ devices, cache, compute, nowMs });
  assert.equal(state.computeCalls, 2);
  assert.equal(out.fromCache, false);
});

test('a check with failed lookups is shown but not saved', async () => {
  const { nowMs, state, compute, cache, kv } = setup({ result: computed({ failedQueries: 2 }) });
  const out = await getMatches({ devices, cache, compute, nowMs });
  assert.equal(out.failedQueries, 2);
  assert.equal(kv.data.has(MATCH_CACHE_KEY), false);
  await getMatches({ devices, cache, compute, nowMs });
  assert.equal(state.computeCalls, 2); // checked again because nothing was saved
});

test('a check that hit the search cap is still saved (capping is not a failure)', async () => {
  const { nowMs, compute, cache, kv } = setup({ result: computed({ cappedQueries: 5 }) });
  const out = await getMatches({ devices, cache, compute, nowMs });
  assert.equal(out.cappedQueries, 5);
  assert.equal(kv.data.has(MATCH_CACHE_KEY), true);
});

test('no devices: returns an empty result without checking or saving anything', async () => {
  const { nowMs, state, compute, cache, kv } = setup();
  const out = await getMatches({ devices: [], cache, compute, nowMs });
  assert.equal(state.computeCalls, 0);
  assert.equal(kv.data.size, 0);
  assert.equal(out.deviceCount, 0);
  assert.deepEqual(out.matches, []);
  assert.equal(out.checkedAt, null);
});

test('a failure to save does not fail the check', async () => {
  const kv = fakeKv();
  kv.set = async () => {
    throw new Error('storage down');
  };
  const { nowMs, compute, cache } = setup({ kv });
  const out = await getMatches({ devices, cache, compute, nowMs });
  assert.equal(out.recallCount, 3);
  assert.equal(out.fromCache, false);
});

test('an error in the real check is passed up (the caller reports it)', async () => {
  const { nowMs, cache } = setup();
  await assert.rejects(
    getMatches({ devices, cache, compute: async () => { throw new Error('boom'); }, nowMs }),
    /boom/,
  );
});

test('getCachedMatches returns only a saved result and never starts a check', async () => {
  const { nowMs, state, compute, cache } = setup();
  assert.equal(await getCachedMatches({ devices, cache }), null);
  assert.equal(state.computeCalls, 0);
  await getMatches({ devices, cache, compute, nowMs });
  const saved = await getCachedMatches({ devices, cache });
  assert.equal(saved.fromCache, true);
  assert.equal(saved.recallCount, 3);
  assert.equal(state.computeCalls, 1);
});

test('getCachedMatches returns null for an empty hospital', async () => {
  const { cache } = setup();
  assert.equal(await getCachedMatches({ devices: [], cache }), null);
});
