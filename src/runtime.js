// The Forge-specific wiring that the resolvers, the queue consumer and the daily trigger share.
// Everything with real logic lives in the pure modules; this file only connects them to Forge
// storage and to the network.
import { fetch } from '@forge/api';
import { createDeviceStore } from './deviceStore';
import { forgeKv } from './kvAdapter';
import { createMatchCache } from './matchCache';
import { createCheckJobs } from './checkJob';
import { findRecallsForDevices } from './recallSearch';
import { matchDevicesToRecalls } from './matching';
import { performCheck } from './matchService';

export const deviceStore = createDeviceStore(forgeKv);
export const matchCache = createMatchCache(forgeKv);
export const checkJobs = createCheckJobs(forgeKv);

// Name of the queue in manifest.yml (the consumer module listens to the same name).
export const CHECK_QUEUE_KEY = 'recall-check';

// Fetch one openFDA URL as JSON. openFDA answers 404 when a search has no hits: that is
// "no results", not an error.
async function fetchOpenFdaJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 404) return { results: [] };
  if (!response.ok) throw new Error(`openFDA request failed with status ${response.status}`);
  return response.json();
}

// The real search: find recent recalls for the hospital's manufacturers and models, then match
// them to the devices. `onProgress(done, total)` is called as the searches finish.
export async function searchRecalls(devices, onProgress) {
  const { recalls, failedQueries, cappedQueries } = await findRecallsForDevices(devices, fetchOpenFdaJson, {
    onProgress,
  });
  return {
    deviceCount: devices.length,
    recallCount: recalls.length,
    matches: matchDevicesToRecalls(devices, recalls),
    failedQueries,
    cappedQueries,
  };
}

// Run a check for the hospital's current devices. Shared by the queue consumer and the daily
// trigger. Never throws; returns 'done', 'failed' or 'skipped' (or 'no-devices').
export async function runCheck({ trigger, jobId = null }) {
  try {
    const devices = await deviceStore.listDevices();
    if (devices.length === 0) return 'no-devices';
    return await performCheck({
      devices,
      search: searchRecalls,
      cache: matchCache,
      jobs: checkJobs,
      trigger,
      jobId,
    });
  } catch (error) {
    console.error('Recall check failed', error);
    return 'failed';
  }
}
