import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAlertState, ALERT_STATE_KEY, STATE_TTL_MS, NEW_WINDOW_MS, ALERT_WINDOW_MS, FORGET_AFTER_MS } from './alertState.js';
import { fakeKv } from './fakeKv.mjs';

const T0 = Date.UTC(2026, 10, 17, 3, 0, 0);
const HOUR = 3600 * 1000;
function setup() {
  const clock = { now: T0 };
  const kv = fakeKv();
  return { clock, kv, state: createAlertState(kv, () => clock.now) };
}

test('the first look is a baseline: nothing is new, nothing is alerted', async () => {
  const { state } = setup();
  const out = await state.track(['Z-1|d1', 'Z-1|d2']);
  assert.deepEqual(out, { baseline: true, added: [] });
  assert.deepEqual(await state.newSince(), []);
  assert.deepEqual(await state.pendingAlerts(new Set(['Z-1|d1', 'Z-1|d2'])), { due: [], expired: [] });
  assert.equal((await state.overview()).watching, true);
});

test('a pair that appears after the baseline is news: new for 24 hours, then due for the alert', async () => {
  const { state, clock } = setup();
  await state.track(['Z-1|d1']);
  clock.now += 20 * HOUR;
  const out = await state.track(['Z-1|d1', 'Z-2|d1']);
  assert.deepEqual(out, { baseline: false, added: ['Z-2|d1'] });
  assert.deepEqual((await state.newSince()).map((n) => n.pair), ['Z-2|d1']);
  assert.deepEqual((await state.pendingAlerts(new Set(['Z-1|d1', 'Z-2|d1']))).due, ['Z-2|d1'], 'the baseline pair is never alerted');
  clock.now += NEW_WINDOW_MS - 1;
  assert.equal((await state.newSince()).length, 1);
  clock.now += 1;
  assert.deepEqual(await state.newSince(), [], 'after a day it is no longer "new since yesterday"');
});

test('markAlerted: an alerted pair is not due again; news the alert came too late for is "expired", handled without a task', async () => {
  const { state, clock } = setup();
  await state.track(['Z-1|d1']);
  clock.now += HOUR;
  await state.track(['Z-1|d1', 'Z-2|d1', 'Z-3|d1']);
  await state.markAlerted(['Z-2|d1']);
  assert.deepEqual((await state.pendingAlerts(new Set(['Z-2|d1', 'Z-3|d1']))).due, ['Z-3|d1']);
  clock.now += ALERT_WINDOW_MS;
  const later = await state.pendingAlerts(new Set(['Z-2|d1', 'Z-3|d1']));
  assert.deepEqual(later, { due: [], expired: ['Z-3|d1'] });
});

test('due pairs come oldest first, and only the pairs still affected are considered', async () => {
  const { state, clock } = setup();
  await state.track([]);
  clock.now += HOUR;
  await state.track(['Z-B|d1']);
  clock.now += HOUR;
  await state.track(['Z-B|d1', 'Z-A|d1', 'Z-C|d1']);
  assert.deepEqual((await state.pendingAlerts(new Set(['Z-B|d1', 'Z-A|d1']))).due, ['Z-B|d1', 'Z-A|d1'], 'Z-C is no longer affected in this result');
});

test('devices imported (or the demo loaded) are not news: the next look takes their pairs into the baseline', async () => {
  const { state, clock } = setup();
  await state.track(['Z-1|d1']);
  await state.devicesChanged();
  clock.now += HOUR;
  const out = await state.track(['Z-1|d1', 'Z-1|d2', 'Z-2|d2']);
  assert.deepEqual(out, { baseline: true, added: [] });
  assert.deepEqual(await state.newSince(), []);
  assert.deepEqual((await state.pendingAlerts(new Set(['Z-1|d2']))).due, []);
  clock.now += HOUR;
  assert.deepEqual((await state.track(['Z-1|d1', 'Z-1|d2', 'Z-2|d2', 'Z-9|d1'])).added, ['Z-9|d1'], 'the flag is used once: later news is news again');
});

test('devicesChanged before any look does nothing (the first look is a baseline anyway)', async () => {
  const { state, kv } = setup();
  await state.devicesChanged();
  assert.equal(kv.data.has(ALERT_STATE_KEY), false);
});

test('rebaseline (alerts were just switched on): what is affected today is the starting point and is never alerted', async () => {
  const { state, clock } = setup();
  await state.track(['Z-1|d1']);
  clock.now += HOUR;
  await state.track(['Z-1|d1', 'Z-2|d1']); // news found while alerts were off
  await state.rebaseline(['Z-1|d1', 'Z-2|d1', 'Z-3|d1']);
  assert.deepEqual(await state.pendingAlerts(new Set(['Z-1|d1', 'Z-2|d1', 'Z-3|d1'])), { due: [], expired: [] });
  assert.deepEqual((await state.newSince()).map((n) => n.pair), ['Z-2|d1'], 'it still shows as news on the dashboard: only the alert is skipped');
  clock.now += HOUR;
  assert.deepEqual((await state.track(['Z-1|d1', 'Z-2|d1', 'Z-3|d1', 'Z-4|d1'])).added, ['Z-4|d1']);
});

test('a pair that stops being affected is kept for a week, so a search that misses it one day does not raise it again', async () => {
  const { state, clock } = setup();
  await state.track(['Z-1|d1']);
  clock.now += 2 * HOUR;
  await state.track(['Z-2|d1']);
  clock.now += HOUR;
  await state.track(['Z-2|d1']);
  assert.equal((await state.track(['Z-1|d1', 'Z-2|d1'])).added.length, 0, 'Z-1 came back: it was remembered, not new');
  clock.now += FORGET_AFTER_MS - HOUR; // a week without Z-3, but the record is refreshed by other looks
  await state.track(['Z-1|d1']);
  clock.now += 2 * HOUR;
  const out = await state.track(['Z-1|d1', 'Z-2|d1']);
  assert.deepEqual(out.added, ['Z-2|d1'], 'after a week of not being seen, Z-2 is forgotten and returns as news');
});

test('the record is not used, and is deleted, when nobody updated it for a week, or when it is damaged', async () => {
  const { state, kv, clock } = setup();
  await state.track(['Z-1|d1']);
  clock.now += STATE_TTL_MS - 1;
  assert.equal((await state.overview()).watching, true);
  clock.now += 1;
  assert.equal((await state.overview()).watching, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(kv.data.has(ALERT_STATE_KEY), false, 'deleted on read');
  const damaged = setup();
  damaged.kv.data.set(ALERT_STATE_KEY, 'not a record');
  assert.deepEqual(await damaged.state.newSince(), []);
  damaged.kv.data.set(ALERT_STATE_KEY, { v: 1, updatedAt: damaged.clock.now + 60000, pairs: {} });
  assert.equal((await damaged.state.overview()).watching, false, 'a record dated in the future is not trusted');
  // after expiry the next look is a baseline again
  assert.equal((await damaged.state.track(['Z-9|d1'])).baseline, true);
});

test('purgeExpired deletes an old or damaged record, and leaves a fresh one', async () => {
  const { state, kv, clock } = setup();
  assert.equal(await state.purgeExpired(), 0);
  await state.track(['Z-1|d1']);
  assert.equal(await state.purgeExpired(), 0);
  clock.now += STATE_TTL_MS;
  assert.equal(await state.purgeExpired(), 1);
  assert.equal(kv.data.has(ALERT_STATE_KEY), false);
  kv.data.set(ALERT_STATE_KEY, { v: 2 });
  assert.equal(await state.purgeExpired(), 1);
});

test('the record holds ids and times only: no name, no person, no recall text', async () => {
  const { state, kv } = setup();
  await state.track(['Z-1-2026|demo-001']);
  await state.setLast({ at: '2026-11-17T03:00:00.000Z', news: 1, created: ['MOBL-1'], existing: 0, failed: 0, left: 0, comment: 'posted', error: '' });
  const text = JSON.stringify(kv.data.get(ALERT_STATE_KEY));
  assert.ok(text.includes('Z-1-2026|demo-001') && text.includes('MOBL-1'));
  assert.ok(!/accountId|name|email|product|firm/i.test(text), 'nothing but ids, times and issue keys');
});

test('setLast and overview: the last run is kept with the record; clear removes everything', async () => {
  const { state } = setup();
  await state.setLast({ news: 3 });
  assert.equal((await state.overview()).last, null, 'nothing is stored before a first look');
  await state.track([]);
  await state.setLast({ news: 3 });
  assert.deepEqual((await state.overview()).last, { news: 3 });
  await state.clear();
  assert.equal((await state.overview()).watching, false);
});

test('a storage failure never throws out of reading', async () => {
  const kv = { get: async () => { throw new Error('storage down'); }, set: async () => {}, delete: async () => {} };
  const state = createAlertState(kv, () => T0);
  assert.deepEqual(await state.newSince(), []);
  assert.deepEqual(await state.pendingAlerts(new Set(['a|b'])), { due: [], expired: [] });
  assert.equal(await state.purgeExpired(), 0);
});
