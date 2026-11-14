// "Check devices for recalls", with saving. Decides between a saved result and a fresh check.
//
//   getMatches(...)         use the saved result if there is a valid one, otherwise run a check
//                           (always run one when `refresh` is true)
//   getCachedMatches(...)   only ever return a saved result; never starts a check
//
// A check that had failed lookups is shown but NOT saved: saving a partial answer would keep
// showing it for hours.
//
// `compute(devices)` runs the real check and resolves to
//   { deviceCount, recallCount, matches, failedQueries, cappedQueries }.
// It is injected so this logic is unit tested without any network.

function emptyResult() {
  return {
    deviceCount: 0,
    recallCount: 0,
    matches: [],
    failedQueries: 0,
    cappedQueries: 0,
    checkedAt: null,
    fromCache: false,
    elapsedMs: 0,
  };
}

export async function getCachedMatches({ devices, cache }) {
  if (devices.length === 0) return null;
  const entry = await cache.read(devices);
  if (!entry) return null;
  return { ...entry.result, checkedAt: entry.checkedAt, fromCache: true, elapsedMs: 0 };
}

export async function getMatches({ devices, cache, compute, refresh = false, nowMs = () => Date.now() }) {
  if (devices.length === 0) return emptyResult();

  if (!refresh) {
    const saved = await getCachedMatches({ devices, cache });
    if (saved) return saved;
  }

  const started = nowMs();
  const result = await compute(devices);
  const elapsedMs = nowMs() - started;
  const checkedAt = new Date(nowMs()).toISOString();

  if (result.failedQueries === 0) {
    await cache.write(devices, result, checkedAt);
  }
  return { ...result, checkedAt, fromCache: false, elapsedMs };
}
