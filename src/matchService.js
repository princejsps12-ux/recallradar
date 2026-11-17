// The recall check as a background job, from every side:
//
//   getSavedMatches   what the panel shows when it opens: the saved result (fresh or expired)
//   requestCheck      the "Check devices" / "Refresh" button: returns AT ONCE, either with a saved
//                     result, or after queueing a background job (the panel then polls)
//   performCheck      the background work itself, run by the queue consumer and the daily trigger
//   getCheckStatus    the panel's polling call: progress, and the result once finished
//
// Why a background job: a Forge UI function is cut off after 25 s, and a first check can take
// longer. The queue consumer may run for minutes, so a click can never time out.
//
// A check with failed lookups is shown but NOT saved to the cache, because saving a partial
// answer would keep showing it for hours.
//
// Everything outside the network and Forge is injected, so every path is unit tested.

// What the panel shows for a result that is not fresh: the old answer plus a flag.
export async function getSavedMatches({ devices, cache }) {
  if (devices.length === 0) return null;
  const found = await cache.peek(devices);
  if (!found) return null;
  return { ...found.entry.result, checkedAt: found.entry.checkedAt, fromCache: true, stale: !found.fresh };
}

// The newest result we have, for features that act on it (creating tasks): the saved result,
// fresh or expired, else the result of the last finished job (which also covers a result that
// had failed lookups and so was never saved). Null if there is none.
export async function getLatestResult({ devices, cache, jobs }) {
  const saved = await getSavedMatches({ devices, cache });
  if (saved) return saved;
  const job = await jobs.current();
  if (!(job && job.status === 'done' && job.result)) return null;
  // The job's copy carries no device fingerprint, so check it against the devices there are NOW: after devices were removed or
  // replaced it must not be used (it would still create tasks and progress for a device that is gone).
  const ids = new Set(devices.map((device) => device.id));
  const result = job.result;
  if (result.deviceCount !== devices.length || !(result.matches || []).every((match) => ids.has(match.deviceId))) return null;
  return result;
}

// Start a check, or say why not. Never waits for the check itself.
//   { state: 'no-devices' }
//   { state: 'saved',   result }   a fresh saved result exists and `refresh` is false
//   { state: 'running', job }      a check is already running, or was just queued
// `enqueue({ jobId, trigger })` puts the work on the queue. If that fails the job is marked
// failed (so nothing looks "running" forever) and the error is passed up.
// Pressing Refresh again right after a check finished is answered with that check: a full check is about 24 openFDA
// requests, openFDA's anonymous allowance is about 1,000 a day shared by everybody behind the same address, and a result
// a minute or two old cannot be improved by asking again. A changed device list has a different fingerprint, so it never
// counts as "just checked".
export const MIN_REFRESH_INTERVAL_MS = 2 * 60 * 1000;

export async function requestCheck({ devices, cache, jobs, enqueue, refresh = false, nowMs = () => Date.now() }) {
  if (devices.length === 0) return { state: 'no-devices' };

  const saved = await cache.read(devices);
  const justChecked = saved && nowMs() - Date.parse(saved.checkedAt) < MIN_REFRESH_INTERVAL_MS;
  if (saved && (!refresh || justChecked)) {
    return {
      state: 'saved',
      result: { ...saved.result, checkedAt: saved.checkedAt, fromCache: true, stale: false },
    };
  }

  const { started, job } = await jobs.start('user');
  if (!started) return { state: 'running', job };

  try {
    await enqueue({ jobId: job.id, trigger: 'user' });
  } catch (error) {
    await jobs.fail(job.id, 'Could not start the check. Please try again.');
    throw error;
  }
  return { state: 'running', job };
}

// The panel's polling call. `result` is set only for a finished job.
export async function getCheckStatus({ jobs }) {
  const job = await jobs.current();
  if (!job) return { job: null, result: null };
  const { result, ...summary } = job;
  return { job: summary, result: job.status === 'done' ? result : null };
}

// The background work. `search(devices, onProgress)` resolves to
//   { deviceCount, recallCount, matches, failedQueries, cappedQueries }.
// With a `jobId` it works on that job (the queue consumer); without one it starts its own (the
// daily trigger) and does nothing if a check is already running. Delivery from a queue is "at
// least once", so a job that is no longer running is skipped. Never throws: a failure is
// recorded on the job. Returns 'done', 'failed' or 'skipped'.
// `afterComplete(result, checkedAt)` (optional) is called with every COMPLETE result (no failed lookups), right after it is saved:
// the daily alerts use it to notice what is new. It can never fail or slow down the check: its errors are swallowed.
export async function performCheck({ devices, search, cache, jobs, trigger, jobId = null, nowMs = () => Date.now(), afterComplete = null }) {
  let id = jobId;
  if (id) {
    const job = await jobs.current();
    if (!job || job.id !== id || job.status !== 'running') return 'skipped';
  } else {
    const { started, job } = await jobs.start(trigger);
    if (!started) return 'skipped';
    id = job.id;
  }

  // Progress writes go one after another so a slow write can never land after the final result.
  let writes = Promise.resolve();
  const onProgress = (done, total) => {
    writes = writes.then(() => jobs.progress(id, done, total)).catch(() => {});
  };

  try {
    const started = nowMs();
    const result = await search(devices, onProgress);
    const elapsedMs = nowMs() - started;
    const checkedAt = new Date(nowMs()).toISOString();
    if (result.failedQueries === 0) {
      await cache.write(devices, result, checkedAt);
      if (afterComplete) {
        try {
          await afterComplete(result, checkedAt);
        } catch (error) {
          // tracking what is new is a side job: it must never fail the check
        }
      }
    }
    await writes;
    const outcome = await jobs.complete(id, { ...result, checkedAt, fromCache: false, stale: false, elapsedMs });
    return outcome || 'skipped';
  } catch (error) {
    await writes;
    await jobs.fail(id, 'Could not check devices against FDA recalls.');
    return 'failed';
  }
}
