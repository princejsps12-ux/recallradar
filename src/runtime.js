// The Forge-specific wiring that the resolvers, the queue consumer and the daily trigger share.
// Everything with real logic lives in the pure modules; this file only connects them to Forge
// storage and to the network.
import api, { fetch, route } from '@forge/api';
import { createDeviceStore } from './deviceStore';
import { forgeKv } from './kvAdapter';
import { createMatchCache } from './matchCache';
import { createCheckJobs } from './checkJob';
import { findRecallsForDevices, buildRecallDetails } from './recallSearch';
import { matchDevicesToRecalls } from './matching';
import { performCheck, getLatestResult } from './matchService';
import { createJiraClient } from './jiraClient';
import { createTaskGuard } from './taskService';
import { createPreviewStore } from './agentTools';

export const deviceStore = createDeviceStore(forgeKv);
export const matchCache = createMatchCache(forgeKv);
export const checkJobs = createCheckJobs(forgeKv);
export const taskGuard = createTaskGuard(forgeKv);
export const previewStore = createPreviewStore(forgeKv);

// Jira as the person who clicked (asUser), so Jira applies THEIR permissions: someone who may not
// create issues simply gets an error. Never asApp for this.
export const jiraAsUser = createJiraClient({
  request: (path, options) => api.asUser().requestJira(path, options),
  route,
});

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
  const matches = matchDevicesToRecalls(devices, recalls);
  return {
    deviceCount: devices.length,
    recallCount: recalls.length,
    matches,
    recallDetails: buildRecallDetails(recalls, matches),
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

// What the Rovo agent works from: the hospital's devices and the latest SAVED check result (fresh or
// expired, or the last finished job). It never starts a check and never calls openFDA.
export async function loadSnapshot() {
  const devices = await deviceStore.listDevices();
  const result = devices.length ? await getLatestResult({ devices, cache: matchCache, jobs: checkJobs }) : null;
  return { devices, result };
}
