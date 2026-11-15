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
import { createConfluenceClient } from './confluenceClient';
import { createTaskGuard, getTaskStates, selectMatches } from './taskService';
import { createPreviewStore } from './agentTools';
import { createTeamGraph } from './teamGraph';
import { createWardTeamStore } from './wardTeams';

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

// Confluence as the person chatting (asUser): their permissions decide where they may write pages.
export const confluenceAsUser = createConfluenceClient({
  request: (path, options) => api.asUser().requestConfluence(path, options),
  route,
});

// Teamwork Graph, READ-ONLY, as the signed-in person (the API has no app-level version). The two
// calls it makes are listed in the README.
export const teamGraph = createTeamGraph({
  request: (query, variables, operationName) => api.asUser().requestTeamworkGraph(query, variables, operationName),
});
export const wardTeams = createWardTeamStore(forgeKv);

// Open RecallRadar tasks per person, for the assignee suggestion. A failure only means "no load
// data": the suggestion then falls back to alphabetical order instead of blocking anything.
export async function openTaskCounts() {
  try {
    return await jiraAsUser.openTaskCounts();
  } catch (error) {
    console.error('Could not count open tasks', error);
    return new Map();
  }
}

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

// "Which of these already have a Jira task?", as the signed-in person. Used by the Confluence pages (to link
// the tasks) and by the agent's answers.
export function taskKeyLookup(snapshot) {
  return async (pairs) => {
    const { matches } = selectMatches(snapshot.result.matches, pairs);
    return getTaskStates({ matches, jira: jiraAsUser, guard: taskGuard });
  };
}

// Housekeeping: delete everything that has outlived its purpose. Previews and task guards after they expire;
// the saved check result and the finished job (which holds a copy of it) after 24 hours. Run by the daily
// trigger before it refreshes the check; reads and writes enforce the same limits on their own.
export async function cleanupStorage() {
  const counts = { previews: 0, guards: 0, cache: 0, job: 0 };
  const steps = [
    ['previews', () => previewStore.purgeExpired()],
    ['guards', () => taskGuard.purgeExpired()],
    ['cache', async () => ((await matchCache.purgeExpired()) ? 1 : 0)],
    ['job', async () => ((await checkJobs.purgeExpired()) ? 1 : 0)],
  ];
  for (const [name, step] of steps) {
    try {
      counts[name] = await step();
    } catch (error) {
      console.error(`Cleanup of ${name} failed`, error);
    }
  }
  return counts;
}
