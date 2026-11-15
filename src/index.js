import Resolver from '@forge/resolver';
import { fetch } from '@forge/api';
import { buildRecallsUrl, parseRecalls, DEFAULT_LIMIT } from './openfda';
import { Queue } from '@forge/events';
import { loadDemoHospital } from './demoHospital';
import { getSavedMatches, requestCheck, getCheckStatus, getLatestResult } from './matchService';
import {
  createTasks,
  getTaskStates,
  validatePairs,
  selectMatches,
  MAX_STATE_PAIRS_PER_REQUEST,
} from './taskService';
import { deviceStore, matchCache, checkJobs, taskGuard, jiraAsUser, CHECK_QUEUE_KEY } from './runtime';

const resolver = new Resolver();
const checkQueue = new Queue({ key: CHECK_QUEUE_KEY });

// Fetch the latest device recalls from openFDA and return them in a small, UI-friendly shape.
export async function getLatestRecalls(limit = DEFAULT_LIMIT) {
  const response = await fetch(buildRecallsUrl(limit), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`openFDA request failed with status ${response.status}`);
  }
  return parseRecalls(await response.json());
}

// Resolver called by the issue panel. Errors are returned (not thrown) so the panel can show them.
resolver.define('fetchRecalls', async () => {
  try {
    return { ok: true, recalls: await getLatestRecalls() };
  } catch (error) {
    console.error('Failed to fetch recalls from openFDA', error);
    return { ok: false, error: 'Could not load recalls from openFDA. Please try again later.' };
  }
});

// The hospital's devices, from Forge storage.
resolver.define('listDevices', async () => {
  try {
    return { ok: true, devices: await deviceStore.listDevices() };
  } catch (error) {
    console.error('Failed to list devices', error);
    return { ok: false, error: 'Could not load the device list.' };
  }
});

// "Load demo hospital": adds the 30 sample devices (replacing only earlier demo devices).
resolver.define('loadDemoHospital', async () => {
  try {
    return { ok: true, count: await loadDemoHospital(deviceStore) };
  } catch (error) {
    console.error('Failed to load demo hospital', error);
    return { ok: false, error: 'Could not load the demo hospital.' };
  }
});

// --- The recall check (runs in the background; see matchService.js) ---------------------------------

// What the panel shows when it opens: the saved result (fresh or expired), if any.
resolver.define('getSavedMatches', async () => {
  try {
    const devices = await deviceStore.listDevices();
    return { ok: true, result: await getSavedMatches({ devices, cache: matchCache }) };
  } catch (error) {
    console.error('Failed to read the saved result', error);
    return { ok: false, error: 'Could not load the saved result.' };
  }
});

// "Check devices" / "Refresh". Returns at once: either a saved result, or the news that a
// background check is running (the panel then polls getCheckStatus).
//   payload.refresh  check again even if a fresh saved result exists
resolver.define('startCheck', async ({ payload }) => {
  try {
    const devices = await deviceStore.listDevices();
    const outcome = await requestCheck({
      devices,
      cache: matchCache,
      jobs: checkJobs,
      enqueue: (message) => checkQueue.push({ body: message }),
      refresh: Boolean(payload && payload.refresh),
    });
    return { ok: true, ...outcome };
  } catch (error) {
    console.error('Failed to start the check', error);
    return { ok: false, error: 'Could not start the check. Please try again.' };
  }
});

// The panel's polling call: progress, and the result once the background check has finished.
resolver.define('getCheckStatus', async () => {
  try {
    return { ok: true, ...(await getCheckStatus({ jobs: checkJobs })) };
  } catch (error) {
    console.error('Failed to read the check status', error);
    return { ok: false, error: 'Could not read the check status.' };
  }
});

// --- Jira tasks for matches (see taskService.js) ---------------------------------------------------------

// Tasks are created in the project of the issue the panel is open on.
function projectKeyFrom(context) {
  const extension = (context && context.extension) || {};
  if (extension.project && extension.project.key) return extension.project.key;
  const issueKey = extension.issue && extension.issue.key;
  return issueKey ? issueKey.slice(0, issueKey.lastIndexOf('-')) : null;
}

// The matches the browser asked about, taken from OUR saved result so nothing is trusted from the page.
async function requestedMatches(pairsFromBrowser, max) {
  const pairs = validatePairs(pairsFromBrowser, max);
  const devices = await deviceStore.listDevices();
  const latest = await getLatestResult({ devices, cache: matchCache, jobs: checkJobs });
  return selectMatches(latest ? latest.matches : [], pairs);
}

// Which of these matches already have a task? Returns { tasks: { "recall|device": "MOBL-12" } }.
resolver.define('getTaskStates', async ({ payload }) => {
  try {
    const { matches } = await requestedMatches(payload && payload.pairs, MAX_STATE_PAIRS_PER_REQUEST);
    return { ok: true, tasks: await getTaskStates({ matches, jira: jiraAsUser, guard: taskGuard }) };
  } catch (error) {
    console.error('Failed to read task states', error);
    return { ok: false, error: 'Could not look up existing tasks.' };
  }
});

// "Create task" / "Create tasks for all": one task per recall + device that does not have one yet.
resolver.define('createTasks', async ({ payload, context }) => {
  try {
    const projectKey = projectKeyFrom(context);
    if (!projectKey) return { ok: false, error: 'Could not tell which project to create tasks in.' };
    const { matches, notFound } = await requestedMatches(payload && payload.pairs);
    const outcome = await createTasks({
      matches,
      jira: jiraAsUser,
      guard: taskGuard,
      projectKey,
      today: new Date(),
    });
    return { ok: true, ...outcome, notFound };
  } catch (error) {
    console.error('Failed to create tasks', error);
    return { ok: false, error: 'Could not create the tasks. Please try again.' };
  }
});

export const handler = resolver.getDefinitions();
