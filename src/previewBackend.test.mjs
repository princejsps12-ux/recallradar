import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The preview's fake backend (scripts/preview/backend.js): it must answer every resolver the real app has, with
// the shapes the UI reads, and its scenarios must behave the way their descriptions say.
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { createBackend, SCENARIOS, RESOLVERS, SEARCHES, NOT_CONNECTED_MESSAGE, NOT_TEAM_MANAGER_MESSAGE, alertRefusedMessage } = require('../scripts/preview/backend.js');
const fixtures = JSON.parse(readFileSync(join(here, '..', 'scripts', 'preview', 'fixtures', 'demo.json'), 'utf8'));

let clock = 1_700_000_000_000;
const make = (scenario, extra = {}) => createBackend({ fixtures, scenario, delay: 0, now: () => clock, ...extra });
const affected = (result) => result.matches.filter((m) => m.confidence === 'exact' || m.confidence === 'likely');
const pairOf = (m) => ({ recallNumber: m.recallNumber, deviceId: m.deviceId });
const key = (m) => `${m.recallNumber}|${m.deviceId}`;

test('the preview answers every resolver the real app defines', async () => {
  const { createHandlers } = await import('./handlers.js');
  const defined = Object.keys(createHandlers({}));
  assert.ok(defined.length >= 15, 'the handlers were found in src/handlers.js');
  for (const name of defined) assert.ok(RESOLVERS.includes(name), `preview backend is missing the resolver "${name}"`);
  const backend = make('ready');
  for (const name of RESOLVERS) {
    const answer = await backend.invoke(name, {});
    assert.ok(answer && typeof answer.ok === 'boolean', `${name} answers with an ok flag`);
    assert.ok(!/no answer/.test(answer.error || ''), `${name} is implemented`);
  }
  const unknown = await make('ready').invoke('notAResolver');
  assert.equal(unknown.ok, false);
});

test('the fixture is a real check of the demo hospital', () => {
  assert.equal(fixtures.devices.length, 30);
  assert.ok(affected(fixtures.result).length >= 20, 'enough exact and likely matches to fill a dashboard');
  assert.ok(fixtures.recent.length >= 10);
  assert.ok(fixtures.devices.every((d) => d.id && d.manufacturer && d.model));
});

test('every scenario starts the way its description says', async () => {
  for (const name of Object.keys(SCENARIOS)) {
    const backend = make(name);
    if (name === 'loading') {
      const outcome = await Promise.race([backend.invoke('listDevices'), new Promise((resolve) => setTimeout(() => resolve('pending'), 30))]);
      assert.equal(outcome, 'pending', 'loading never answers');
      continue;
    }
    const devices = await backend.invoke('listDevices');
    if (name === 'error') {
      assert.equal(devices.ok, false);
      continue;
    }
    assert.equal(devices.ok, true, name);
    assert.equal(devices.devices.length, name.startsWith('first-run') ? 0 : 30, name);
    const saved = await backend.invoke('getSavedMatches');
    const status = await backend.invoke('getCheckStatus');
    assert.equal(saved.ok, true);
    assert.equal(status.ok, true);
    const hasResult = !['first-run', 'first-run-not-admin', 'no-check', 'running'].includes(name); // 'refreshing' keeps its old result
    assert.equal(Boolean(saved.result), hasResult, `${name}: saved result`);
    assert.equal(status.job ? status.job.status : null, ['running', 'refreshing'].includes(name) ? 'running' : null, `${name}: job`);
  }
  assert.throws(() => make('nope'), /Unknown preview state/);
});

test('the scenarios that describe a result have it: stale, incomplete, nothing affected, tasks', async () => {
  const stale = (await make('stale').invoke('getSavedMatches')).result;
  assert.equal(stale.stale, true);
  assert.ok(Date.now() - new Date(stale.checkedAt).getTime() > 0);
  assert.equal((await make('failed-lookups').invoke('getSavedMatches')).result.failedQueries, 3);
  assert.equal(affected((await make('none-affected').invoke('getSavedMatches')).result).length, 0);
  const inProgress = make('in-progress');
  assert.deepEqual((await inProgress.invoke('getTaskSummary')).summary, { open: 5, done: 3, capped: false });
  const allDone = make('all-done');
  const result = (await allDone.invoke('getSavedMatches')).result;
  const states = await allDone.invoke('getTaskStates', { pairs: affected(result).map(pairOf) });
  assert.equal(Object.keys(states.tasks).length, affected(result).length, 'every affected pair has a task');
  assert.equal((await make('ready').invoke('getTaskSummary')).summary.open, 0);
});

test('first run: loading the demo hospital, then a check that advances with the clock and finishes', async () => {
  const backend = make('first-run', { duration: 4000 });
  assert.equal((await backend.invoke('startCheck', {})).state, 'no-devices');
  assert.equal((await backend.invoke('loadDemoHospital')).count, 30);
  const started = await backend.invoke('startCheck', { refresh: true });
  assert.equal(started.state, 'running');
  assert.equal(started.job.progress.total, SEARCHES);
  clock += 2000;
  const half = await backend.invoke('getCheckStatus');
  assert.equal(half.job.status, 'running');
  assert.ok(half.job.progress.done > 0 && half.job.progress.done < SEARCHES, 'progress moves with time');
  assert.equal(half.result, null);
  clock += 2500;
  const done = await backend.invoke('getCheckStatus');
  assert.equal(done.job.status, 'done');
  assert.ok(done.result && done.result.matches.length > 0);
  assert.equal(done.result.stale, false);
  assert.equal((await backend.invoke('startCheck', {})).state, 'saved', 'a fresh result is not checked again without Refresh');
});

test('a running check that is frozen stays at its progress, and a stale result is shown once before Refresh works', async () => {
  const running = make('running');
  clock += 60000;
  assert.equal((await running.invoke('getCheckStatus')).job.progress.done, 9);
  const stale = make('stale', { duration: 0 });
  assert.equal((await stale.invoke('startCheck', {})).state, 'saved', 'the automatic refresh keeps the flagged result');
  assert.equal((await stale.invoke('startCheck', { refresh: true })).state, 'running', 'a click on Refresh really refreshes');
  assert.equal((await stale.invoke('getCheckStatus')).job.status, 'done');
  assert.equal((await make('refresh-error').invoke('startCheck', {})).ok, false);
});

test('creating tasks: one per recall and device, never twice, assignees only when asked', async () => {
  const backend = make('ready');
  const result = (await backend.invoke('getSavedMatches')).result;
  const [first, second] = affected(result);
  const created = await backend.invoke('createTasks', { pairs: [pairOf(first), pairOf(second)], assignees: {}, projectKey: 'BIOMED' });
  assert.equal(created.created.length, 2);
  assert.match(created.created[0].key, /^BIOMED-\d+$/);
  assert.deepEqual(created.assignedTo, {});
  const again = await backend.invoke('createTasks', { pairs: [pairOf(first)], assignees: {}, projectKey: 'BIOMED' });
  assert.equal(again.created.length, 0);
  assert.equal(again.existing.length, 1);
  assert.equal(again.existing[0].key, created.created[0].key);
  const stranger = await backend.invoke('createTasks', { pairs: [{ recallNumber: 'Z-0000-0000', deviceId: 'nobody' }], assignees: {}, projectKey: 'BIOMED' });
  assert.equal(stranger.notFound.length, 1);
  assert.deepEqual((await backend.invoke('getTaskSummary')).summary, { open: 2, done: 0, capped: false });
});

test('suggestions come from the ward\'s team, the person with the fewest tasks first, and only for wards with a team', async () => {
  const backend = make('ready');
  const result = (await backend.invoke('getSavedMatches')).result;
  const icu = affected(result).filter((m) => m.ward === 'ICU').slice(0, 3);
  const other = affected(result).find((m) => m.ward === 'OR-1');
  assert.ok(icu.length === 3 && other, 'the fixture has ICU devices and a ward without a team');
  const out = await backend.invoke('suggestAssignees', { pairs: [...icu, other].map(pairOf) });
  assert.equal(out.ok, true);
  const names = icu.map((m) => out.suggestions[key(m)].name);
  assert.equal(new Set(names).size, 2, 'the work is shared between the two ICU people');
  assert.equal(out.suggestions[key(icu[0])].teamName, 'ICU Nursing');
  assert.equal(out.suggestions[key(other)], undefined);
  assert.match(out.skipped[0].reason, /no team yet/);
  const asked = await backend.invoke('createTasks', { pairs: [pairOf(icu[0])], assignees: { [key(icu[0])]: out.suggestions[key(icu[0])].accountId }, projectKey: 'BIOMED' });
  assert.equal(asked.assignedTo[key(icu[0])], names[0]);
  assert.equal((await make('no-graph').invoke('suggestAssignees', { pairs: [pairOf(icu[0])] })).ok, false, 'the Graph saying no is an error, not an empty answer');
});

test('ward teams: choose, replace and remove one', async () => {
  const backend = make('ready');
  const before = await backend.invoke('getWardTeams');
  assert.equal(before.mappings.length, 3);
  assert.ok(before.wards.length >= 10 && before.wards.includes('OR-1'));
  const teams = (await backend.invoke('listTeams')).teams;
  const saved = await backend.invoke('setWardTeam', { ward: 'OR-1', teamAri: teams[3].ari });
  assert.equal(saved.team.name, teams[3].name);
  assert.equal((await backend.invoke('getWardTeams')).mappings.length, 4);
  assert.equal((await backend.invoke('setWardTeam', { ward: 'OR-1', teamAri: '' })).removed, true);
  assert.equal((await backend.invoke('getWardTeams')).mappings.length, 3);
  assert.equal((await backend.invoke('setWardTeam', { ward: 'OR-1', teamAri: 'ari:cloud:identity::team/unknown' })).ok, false);
});

test('Confluence pages and imports answer the way the dialogs read them', async () => {
  const backend = make('ready');
  assert.ok((await backend.invoke('listSpaces')).spaces.length >= 1);
  const result = (await backend.invoke('getSavedMatches')).result;
  const open = new Set(affected(result).map((m) => m.recallNumber));
  const all = await backend.invoke('createRecallPage', { spaceKey: 'BIOMED', recallNumber: '' });
  assert.equal(all.state, 'done');
  assert.equal(all.pages.length, Math.min(open.size, 10));
  assert.equal(all.notIncluded, Math.max(0, open.size - 10));
  assert.equal((await backend.invoke('createRecallPage', { spaceKey: 'NOPE' })).ok, false);
  assert.equal((await backend.invoke('importDevices', { text: 'just one line' })).ok, false);
  assert.equal((await backend.invoke('importDevices', { text: 'Name\tManufacturer\tModel\nPump\tAcme\tP1' })).count, 1);
  assert.equal((await backend.invoke('clearDevices')).count, 0);
  assert.equal((await backend.invoke('listDevices')).devices.length, 0);
});

test('the recent FDA list answers, or fails when the scenario says so', async () => {
  const ok = await make('ready').invoke('fetchRecalls');
  assert.equal(ok.recalls.length, fixtures.recent.length);
  const bad = make('ready');
  bad.flags.recentFails = true;
  assert.equal((await bad.invoke('fetchRecalls')).ok, false);
});

test('the "not connected to Confluence" state says what the real app says', async () => {
  const { NOT_CONNECTED_MESSAGE: real } = await import('./confluenceClient.js');
  assert.equal(NOT_CONNECTED_MESSAGE, real, 'the preview repeats the real message word for word');
  const off = make('no-confluence');
  for (const [resolver, payload] of [['listSpaces', {}], ['createRecallPage', { spaceKey: 'BIOMED' }]]) {
    const answer = await off.invoke(resolver, payload);
    assert.equal(answer.ok, false, resolver);
    assert.equal(answer.notConnected, true, resolver);
    assert.equal(answer.error, real, resolver);
  }
  const connected = await make('ready').invoke('listSpaces', {});
  assert.equal(connected.ok, true, 'every other state has Confluence connected');
  assert.ok(connected.spaces.length > 0);
});

test('the "not a Jira administrator" states refuse device changes in the words of the real app', async () => {
  const { NOT_ADMIN_MESSAGE: real } = await import('./permissions.js');
  assert.equal((await import('node:module').then(() => require('../scripts/preview/backend.js'))).NOT_ADMIN_MESSAGE, real);
  for (const name of ['not-admin', 'first-run-not-admin']) {
    const backend = make(name);
    assert.deepEqual(await backend.invoke('getCapabilities', {}), { ok: true, canManageDevices: false, canManageTeams: false }, name);
    for (const [resolver, payload] of [['loadDemoHospital', {}], ['importDevices', { text: 'Manufacturer\tModel\nA\tB' }], ['removeImportedDevices', {}], ['clearDevices', {}]]) {
      const answer = await backend.invoke(resolver, payload);
      assert.equal(answer.ok, false, `${name} ${resolver}`);
      assert.equal(answer.notAllowed, true, `${name} ${resolver}`);
      assert.equal(answer.error, real, `${name} ${resolver}`);
    }
  }
  assert.deepEqual(await make('ready').invoke('getCapabilities', {}), { ok: true, canManageDevices: true, canManageTeams: true });
});

test('the ward team mapping is refused for a person who is neither a Jira administrator nor a project administrator', async () => {
  const { NOT_TEAM_MANAGER_MESSAGE: real } = await import('./permissions.js');
  assert.equal(NOT_TEAM_MANAGER_MESSAGE, real);
  const denied = await make('not-admin').invoke('setWardTeam', { ward: 'ICU', teamAri: '' });
  assert.deepEqual(denied, { ok: false, notAllowed: true, error: real });
  const projectAdmin = make('project-admin');
  assert.equal((await projectAdmin.invoke('getCapabilities', {})).canManageTeams, true);
  assert.notEqual((await projectAdmin.invoke('setWardTeam', { ward: 'ICU', teamAri: '' })).notAllowed, true);
});

test('task status and progress: the preview gives Jira-like statuses and the same roll-up as the real code', async () => {
  const { summarizeProgress } = await import('./progress.js');
  const { openTaskMatches } = await import('./taskRules.js');
  for (const scenario of ['ready', 'in-progress', 'all-done']) {
    const backend = make(scenario);
    const saved = await backend.invoke('getSavedMatches');
    const pairs = affected(saved.result).map(pairOf);
    const { tasks, states } = await backend.invoke('getTaskStates', { pairs });
    assert.deepEqual(Object.keys(states).sort(), Object.keys(tasks).sort(), `${scenario}: a status for every task`);
    for (const state of Object.values(states)) assert.ok(['new', 'indeterminate', 'done'].includes(state.category) && state.status && state.key, scenario);
    const preview = (await backend.invoke('getProgress')).progress;
    assert.deepEqual(preview, JSON.parse(JSON.stringify(summarizeProgress(openTaskMatches(saved.result), states))), `${scenario}: the preview rolls up like src/progress.js`);
  }
  const inProgress = (await make('in-progress').invoke('getProgress')).progress;
  assert.equal(inProgress.overall.done, 3, 'the scenario says three of the eight tasks are done');
  assert.equal(inProgress.overall.withTask, 8);
  assert.ok(inProgress.overall.noTask > 0 && inProgress.overall.inProgress > 0 && inProgress.overall.open > 0);
  const allDone = (await make('all-done').invoke('getProgress')).progress;
  assert.equal(allDone.overall.noTask, 0);
  const ready = (await make('ready').invoke('getProgress')).progress;
  assert.equal(ready.overall.withTask, 0, 'no tasks yet');
  assert.equal(ready.overall.resolvedPercent, 0);
});

test('creating a task in the preview shows up in the progress as a task to do', async () => {
  const backend = make('ready');
  const saved = await backend.invoke('getSavedMatches');
  const first = affected(saved.result)[0];
  await backend.invoke('createTasks', { pairs: [pairOf(first)], projectKey: 'BIOMED' });
  const after = (await backend.invoke('getProgress')).progress;
  assert.equal(after.overall.withTask, 1);
  assert.equal(after.overall.open, 1, 'a new task is not done');
});

test('daily alerts in the preview: the news of the scenarios, the settings, Run now, and the refusal in the real words', async () => {
  const { friendlyJiraError } = await import('./alertService.js');
  assert.equal(alertRefusedMessage('BIOMED'), friendlyJiraError(new Error('Jira answered 403'), 'BIOMED'), 'the preview says what the app says');
  const quiet = await make('ready').invoke('getAlerts');
  assert.deepEqual([quiet.settings.enabled, quiet.newSince.length, quiet.last], [false, 0, null]);
  const news = await make('new-since').invoke('getAlerts');
  assert.equal(news.newSince.length, 3);
  assert.ok(news.newSince.every((n) => clock - Date.parse(n.firstSeen) < 24 * 3600 * 1000), 'all within the last day');
  assert.deepEqual([...news.newSince].map((n) => n.firstSeen), [...news.newSince].map((n) => n.firstSeen).sort().reverse(), 'newest first');
  const on = make('alerts-on');
  const alerts = await on.invoke('getAlerts');
  assert.equal(alerts.settings.enabled, true);
  assert.equal(alerts.last.created.length, 2, 'the last run made two tasks');
  const saved = await on.invoke('getSavedMatches');
  const pairs = affected(saved.result).map(pairOf);
  const { tasks } = await on.invoke('getTaskStates', { pairs });
  assert.equal(alerts.newSince.filter((n) => tasks[`${n.recallNumber}|${n.deviceId}`]).length, 2, 'the two pairs the last run handled have their tasks');
  const run = await on.invoke('runAlertsNow');
  assert.equal(run.ran, true);
  assert.equal(run.summary.news, 1, 'only the third new device was still waiting');
  assert.equal(run.summary.created.length, 1);
  assert.equal((await on.invoke('runAlertsNow')).summary.news, 0, 'a second click does nothing');
  // settings
  const off = make('new-since');
  assert.deepEqual(await off.invoke('runAlertsNow'), { ok: true, ran: false, reason: 'off' });
  assert.match((await off.invoke('saveAlertSettings', { enabled: true })).error, /Choose the project/);
  assert.match((await off.invoke('saveAlertSettings', { enabled: false, projectKey: 'no good' })).error, /not a Jira project key/);
  assert.equal((await off.invoke('saveAlertSettings', { enabled: true, projectKey: 'biomed', commentIssueKey: 'biomed-1' })).settings.projectKey, 'BIOMED');
  // refused
  const refused = make('alerts-refused');
  const state = await refused.invoke('getAlerts');
  assert.equal(state.last.error, alertRefusedMessage('BIOMED'));
  assert.equal((await refused.invoke('saveAlertSettings', { enabled: true, projectKey: 'BIOMED', commentIssueKey: '' })).error, alertRefusedMessage('BIOMED'));
  assert.equal((await refused.invoke('runAlertsNow')).summary.error, alertRefusedMessage('BIOMED'));
  // not an administrator
  const stranger = make('not-admin');
  assert.equal((await stranger.invoke('saveAlertSettings', { enabled: false })).notAllowed, true);
  assert.equal((await stranger.invoke('runAlertsNow')).notAllowed, true);
  assert.equal((await stranger.invoke('getAlerts')).ok, true, 'everyone may read');
});

test('ward people in the preview: the real shape, an unmapped ward, a partial answer, and a graph that refuses', async () => {
  const { wardOwnership } = await import('./teamService.js');
  const backend = make('ready');
  const icu = await backend.invoke('getWardPeople', { ward: 'ICU' });
  assert.equal(icu.ok, true);
  assert.equal(icu.mapped, true);
  assert.deepEqual(icu.spaces, [{ key: 'BIOMED', name: 'Biomedical Engineering', lead: 'Hana Sato' }]);
  assert.ok(icu.people.length >= 2 && icu.people.every((p) => p.accountId && p.name && 'openWork' in p && 'overdue' in p && 'capped' in p && 'next' in p));
  // the same keys the real service answers with
  const store = { get: async (ward) => ({ ward, teamAri: icu.team.ari, teamName: icu.team.name }) };
  const graph = { listMembers: async () => icu.people.map((p) => ({ accountId: p.accountId, name: p.name })), listTeamSpaces: async () => icu.spaces, listAssignedWork: async () => ({ items: [], capped: false }) };
  const real = await wardOwnership({ ward: 'ICU', store, graph });
  assert.deepEqual(Object.keys(icu).sort(), Object.keys({ ok: true, ...real }).sort());
  assert.deepEqual(Object.keys(icu.people[0]).sort(), Object.keys(real.people[0]).sort());
  assert.deepEqual(await backend.invoke('getWardPeople', { ward: 'ER' }), { ok: true, ward: 'ER', mapped: false });
  const cardiology = await backend.invoke('getWardPeople', { ward: 'Cardiology' });
  assert.deepEqual(cardiology.spaces, []);
  assert.equal(cardiology.partial.work, true);
  assert.deepEqual(await backend.invoke('getWardPeople', { payload: {} }), { ok: false, error: 'Which ward?' });
  const down = await make('no-graph').invoke('getWardPeople', { ward: 'ICU' });
  assert.equal(down.ok, false);
});

