import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSavedMatches, requestCheck, getCheckStatus, performCheck } from './matchService.js';
import { createMatchCache, CACHE_TTL_MS, MATCH_CACHE_KEY } from './matchCache.js';
import { createCheckJobs, JOB_KEY, STALE_JOB_MS } from './checkJob.js';
import { fakeKv } from './fakeKv.mjs';

const devices = [
  { id: 'a', name: 'A', type: 'pump', manufacturer: 'ICU Medical', model: '400020401', lotOrSerial: '1', ward: 'ICU' },
];
const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);

const found = (extra = {}) => ({
  deviceCount: 1,
  recallCount: 3,
  matches: [{ deviceId: 'a' }],
  failedQueries: 0,
  cappedQueries: 0,
  ...extra,
});

// Everything wired to one fake storage and one clock. `search` reports progress like the real one.
function setup({ result = found(), enqueueError = null } = {}) {
  const kv = fakeKv();
  const clock = { now: T0 };
  const nowMs = () => clock.now;
  const cache = createMatchCache(kv, nowMs);
  let n = 0;
  const jobs = createCheckJobs(kv, nowMs, () => `job-${++n}`);
  const state = { searchCalls: 0, queued: [] };
  const search = async (_devices, onProgress) => {
    state.searchCalls += 1;
    onProgress(0, 4);
    onProgress(2, 4);
    onProgress(4, 4);
    clock.now += 1500;
    return result;
  };
  const enqueue = async (message) => {
    if (enqueueError) throw enqueueError;
    state.queued.push(message);
  };
  return { kv, clock, nowMs, cache, jobs, state, search, enqueue };
}

// --- requestCheck ------------------------------------------------------------------------------------

test('requestCheck with no devices does nothing', async () => {
  const { cache, jobs, enqueue, state } = setup();
  assert.deepEqual(await requestCheck({ devices: [], cache, jobs, enqueue }), { state: 'no-devices' });
  assert.equal(state.queued.length, 0);
});

test('requestCheck queues a background job and returns at once', async () => {
  const { cache, jobs, enqueue, state } = setup();
  const out = await requestCheck({ devices, cache, jobs, enqueue });
  assert.equal(out.state, 'running');
  assert.equal(out.job.id, 'job-1');
  assert.deepEqual(state.queued, [{ jobId: 'job-1', trigger: 'user' }]);
  assert.equal(state.searchCalls, 0); // the work happens elsewhere
});

test('requestCheck returns a fresh saved result without queueing anything', async () => {
  const s = setup();
  await s.cache.write(devices, found(), new Date(T0).toISOString());
  const out = await requestCheck({ devices, cache: s.cache, jobs: s.jobs, enqueue: s.enqueue });
  assert.equal(out.state, 'saved');
  assert.equal(out.result.fromCache, true);
  assert.equal(out.result.stale, false);
  assert.equal(out.result.recallCount, 3);
  assert.equal(s.state.queued.length, 0);
});

test('requestCheck with refresh ignores a fresh saved result and queues a job', async () => {
  const s = setup();
  await s.cache.write(devices, found(), new Date(T0).toISOString());
  const out = await requestCheck({ devices, cache: s.cache, jobs: s.jobs, enqueue: s.enqueue, refresh: true });
  assert.equal(out.state, 'running');
  assert.equal(s.state.queued.length, 1);
});

test('requestCheck queues a job when the saved result has expired', async () => {
  const s = setup();
  await s.cache.write(devices, found(), new Date(T0).toISOString());
  s.clock.now = T0 + CACHE_TTL_MS;
  const out = await requestCheck({ devices, cache: s.cache, jobs: s.jobs, enqueue: s.enqueue });
  assert.equal(out.state, 'running');
});

test('requestCheck joins a check that is already running instead of starting another', async () => {
  const s = setup();
  const first = await requestCheck({ devices, cache: s.cache, jobs: s.jobs, enqueue: s.enqueue });
  const second = await requestCheck({ devices, cache: s.cache, jobs: s.jobs, enqueue: s.enqueue, refresh: true });
  assert.equal(second.state, 'running');
  assert.equal(second.job.id, first.job.id);
  assert.equal(s.state.queued.length, 1);
});

test('requestCheck marks the job failed and rethrows if queueing fails', async () => {
  const s = setup({ enqueueError: new Error('queue down') });
  await assert.rejects(requestCheck({ devices, cache: s.cache, jobs: s.jobs, enqueue: s.enqueue }), /queue down/);
  const job = await s.jobs.current();
  assert.equal(job.status, 'failed');
  // ... so the next click can try again instead of waiting for a job that never started.
  const retry = await s.jobs.start('user');
  assert.equal(retry.started, true);
});

// --- performCheck ------------------------------------------------------------------------------------

test('performCheck runs the search, records progress, saves the result and finishes the job', async () => {
  const s = setup();
  const { job } = await s.jobs.start('user');
  const outcome = await performCheck({ devices, search: s.search, cache: s.cache, jobs: s.jobs, trigger: 'user', jobId: job.id, nowMs: s.nowMs });
  assert.equal(outcome, 'done');
  const done = await s.jobs.current();
  assert.equal(done.status, 'done');
  assert.equal(done.result.recallCount, 3);
  assert.equal(done.result.fromCache, false);
  assert.equal(done.result.elapsedMs, 1500);
  assert.deepEqual(done.progress, { done: 4, total: 4 });
  assert.ok(Number.isFinite(Date.parse(done.result.checkedAt)));
  assert.ok(await s.cache.read(devices)); // saved for the next 6 hours
});

test('performCheck does not save a result that had failed lookups, but still shows it', async () => {
  const s = setup({ result: found({ failedQueries: 2 }) });
  const { job } = await s.jobs.start('user');
  await performCheck({ devices, search: s.search, cache: s.cache, jobs: s.jobs, trigger: 'user', jobId: job.id, nowMs: s.nowMs });
  assert.equal(s.kv.data.has(MATCH_CACHE_KEY), false);
  const done = await s.jobs.current();
  assert.equal(done.status, 'done');
  assert.equal(done.result.failedQueries, 2);
});

test('performCheck without a job id starts its own (the daily trigger)', async () => {
  const s = setup();
  const outcome = await performCheck({ devices, search: s.search, cache: s.cache, jobs: s.jobs, trigger: 'schedule', nowMs: s.nowMs });
  assert.equal(outcome, 'done');
  const done = await s.jobs.current();
  assert.equal(done.trigger, 'schedule');
  assert.equal(done.status, 'done');
});

test('performCheck without a job id does nothing while a check is already running', async () => {
  const s = setup();
  await s.jobs.start('user');
  const outcome = await performCheck({ devices, search: s.search, cache: s.cache, jobs: s.jobs, trigger: 'schedule', nowMs: s.nowMs });
  assert.equal(outcome, 'skipped');
  assert.equal(s.state.searchCalls, 0);
});

test('performCheck skips a job that is already finished (a duplicate queue delivery)', async () => {
  const s = setup();
  const { job } = await s.jobs.start('user');
  const args = { devices, search: s.search, cache: s.cache, jobs: s.jobs, trigger: 'user', jobId: job.id, nowMs: s.nowMs };
  assert.equal(await performCheck(args), 'done');
  assert.equal(await performCheck(args), 'skipped');
  assert.equal(s.state.searchCalls, 1);
});

test('performCheck skips a job id that is not the current job', async () => {
  const s = setup();
  await s.jobs.start('user');
  const outcome = await performCheck({ devices, search: s.search, cache: s.cache, jobs: s.jobs, trigger: 'user', jobId: 'someone-else', nowMs: s.nowMs });
  assert.equal(outcome, 'skipped');
  assert.equal(s.state.searchCalls, 0);
});

test('performCheck records a failure instead of throwing when the search throws', async () => {
  const s = setup();
  const { job } = await s.jobs.start('user');
  const search = async () => {
    throw new Error('openFDA exploded');
  };
  const outcome = await performCheck({ devices, search, cache: s.cache, jobs: s.jobs, trigger: 'user', jobId: job.id, nowMs: s.nowMs });
  assert.equal(outcome, 'failed');
  const failed = await s.jobs.current();
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /Could not check/);
  assert.equal(s.kv.data.has(MATCH_CACHE_KEY), false);
});

test('a failed check leaves the previous saved result in place', async () => {
  const s = setup();
  await s.cache.write(devices, found({ recallCount: 99 }), new Date(T0).toISOString());
  const { job } = await s.jobs.start('user');
  await performCheck({ devices, search: async () => { throw new Error('x'); }, cache: s.cache, jobs: s.jobs, trigger: 'user', jobId: job.id, nowMs: s.nowMs });
  assert.equal((await s.cache.peek(devices)).entry.result.recallCount, 99);
});

test('a result too large for the job record is reported as a failure', async () => {
  const s = setup({ result: found({ matches: ['x'.repeat(250 * 1024)] }) });
  const { job } = await s.jobs.start('user');
  const outcome = await performCheck({ devices, search: s.search, cache: s.cache, jobs: s.jobs, trigger: 'user', jobId: job.id, nowMs: s.nowMs });
  assert.equal(outcome, 'failed');
  assert.match((await s.jobs.current()).error, /too large/);
});

test('progress is written in order and the final result is never overwritten by a late progress write', async () => {
  const s = setup();
  const { job } = await s.jobs.start('user');
  const writes = [];
  const jobs = {
    ...s.jobs,
    progress: async (id, done, total) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      writes.push(done);
      return s.jobs.progress(id, done, total);
    },
  };
  await performCheck({ devices, search: s.search, cache: s.cache, jobs, trigger: 'user', jobId: job.id, nowMs: s.nowMs });
  assert.deepEqual(writes, [0, 2, 4]);
  assert.equal((await s.jobs.current()).status, 'done');
});

// --- getCheckStatus ----------------------------------------------------------------------------------

test('getCheckStatus before any check', async () => {
  assert.deepEqual(await getCheckStatus({ jobs: setup().jobs }), { job: null, result: null });
});

test('getCheckStatus while running gives progress and no result', async () => {
  const s = setup();
  const { job } = await s.jobs.start('user');
  await s.jobs.progress(job.id, 9, 24);
  const out = await getCheckStatus({ jobs: s.jobs });
  assert.equal(out.job.status, 'running');
  assert.deepEqual(out.job.progress, { done: 9, total: 24 });
  assert.equal(out.result, null);
  assert.equal('result' in out.job, false); // the big result is never sent with a status line
});

test('getCheckStatus after a finished check gives the result', async () => {
  const s = setup();
  const { job } = await s.jobs.start('user');
  await performCheck({ devices, search: s.search, cache: s.cache, jobs: s.jobs, trigger: 'user', jobId: job.id, nowMs: s.nowMs });
  const out = await getCheckStatus({ jobs: s.jobs });
  assert.equal(out.job.status, 'done');
  assert.equal(out.result.recallCount, 3);
});

test('getCheckStatus after a failed check gives the error and no result', async () => {
  const s = setup();
  const { job } = await s.jobs.start('user');
  await s.jobs.fail(job.id, 'nope');
  const out = await getCheckStatus({ jobs: s.jobs });
  assert.equal(out.job.status, 'failed');
  assert.equal(out.job.error, 'nope');
  assert.equal(out.result, null);
});

test('getCheckStatus reports a job that stopped reporting as failed', async () => {
  const s = setup();
  await s.jobs.start('user');
  s.clock.now = T0 + STALE_JOB_MS;
  assert.equal((await getCheckStatus({ jobs: s.jobs })).job.status, 'failed');
});

// --- getSavedMatches ---------------------------------------------------------------------------------

test('getSavedMatches is null with nothing saved or no devices', async () => {
  const s = setup();
  assert.equal(await getSavedMatches({ devices, cache: s.cache }), null);
  assert.equal(await getSavedMatches({ devices: [], cache: s.cache }), null);
});

test('getSavedMatches returns a fresh result marked not stale', async () => {
  const s = setup();
  await s.cache.write(devices, found(), new Date(T0).toISOString());
  const out = await getSavedMatches({ devices, cache: s.cache });
  assert.equal(out.fromCache, true);
  assert.equal(out.stale, false);
  assert.equal(out.recallCount, 3);
});

test('getSavedMatches still returns an expired result, marked stale, so the panel is never empty', async () => {
  const s = setup();
  await s.cache.write(devices, found(), new Date(T0).toISOString());
  s.clock.now = T0 + CACHE_TTL_MS + 1;
  const out = await getSavedMatches({ devices, cache: s.cache });
  assert.equal(out.stale, true);
  assert.equal(out.recallCount, 3);
  assert.equal(out.checkedAt, new Date(T0).toISOString());
});

test('getSavedMatches never shows a result for a different device list', async () => {
  const s = setup();
  await s.cache.write(devices, found(), new Date(T0).toISOString());
  assert.equal(await getSavedMatches({ devices: [...devices, { ...devices[0], id: 'b' }], cache: s.cache }), null);
});

test('damaged job data does not break requestCheck', async () => {
  const s = setup();
  s.kv.data.set(JOB_KEY, 'garbage');
  const out = await requestCheck({ devices, cache: s.cache, jobs: s.jobs, enqueue: s.enqueue });
  assert.equal(out.state, 'running');
});
