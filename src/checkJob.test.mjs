import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOB_KEY, JOB_STATUS, STALE_JOB_MS, MAX_JOB_COPY_BYTES, createCheckJobs } from './checkJob.js';
import { MAX_RETENTION_MS } from './matchCache.js';
import { fakeKv } from './fakeKv.mjs';

const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);

// A job tracker with a controllable clock and predictable ids.
function setup(kv = fakeKv()) {
  const clock = { now: T0 };
  let n = 0;
  const jobs = createCheckJobs(kv, () => clock.now, () => `job-${++n}`);
  return { clock, jobs, kv };
}

test('there is no job at first', async () => {
  assert.equal(await setup().jobs.current(), null);
});

test('start creates a running job with empty progress', async () => {
  const { jobs, kv } = setup();
  const { started, job } = await jobs.start('user');
  assert.equal(started, true);
  assert.equal(job.id, 'job-1');
  assert.equal(job.status, JOB_STATUS.RUNNING);
  assert.equal(job.trigger, 'user');
  assert.deepEqual(job.progress, { done: 0, total: 0 });
  assert.equal(job.startedAt, T0);
  assert.deepEqual(await kv.get(JOB_KEY), job);
});

test('start does not begin a second job while one is running', async () => {
  const { jobs } = setup();
  const first = await jobs.start('user');
  const second = await jobs.start('schedule');
  assert.equal(second.started, false);
  assert.equal(second.job.id, first.job.id);
});

test('progress updates the running job and bumps its last-update time', async () => {
  const { clock, jobs } = setup();
  const { job } = await jobs.start('user');
  clock.now = T0 + 5000;
  assert.equal(await jobs.progress(job.id, 7, 24), true);
  const now = await jobs.current();
  assert.deepEqual(now.progress, { done: 7, total: 24 });
  assert.equal(now.updatedAt, T0 + 5000);
  assert.equal(now.startedAt, T0);
});

test('complete stores the result, finishes the job and fills the progress bar', async () => {
  const { jobs } = setup();
  const { job } = await jobs.start('user');
  await jobs.progress(job.id, 20, 24);
  assert.equal(await jobs.complete(job.id, { recallCount: 5 }), 'done');
  const done = await jobs.current();
  assert.equal(done.status, JOB_STATUS.DONE);
  assert.deepEqual(done.result, { recallCount: 5 });
  assert.deepEqual(done.progress, { done: 24, total: 24 });
  assert.equal(done.error, null);
  assert.ok(done.finishedAt);
});

test('fail records the message and finishes the job', async () => {
  const { jobs } = setup();
  const { job } = await jobs.start('user');
  assert.equal(await jobs.fail(job.id, 'boom'), true);
  const failed = await jobs.current();
  assert.equal(failed.status, JOB_STATUS.FAILED);
  assert.equal(failed.error, 'boom');
});

test('a finished job lets a new one start', async () => {
  const { jobs } = setup();
  const first = await jobs.start('user');
  await jobs.complete(first.job.id, {});
  const second = await jobs.start('user');
  assert.equal(second.started, true);
  assert.equal(second.job.id, 'job-2');
});

test('a failed job lets a new one start', async () => {
  const { jobs } = setup();
  const first = await jobs.start('user');
  await jobs.fail(first.job.id, 'x');
  assert.equal((await jobs.start('user')).started, true);
});

test('a finished job cannot be changed by a late or duplicate message', async () => {
  const { jobs } = setup();
  const { job } = await jobs.start('user');
  await jobs.complete(job.id, { recallCount: 1 });
  assert.equal(await jobs.progress(job.id, 3, 24), false);
  assert.equal(await jobs.fail(job.id, 'late'), false);
  assert.equal(await jobs.complete(job.id, { recallCount: 2 }), null);
  const now = await jobs.current();
  assert.equal(now.status, JOB_STATUS.DONE);
  assert.deepEqual(now.result, { recallCount: 1 });
});

test('a message for an older job never touches a newer one', async () => {
  const { jobs } = setup();
  const first = await jobs.start('user');
  await jobs.fail(first.job.id, 'x');
  const second = await jobs.start('user');
  assert.equal(await jobs.progress(first.job.id, 9, 24), false);
  assert.equal(await jobs.complete(first.job.id, {}), null);
  const now = await jobs.current();
  assert.equal(now.id, second.job.id);
  assert.equal(now.status, JOB_STATUS.RUNNING);
  assert.deepEqual(now.progress, { done: 0, total: 0 });
});

test('a job that has stopped reporting counts as failed once it is stale', async () => {
  const { clock, jobs } = setup();
  await jobs.start('user');
  clock.now = T0 + STALE_JOB_MS - 1;
  assert.equal((await jobs.current()).status, JOB_STATUS.RUNNING);
  clock.now = T0 + STALE_JOB_MS;
  const stale = await jobs.current();
  assert.equal(stale.status, JOB_STATUS.FAILED);
  assert.match(stale.error, /stopped unexpectedly/);
});

test('progress keeps a long job from going stale', async () => {
  const { clock, jobs } = setup();
  const { job } = await jobs.start('user');
  clock.now = T0 + STALE_JOB_MS - 1000;
  await jobs.progress(job.id, 5, 24);
  clock.now = T0 + STALE_JOB_MS + 5000; // past the original deadline, but updated 6 s ago
  assert.equal((await jobs.current()).status, JOB_STATUS.RUNNING);
});

test('a stale job lets a new one start, and the new job replaces it', async () => {
  const { clock, jobs } = setup();
  await jobs.start('user');
  clock.now = T0 + STALE_JOB_MS;
  const second = await jobs.start('user');
  assert.equal(second.started, true);
  assert.equal((await jobs.current()).id, second.job.id);
});

test('the stale time is six minutes, one minute beyond the 300 s background limit', () => {
  assert.equal(STALE_JOB_MS, 6 * 60 * 1000);
});

test('a result too large to store is recorded as a failure, not lost silently', async () => {
  const { jobs } = setup();
  const { job } = await jobs.start('user');
  const huge = { matches: ['x'.repeat(MAX_JOB_COPY_BYTES + 10)] };
  assert.equal(await jobs.complete(job.id, huge), 'failed');
  const now = await jobs.current();
  assert.equal(now.status, JOB_STATUS.FAILED);
  assert.match(now.error, /too large/);
});

test('a big result that is saved elsewhere ends the job as done, without a copy, and says where it is', async () => {
  const { jobs } = setup();
  const { job } = await jobs.start('user');
  const huge = { matches: ['x'.repeat(MAX_JOB_COPY_BYTES + 10)] };
  assert.equal(await jobs.complete(job.id, huge, { inCache: true }), 'done');
  const now = await jobs.current();
  assert.equal(now.status, JOB_STATUS.DONE);
  assert.equal(now.result, null);
  assert.equal(now.resultInCache, true);
});

test('damaged stored data is treated as no job', async () => {
  for (const bad of ['text', 42, {}, { status: 'running' }]) {
    const { jobs } = setup(fakeKv({ [JOB_KEY]: bad }));
    assert.equal(await jobs.current(), null, JSON.stringify(bad));
  }
});

test('a storage error while reading is treated as no job', async () => {
  const kv = fakeKv();
  kv.get = async () => {
    throw new Error('storage down');
  };
  assert.equal(await setup(kv).jobs.current(), null);
});

// --- A finished job holds a copy of the result, so it is kept at most 24 hours ----------------------------------

async function finishedJob() {
  const s = setup();
  const { job } = await s.jobs.start('user');
  await s.jobs.complete(job.id, { matches: [] });
  return s;
}

test('a finished job is returned until 24 hours after it finished', async () => {
  const s = await finishedJob();
  s.clock.now += MAX_RETENTION_MS - 1;
  assert.equal((await s.jobs.current()).status, JOB_STATUS.DONE);
});

test('after 24 hours the finished job (and its result) is gone and deleted', async () => {
  const s = await finishedJob();
  s.clock.now += MAX_RETENTION_MS;
  assert.equal(await s.jobs.current(), null);
  assert.equal(s.kv.data.has(JOB_KEY), false);
});

test('a failed job also goes after 24 hours', async () => {
  const s = setup();
  const { job } = await s.jobs.start('user');
  await s.jobs.fail(job.id, 'boom');
  s.clock.now += MAX_RETENTION_MS;
  assert.equal(await s.jobs.current(), null);
});

test('a running job is never deleted by the retention rule', async () => {
  const s = setup();
  await s.jobs.start('user');
  assert.equal(await s.jobs.purgeExpired(), false);
});

test('purgeExpired deletes an old finished job and keeps a recent one', async () => {
  const s = await finishedJob();
  assert.equal(await s.jobs.purgeExpired(), false);
  s.clock.now += MAX_RETENTION_MS;
  assert.equal(await s.jobs.purgeExpired(), true);
  assert.equal(s.kv.data.has(JOB_KEY), false);
});

test('two starts at the same moment begin ONE job', async () => {
  const kv = fakeKv();
  const jobs = createCheckJobs(kv, () => 1_700_000_000_000);
  const [a, b] = await Promise.all([jobs.start('user'), jobs.start('schedule')]);
  assert.equal([a, b].filter((r) => r.started).length, 1);
  assert.equal(a.job.id === b.job.id, true, 'the second one joins the first');
});

