// The resolvers the panel and the dashboard call, as plain functions with their dependencies handed in.
//
// index.js is the only place that knows Forge: it builds the real dependencies (storage, Jira as the signed-in person,
// the queue, ...) and registers every function returned here with @forge/resolver. Everything else, which is what the
// pages actually depend on (who may do what, which answer each call gives, what a failure looks like), is here and is
// unit tested with fakes (handlers.test.mjs). No Forge imports in this file.
//
// Every handler takes Forge's request ({ payload, context }) and RETURNS its answer: failures come back as
// { ok: false, error } so the page can show them, they are never thrown.
import { buildRecallsUrl, parseRecalls, DEFAULT_LIMIT } from './openfda.js';
import { loadDemoHospital } from './demoHospital.js';
import { getSavedMatches, requestCheck, getCheckStatus, getLatestResult } from './matchService.js';
import { createTasks, getTaskStatuses, validatePairs, selectMatches, MAX_STATE_PAIRS_PER_REQUEST } from './taskService.js';
import { openTaskMatches, pairKey } from './taskRules.js';
import { summarizeProgress } from './progress.js';
import { validateSettings } from './alertSettings.js';
import { runAlerts, friendlyJiraError, friendlyIssueError } from './alertService.js';
import { assigneesForMatches, checkExplicitAssignees, setWardTeam, wardOwnership } from './teamService.js';
import { createRecallPages } from './recallPageService.js';
import { isNotConnected, NOT_CONNECTED_MESSAGE } from './confluenceClient.js';
import { importDevices } from './deviceCsv.js';
import { refuseUnlessAdministrator, refuseUnlessTeamManager } from './permissions.js';

// Jira project keys: letters, digits and underscores, starting with a letter (for example MOBL).
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,19}$/;

// Tasks are created in the project of the issue the panel is open on. The dashboard (a global page) has no
// issue, so it sends the project the person chose; Jira still applies that person's permissions to it.
export function projectKeyFrom(context, chosen) {
  const extension = (context && context.extension) || {};
  if (typeof chosen === 'string' && PROJECT_KEY.test(chosen.trim().toUpperCase()) && !(extension.issue && extension.issue.key)) {
    return chosen.trim().toUpperCase();
  }
  if (extension.project && extension.project.key) return extension.project.key;
  const issueKey = extension.issue && extension.issue.key;
  return issueKey ? issueKey.slice(0, issueKey.lastIndexOf('-')) : null;
}

/**
 * @param {object} deps
 *   deviceStore, matchCache, checkJobs, taskGuard      Forge storage behind the small interfaces in their own files
 *   jira            the Jira client as the signed-in person (jiraClient.js)
 *   confluence      the Confluence client as the signed-in person (confluenceClient.js)
 *   teamGraph, wardTeams, openTaskCounts               Teamwork Graph reads and the saved ward-to-team mapping
 *   jiraApp         the Jira client as the app itself (asApp), for the daily alert only (jiraClient.js)
 *   alertState, alertSettings                          what has been seen of the affected pairs, and the administrator's alert choices
 *   loadSnapshot, taskKeyLookup                        the saved check and the Jira task keys for a snapshot (runtime.js)
 *   enqueue(message)   puts a message on the recall-check queue
 *   fetch(url, options) the HTTP call to openFDA
 *   now()              the current Date
 *   log                console-like (error)
 */
export function createHandlers(deps) {
  const log = deps.log || console;
  const now = deps.now || (() => new Date());

  // The device list is shared by the whole site, so changing it is for Jira administrators: the check runs here, on the
  // server (see permissions.js). The dashboard asks getCapabilities only to show it up front.
  const forAdministrators = (handler) => async (request) => (await refuseUnlessAdministrator(deps.jira)) || handler(request);

  // The matches the browser asked about, taken from OUR saved result so nothing is trusted from the page.
  async function requestedMatches(pairsFromBrowser, max) {
    const pairs = validatePairs(pairsFromBrowser, max);
    const devices = await deps.deviceStore.listDevices();
    const latest = await getLatestResult({ devices, cache: deps.matchCache, jobs: deps.checkJobs });
    return selectMatches(latest ? latest.matches : [], pairs);
  }

  // The saved check, or null when there is none (or no devices).
  async function latestSaved() {
    const devices = await deps.deviceStore.listDevices();
    return devices.length ? getLatestResult({ devices, cache: deps.matchCache, jobs: deps.checkJobs }) : null;
  }

  // The devices changed (imported, loaded, removed): the pairs that appear or go because of it are not news.
  async function devicesChanged(removed = false) {
    try {
      if (removed) await deps.alertState.clear();
      else await deps.alertState.devicesChanged();
    } catch (error) {
      log.error('Could not update the alert state', error); // a side job: the device change itself already worked
    }
  }

  const handlers = {
    // Fetch the latest device recalls from openFDA in a small, UI-friendly shape.
    async fetchRecalls() {
      try {
        const response = await deps.fetch(buildRecallsUrl(DEFAULT_LIMIT), { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`openFDA request failed with status ${response.status}`);
        return { ok: true, recalls: parseRecalls(await response.json()) };
      } catch (error) {
        log.error('Failed to fetch recalls from openFDA', error);
        return { ok: false, error: 'Could not load recalls from openFDA. Please try again later.' };
      }
    },

    // The hospital's devices, from Forge storage.
    async listDevices() {
      try {
        return { ok: true, devices: await deps.deviceStore.listDevices() };
      } catch (error) {
        log.error('Failed to list devices', error);
        return { ok: false, error: 'Could not load the device list.' };
      }
    },

    // What this person may change: the device list (Jira administrators) and the ward teams (Jira or project administrators).
    async getCapabilities() {
      try {
        const roles = await deps.jira.adminRoles();
        return { ok: true, canManageDevices: roles.administrator, canManageTeams: roles.administrator || roles.projectAdministrator };
      } catch (error) {
        log.error('Failed to read the permissions', error);
        return { ok: false };
      }
    },

    // "Load demo hospital": adds the 30 sample devices (replacing only earlier demo devices).
    loadDemoHospital: forAdministrators(async () => {
      try {
        const count = await loadDemoHospital(deps.deviceStore);
        await devicesChanged();
        return { ok: true, count };
      } catch (error) {
        log.error('Failed to load demo hospital', error);
        return { ok: false, error: 'Could not load the demo hospital.' };
      }
    }),

    // "Import your own devices": pasted spreadsheet text. All or nothing; the answer lists every problem line.
    importDevices: forAdministrators(async ({ payload }) => {
      try {
        const text = payload && typeof payload.text === 'string' ? payload.text : '';
        const outcome = await importDevices(deps.deviceStore, text);
        if (outcome && outcome.ok) await devicesChanged();
        return outcome;
      } catch (error) {
        log.error('Failed to import devices', error);
        return { ok: false, errors: ['Could not save the devices. Please try again.'] };
      }
    }),

    // What the panel shows when it opens: the saved result (fresh or expired), if any.
    async getSavedMatches() {
      try {
        const devices = await deps.deviceStore.listDevices();
        return { ok: true, result: await getSavedMatches({ devices, cache: deps.matchCache }) };
      } catch (error) {
        log.error('Failed to read the saved result', error);
        return { ok: false, error: 'Could not load the saved result.' };
      }
    },

    // "Check devices" / "Refresh". Returns at once: either a saved result, or the news that a background check is
    // running (the panel then polls getCheckStatus). payload.refresh = check again even if a fresh saved result exists.
    async startCheck({ payload }) {
      try {
        const devices = await deps.deviceStore.listDevices();
        const outcome = await requestCheck({
          devices,
          cache: deps.matchCache,
          jobs: deps.checkJobs,
          enqueue: (message) => deps.enqueue(message),
          refresh: Boolean(payload && payload.refresh),
          nowMs: () => now().getTime(),
        });
        return { ok: true, ...outcome };
      } catch (error) {
        log.error('Failed to start the check', error);
        return { ok: false, error: 'Could not start the check. Please try again.' };
      }
    },

    // The panel's polling call: progress, and the result once the background check has finished.
    async getCheckStatus() {
      try {
        return { ok: true, ...(await getCheckStatus({ jobs: deps.checkJobs })) };
      } catch (error) {
        log.error('Failed to read the check status', error);
        return { ok: false, error: 'Could not read the check status.' };
      }
    },

    // Which of these matches already have a task, and what is its status? Returns
    //   { tasks: { "recall|device": "MOBL-12" }, states: { "recall|device": { key, status, category } } }
    // `category` is Jira's status category ('new', 'indeterminate', 'done'); `tasks` is kept for the parts that only need the key.
    async getTaskStates({ payload }) {
      try {
        const { matches } = await requestedMatches(payload && payload.pairs, MAX_STATE_PAIRS_PER_REQUEST);
        const states = await getTaskStatuses({ matches, jira: deps.jira, guard: deps.taskGuard });
        return { ok: true, tasks: Object.fromEntries(Object.entries(states).map(([pair, task]) => [pair, task.key])), states };
      } catch (error) {
        log.error('Failed to read task states', error);
        return { ok: false, error: 'Could not look up existing tasks.' };
      }
    },

    // How far along the work is: for every affected device and open recall, is there a task and what is its status in Jira,
    // rolled up per recall and per ward (see progress.js). Read as the signed-in person, from the saved check.
    async getProgress() {
      try {
        const devices = await deps.deviceStore.listDevices();
        const latest = await getLatestResult({ devices, cache: deps.matchCache, jobs: deps.checkJobs });
        const matches = openTaskMatches(latest);
        const states = matches.length ? await getTaskStatuses({ matches, jira: deps.jira, guard: deps.taskGuard }) : {};
        return { ok: true, progress: summarizeProgress(matches, states) };
      } catch (error) {
        log.error('Failed to read the task progress', error);
        return { ok: false, error: 'Could not read the status of the tasks.' };
      }
    },

    // "Create task" / "Create tasks for all": one task per recall + device that does not have one yet.
    // payload.assignees = optional { "recall|device": accountId } the person agreed to. Each one is re-checked against the
    // ward's team in the Teamwork Graph, so a forged request cannot assign anybody else. Nobody is assigned unless asked.
    async createTasks({ payload, context }) {
      try {
        const projectKey = projectKeyFrom(context, payload && payload.projectKey);
        if (!projectKey) return { ok: false, error: 'Choose a project for the new tasks first.' };
        const { matches, notFound } = await requestedMatches(payload && payload.pairs);
        let assignees = new Map();
        let assignRefused = [];
        let assignError = null;
        if (payload && payload.assignees && Object.keys(payload.assignees).length > 0) {
          try {
            ({ assignees, refused: assignRefused } = await checkExplicitAssignees({
              explicit: payload.assignees,
              matches,
              store: deps.wardTeams,
              graph: deps.teamGraph,
            }));
          } catch (error) {
            // The graph is down: still create the tasks, unassigned, and say so.
            log.error('Could not check assignees', error);
            assignError = 'The Teamwork Graph could not be reached, so the tasks were created without an assignee.';
          }
        }
        const outcome = await createTasks({ matches, jira: deps.jira, guard: deps.taskGuard, projectKey, today: now(), assignees });
        const assignedTo = {};
        for (const { pair } of outcome.created) if (assignees.has(pair)) assignedTo[pair] = assignees.get(pair).name;
        return { ok: true, ...outcome, notFound, assignedTo, assignRefused, assignError };
      } catch (error) {
        log.error('Failed to create tasks', error);
        return { ok: false, error: 'Could not create the tasks. Please try again.' };
      }
    },

    // The saved ward-to-team mappings, plus the wards found in the device list. Storage only: no graph call.
    async getWardTeams() {
      try {
        const devices = await deps.deviceStore.listDevices();
        const wards = [...new Set(devices.map((d) => d.ward).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        return { ok: true, mappings: await deps.wardTeams.list(), wards };
      } catch (error) {
        log.error('Failed to read ward teams', error);
        return { ok: false, error: 'Could not load the ward teams.' };
      }
    },

    // Teamwork Graph call 1: the teams the signed-in person belongs to, for the mapping dropdown.
    async listTeams({ context }) {
      try {
        return { ok: true, teams: await deps.teamGraph.listTeams(context.accountId) };
      } catch (error) {
        log.error('Failed to read teams from the Teamwork Graph', error);
        return { ok: false, error: 'Could not read teams from the Teamwork Graph.' };
      }
    },

    // Save (or, with an empty teamAri, remove) one ward's team. Jira administrators and project administrators only; the
    // server also checks that the team is one of the caller's teams in the graph.
    async setWardTeam({ payload, context }) {
      try {
        const refused = await refuseUnlessTeamManager(deps.jira);
        if (refused) return refused;
        const ward = payload && typeof payload.ward === 'string' ? payload.ward : '';
        const teamAri = payload && typeof payload.teamAri === 'string' && payload.teamAri ? payload.teamAri : null;
        return await setWardTeam({ ward, teamAri, accountId: context.accountId, graph: deps.teamGraph, store: deps.wardTeams });
      } catch (error) {
        log.error('Failed to save the ward team', error);
        return { ok: false, error: error.message || 'Could not save the ward team.' };
      }
    },

    // Suggested assignees for matches (Teamwork Graph call 2, once per team, plus one Jira search for load).
    // Only a suggestion: the page asks before anything is assigned.
    async suggestAssignees({ payload }) {
      try {
        const { matches } = await requestedMatches(payload && payload.pairs, MAX_STATE_PAIRS_PER_REQUEST);
        const { assignees, skipped } = await assigneesForMatches({
          matches,
          store: deps.wardTeams,
          graph: deps.teamGraph,
          openCounts: await deps.openTaskCounts(),
        });
        return { ok: true, suggestions: Object.fromEntries(assignees), skipped };
      } catch (error) {
        log.error('Failed to suggest assignees', error);
        return { ok: false, error: 'Could not read team members from the Teamwork Graph.' };
      }
    },

    // The Jira projects the person can see, for the dashboard's project choice.
    async listProjects() {
      try {
        return { ok: true, ...(await deps.jira.listProjects()) };
      } catch (error) {
        log.error('Failed to list projects', error);
        return { ok: false, error: 'Could not read your Jira projects.' };
      }
    },

    // Remove the devices that were imported by paste (the demo hospital is left alone).
    removeImportedDevices: forAdministrators(async () => {
      try {
        await deps.deviceStore.removeBySource('manual');
        await devicesChanged(true);
        return { ok: true, count: (await deps.deviceStore.listDevices()).length };
      } catch (error) {
        log.error('Failed to remove imported devices', error);
        return { ok: false, error: 'Could not remove the imported devices.' };
      }
    }),

    // "Remove all devices": start over (demo and imported). Also forgets the saved check, which belonged to them.
    clearDevices: forAdministrators(async () => {
      try {
        await deps.deviceStore.clear();
        await deps.matchCache.clear();
        await devicesChanged(true);
        return { ok: true, count: 0 };
      } catch (error) {
        log.error('Failed to clear devices', error);
        return { ok: false, error: 'Could not remove the devices.' };
      }
    }),

    // Task counts for the dashboard: { open, done, capped }. Read as the signed-in person.
    async getTaskSummary() {
      try {
        return { ok: true, summary: await deps.jira.taskStatusCounts() };
      } catch (error) {
        log.error('Failed to count tasks', error);
        return { ok: false, error: 'Could not count the RecallRadar tasks.' };
      }
    },

    // The ward's team, the Jira projects it works in and how busy each person is, for the recall drawer. Read from the Teamwork
    // Graph as the signed-in person, when the drawer's card is opened; nothing is saved.
    async getWardPeople({ payload }) {
      try {
        const ward = payload && typeof payload.ward === 'string' ? payload.ward.trim() : '';
        if (!ward) return { ok: false, error: 'Which ward?' };
        return { ok: true, ...(await wardOwnership({ ward, store: deps.wardTeams, graph: deps.teamGraph, now })) };
      } catch (error) {
        log.error('Failed to read the ward people', error);
        return { ok: false, error: 'The Teamwork Graph could not be read. Try again in a moment.' };
      }
    },

    // What the dashboard shows about the daily alerts, for everyone: the administrator's choices, since when the hospital is watched,
    // what the last daily run did, and the pairs that became affected in the last 24 hours (ids and times: the page joins them
    // with the saved check it already has).
    async getAlerts() {
      try {
        const [settings, overview, news] = await Promise.all([deps.alertSettings.get(), deps.alertState.overview(), deps.alertState.newSince()]);
        const newSince = news.map(({ pair, firstSeen }) => {
          const cut = pair.indexOf('|');
          return { recallNumber: pair.slice(0, cut), deviceId: pair.slice(cut + 1), firstSeen };
        });
        return { ok: true, settings, watching: overview.watching, since: overview.since, last: overview.last, newSince };
      } catch (error) {
        log.error('Failed to read the alerts', error);
        return { ok: false, error: 'Could not read the alert settings.' };
      }
    },

    // Turn the daily alerts on or off and choose where the tasks go (Jira administrators). Turning them on first tries the
    // project as the app itself, because that is who will create the tasks: a refusal is reported now, not at 3 a.m.
    saveAlertSettings: forAdministrators(async ({ payload }) => {
      try {
        const checked = validateSettings(payload);
        if (!checked.ok) return { ok: false, error: checked.error };
        const { settings } = checked;
        if (settings.enabled) {
          try {
            if (!(await deps.jiraApp.taskIssueTypeId(settings.projectKey))) return { ok: false, error: `Project ${settings.projectKey} has no issue type for tasks.` };
          } catch (error) {
            return { ok: false, error: friendlyJiraError(error, settings.projectKey) };
          }
          if (settings.commentIssueKey) {
            try {
              await deps.jiraApp.issueSummary(settings.commentIssueKey);
            } catch (error) {
              return { ok: false, error: friendlyIssueError(error, settings.commentIssueKey) };
            }
          }
        }
        const before = await deps.alertSettings.get();
        await deps.alertSettings.save(settings);
        if (settings.enabled && !before.enabled) {
          // Switching on starts from today: what is affected now is the baseline, only later news is alerted.
          try {
            const latest = await latestSaved();
            if (latest) await deps.alertState.rebaseline(openTaskMatches(latest).map((m) => pairKey(m.recallNumber, m.deviceId)));
          } catch (error) {
            log.error('Could not set the alert baseline', error);
          }
        }
        return { ok: true, settings };
      } catch (error) {
        log.error('Failed to save the alert settings', error);
        return { ok: false, error: 'Could not save the alert settings.' };
      }
    }),

    // "Run now" (Jira administrators): the daily alert step on the saved check, so the choices can be tried without waiting for
    // tomorrow. It does exactly what the daily run does: tasks for pairs that are new, one comment, nothing twice.
    runAlertsNow: forAdministrators(async () => {
      try {
        const latest = await latestSaved();
        if (!latest) return { ok: false, error: 'There is no saved check yet. Press Refresh first, then try again.' };
        const outcome = await runAlerts({ state: deps.alertState, settings: deps.alertSettings, result: latest, jira: deps.jiraApp, guard: deps.taskGuard, now, log });
        return outcome.ran ? { ok: true, ran: true, summary: outcome.summary } : { ok: true, ran: false, reason: outcome.reason };
      } catch (error) {
        log.error('Failed to run the alerts', error);
        return { ok: false, error: 'Could not run the alerts.' };
      }
    }),

    // The Confluence spaces the signed-in person can see, for the space chooser. Never guessed: the person picks.
    async listSpaces() {
      try {
        const spaces = await deps.confluence.listSpaces();
        return { ok: true, spaces: spaces.map((s) => ({ key: s.key, name: s.name })) };
      } catch (error) {
        // A site that only installed the app in Jira is the normal case, not a failure worth an error log.
        if (isNotConnected(error)) return { ok: false, notConnected: true, error: NOT_CONNECTED_MESSAGE };
        log.error('Failed to list Confluence spaces', error);
        return { ok: false, error: 'Could not read Confluence spaces. Please try again.' };
      }
    },

    // "Create Confluence recall page": one page per open recall in the chosen space (or just one recall), or an update
    // of the page that is already there. Written as the clicking person, so Confluence applies their rights.
    async createRecallPage({ payload }) {
      try {
        const inputs = {
          spaceKey: payload && typeof payload.spaceKey === 'string' ? payload.spaceKey : '',
          recallNumber: payload && typeof payload.recallNumber === 'string' ? payload.recallNumber : '',
        };
        const snapshot = await deps.loadSnapshot();
        return await createRecallPages({
          snapshot,
          inputs,
          deps: { confluence: deps.confluence, ...(snapshot.result ? { getTaskKeys: deps.taskKeyLookup(snapshot) } : {}) },
        });
      } catch (error) {
        log.error('Failed to create the recall page', error);
        return { ok: false, error: 'Could not create the Confluence page. Please try again.' };
      }
    },
  };

  return handlers;
}
