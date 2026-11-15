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
import { assigneesForMatches, checkExplicitAssignees, setWardTeam } from './teamService';
import { createRecallPages } from './recallPageService';
import {
  deviceStore,
  matchCache,
  checkJobs,
  taskGuard,
  jiraAsUser,
  teamGraph,
  wardTeams,
  openTaskCounts,
  loadSnapshot,
  confluenceAsUser,
  taskKeyLookup,
  CHECK_QUEUE_KEY,
} from './runtime';

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
//   payload.assignees  optional { "recall|device": accountId } the person agreed to. Each one is
//                      re-checked against the ward's team in the Teamwork Graph, so a forged request
//                      cannot assign anybody else. Nobody is assigned unless the panel asked.
resolver.define('createTasks', async ({ payload, context }) => {
  try {
    const projectKey = projectKeyFrom(context);
    if (!projectKey) return { ok: false, error: 'Could not tell which project to create tasks in.' };
    const { matches, notFound } = await requestedMatches(payload && payload.pairs);
    let assignees = new Map();
    let assignRefused = [];
    let assignError = null;
    if (payload && payload.assignees && Object.keys(payload.assignees).length > 0) {
      try {
        ({ assignees, refused: assignRefused } = await checkExplicitAssignees({
          explicit: payload.assignees,
          matches,
          store: wardTeams,
          graph: teamGraph,
        }));
      } catch (error) {
        // The graph is down: still create the tasks, unassigned, and say so.
        console.error('Could not check assignees', error);
        assignError = 'The Teamwork Graph could not be reached, so the tasks were created without an assignee.';
      }
    }
    const outcome = await createTasks({
      matches,
      jira: jiraAsUser,
      guard: taskGuard,
      projectKey,
      today: new Date(),
      assignees,
    });
    const assignedTo = {};
    for (const { pair } of outcome.created) if (assignees.has(pair)) assignedTo[pair] = assignees.get(pair).name;
    return { ok: true, ...outcome, notFound, assignedTo, assignRefused, assignError };
  } catch (error) {
    console.error('Failed to create tasks', error);
    return { ok: false, error: 'Could not create the tasks. Please try again.' };
  }
});

// --- Ward teams (Teamwork Graph, read-only; see teamService.js) -------------------------------------------

// The saved ward-to-team mappings, plus the wards found in the device list. Storage only: no graph call,
// so the panel can show "Team: ICU (from Teamwork Graph)" on every open.
resolver.define('getWardTeams', async () => {
  try {
    const devices = await deviceStore.listDevices();
    const wards = [...new Set(devices.map((d) => d.ward).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return { ok: true, mappings: await wardTeams.list(), wards };
  } catch (error) {
    console.error('Failed to read ward teams', error);
    return { ok: false, error: 'Could not load the ward teams.' };
  }
});

// Teamwork Graph call 1: the teams the signed-in person belongs to, for the mapping dropdown.
resolver.define('listTeams', async ({ context }) => {
  try {
    return { ok: true, teams: await teamGraph.listTeams(context.accountId) };
  } catch (error) {
    console.error('Failed to read teams from the Teamwork Graph', error);
    return { ok: false, error: 'Could not read teams from the Teamwork Graph.' };
  }
});

// Save (or, with an empty teamAri, remove) one ward's team. The server checks the team in the graph.
resolver.define('setWardTeam', async ({ payload, context }) => {
  try {
    const ward = payload && typeof payload.ward === 'string' ? payload.ward : '';
    const teamAri = payload && typeof payload.teamAri === 'string' && payload.teamAri ? payload.teamAri : null;
    return await setWardTeam({ ward, teamAri, accountId: context.accountId, graph: teamGraph, store: wardTeams });
  } catch (error) {
    console.error('Failed to save the ward team', error);
    return { ok: false, error: error.message || 'Could not save the ward team.' };
  }
});

// Suggested assignees for matches (Teamwork Graph call 2, once per team, plus one Jira search for load).
// Returns { suggestions: { "recall|device": { accountId, name, teamName, ward } }, skipped }.
// Only a suggestion: the panel asks before anything is assigned.
resolver.define('suggestAssignees', async ({ payload }) => {
  try {
    const { matches } = await requestedMatches(payload && payload.pairs, MAX_STATE_PAIRS_PER_REQUEST);
    const { assignees, skipped } = await assigneesForMatches({
      matches,
      store: wardTeams,
      graph: teamGraph,
      openCounts: await openTaskCounts(),
    });
    return { ok: true, suggestions: Object.fromEntries(assignees), skipped };
  } catch (error) {
    console.error('Failed to suggest assignees', error);
    return { ok: false, error: 'Could not read team members from the Teamwork Graph.' };
  }
});

// --- Confluence recall pages (same service as the agent's create_recall_page; see recallPageService.js) ----

// The Confluence spaces the signed-in person can see, for the space chooser. Never guessed: the person picks.
resolver.define('listSpaces', async () => {
  try {
    const spaces = await confluenceAsUser.listSpaces();
    return { ok: true, spaces: spaces.map((s) => ({ key: s.key, name: s.name })) };
  } catch (error) {
    console.error('Failed to list Confluence spaces', error);
    return { ok: false, error: 'Could not read Confluence spaces. Is RecallRadar installed in Confluence?' };
  }
});

// "Create Confluence recall page": one page per open recall in the chosen space (or just one recall), or an
// update of the page that is already there. Written as the clicking person, so Confluence applies their rights.
//   payload.spaceKey, payload.recallNumber (optional)
resolver.define('createRecallPage', async ({ payload }) => {
  try {
    const inputs = {
      spaceKey: payload && typeof payload.spaceKey === 'string' ? payload.spaceKey : '',
      recallNumber: payload && typeof payload.recallNumber === 'string' ? payload.recallNumber : '',
    };
    const snapshot = await loadSnapshot();
    return await createRecallPages({
      snapshot,
      inputs,
      deps: { confluence: confluenceAsUser, ...(snapshot.result ? { getTaskKeys: taskKeyLookup(snapshot) } : {}) },
    });
  } catch (error) {
    console.error('Failed to create the recall page', error);
    return { ok: false, error: 'Could not create the Confluence page. Please try again.' };
  }
});

export const handler = resolver.getDefinitions();
