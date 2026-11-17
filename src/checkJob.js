// Tracks the background recall check, so the panel can start it, watch its progress and pick up
// the result, even after the page is reloaded.
//
// One record in Forge storage describes the latest check:
//   { id, status, trigger, startedAt, updatedAt, finishedAt, progress: { done, total },
//     result, error }
//   status:  "running" | "done" | "failed"
//   trigger: "user" (button, or opening the panel on an expired result) | "schedule" (daily)
//
// A check that stops reporting (the function crashed or was cut off) must not look "running"
// forever, so a running record not updated for STALE_JOB_MS counts as failed.
//
// `kv` is any object with get(key), set(key, value) and delete(key) (see kvAdapter.js). There is no atomic
// compare-and-set in Forge storage, so two clicks at the very same moment could both start a
// job; that only costs a duplicate check, and every step is safe to repeat.
// No Forge imports here, so everything is unit tested with plain Node.
import { MAX_RETENTION_MS } from './matchCache.js';
import { createLock } from './lock.js';

export const JOB_KEY = 'job:check';

export const JOB_STATUS = Object.freeze({
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
});

// The background function may run for up to 300 s (timeoutSeconds in the manifest) and reports
// progress after every search. 6 minutes without any update means it is gone.
export const STALE_JOB_MS = 6 * 60 * 1000;

const STALE_MESSAGE = 'The check stopped unexpectedly. Please try again.';
const TOO_LARGE_MESSAGE = 'The result was too large to store.';

// The job record keeps a copy of the finished result only while that fits in ONE storage value (240 KiB at most). A bigger result
// is not copied when it is saved in the cache (the status call then reads it from there); only a big result that could not be saved
// either (it also had failed searches) still ends the job as failed, because nothing could hold it.
export const MAX_JOB_COPY_BYTES = 150 * 1024;

function defaultId(nowMs) {
  return `${nowMs()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createCheckJobs(kv, nowMs = () => Date.now(), makeId = defaultId) {
  const lock = createLock(kv);
  async function load() {
    try {
      const job = await kv.get(JOB_KEY);
      return job && typeof job === 'object' && job.id ? job : null;
    } catch (error) {
      return null;
    }
  }

  // The latest job, with a stuck "running" record reported as failed.
  async function current() {
    const job = await load();
    if (!job) return null;
    if (job.status === JOB_STATUS.RUNNING && nowMs() - job.updatedAt >= STALE_JOB_MS) {
      return { ...job, status: JOB_STATUS.FAILED, error: STALE_MESSAGE, finishedAt: job.updatedAt };
    }
    // A finished job holds a copy of the result, so it obeys the same 24-hour limit as the saved result.
    if (job.status !== JOB_STATUS.RUNNING && isTooOld(job)) {
      await kv.delete(JOB_KEY).catch(() => {});
      return null;
    }
    return job;
  }

  const isTooOld = (job) => {
    const finished = typeof job.finishedAt === 'number' ? job.finishedAt : job.updatedAt;
    return typeof finished !== 'number' || nowMs() - finished >= MAX_RETENTION_MS;
  };

  // Delete a finished job record that is older than MAX_RETENTION_MS. Returns true if deleted.
  async function purgeExpired() {
    const job = await load();
    if (!job || job.status === JOB_STATUS.RUNNING || !isTooOld(job)) return false;
    await kv.delete(JOB_KEY);
    return true;
  }

  // Begin a new job unless one is already running. Returns { started, job }.
  // The check and the write run inside a short lock, so two starts at the same moment cannot both begin a job.
  async function start(trigger) {
    return lock.run('check-job', async () => {
      const existing = await current();
      if (existing && existing.status === JOB_STATUS.RUNNING) {
        return { started: false, job: existing };
      }
      const now = nowMs();
      const job = {
        id: makeId(nowMs),
        status: JOB_STATUS.RUNNING,
        trigger,
        startedAt: now,
        updatedAt: now,
        finishedAt: null,
        progress: { done: 0, total: 0 },
        result: null,
        error: null,
      };
      await kv.set(JOB_KEY, job);
      return { started: true, job };
    });
  }

  // Only the job that is stored AND still running may be changed. A late message from an old
  // or duplicate run can then never overwrite a newer job or a finished result.
  async function updateRunning(jobId, change) {
    const job = await load();
    if (!job || job.id !== jobId || job.status !== JOB_STATUS.RUNNING) return false;
    await kv.set(JOB_KEY, { ...job, ...change(job), updatedAt: nowMs() });
    return true;
  }

  function progress(jobId, done, total) {
    return updateRunning(jobId, () => ({ progress: { done, total } }));
  }

  // Store the finished result. Returns what was recorded: 'done', 'failed' (the result was too
  // large to store) or null (this job is no longer the running one, so nothing was changed).
  async function complete(jobId, result, { inCache = false } = {}) {
    const tooLarge = new TextEncoder().encode(JSON.stringify(result)).length > MAX_JOB_COPY_BYTES;
    if (tooLarge && !inCache) {
      const recorded = await fail(jobId, TOO_LARGE_MESSAGE);
      return recorded ? JOB_STATUS.FAILED : null;
    }
    const recorded = await updateRunning(jobId, (job) => ({
      status: JOB_STATUS.DONE,
      result: tooLarge ? null : result,
      resultInCache: tooLarge,
      error: null,
      finishedAt: nowMs(),
      progress: { done: job.progress.total, total: job.progress.total },
    }));
    return recorded ? JOB_STATUS.DONE : null;
  }

  function fail(jobId, message) {
    return updateRunning(jobId, () => ({ status: JOB_STATUS.FAILED, error: message, finishedAt: nowMs() }));
  }

  return { current, start, progress, complete, fail, purgeExpired };
}
