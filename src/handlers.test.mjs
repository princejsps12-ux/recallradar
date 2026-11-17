import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers, projectKeyFrom } from './handlers.js';
import { createDeviceStore } from './deviceStore.js';
import { createMatchCache } from './matchCache.js';
import { createCheckJobs } from './checkJob.js';
import { createTaskGuard } from './taskService.js';
import { createWardTeamStore } from './wardTeams.js';
import { NOT_ADMIN_MESSAGE, NOT_TEAM_MANAGER_MESSAGE, PERMISSION_CHECK_FAILED } from './permissions.js';
import { NOT_CONNECTED_MESSAGE } from './confluenceClient.js';
import { fakeKv } from './fakeKv.mjs';

// The resolvers with every dependency faked: real storage logic on an in-memory store, Jira, the Teamwork Graph and
// Confluence as small fakes that record what they were asked to do.
const T0 = Date.UTC(2026, 10, 16, 12, 0, 0);

const device = (id, extra = {}) => ({ id, name: `Device ${id}`, type: 'pump', manufacturer: 'ICU Medical', model: `M-${id}`, lotOrSerial: `SN-${id}`, ward: 'ICU', source: 'manual', ...extra });
const match = (deviceId, recallNumber, extra = {}) => ({
  confidence: 'exact', rule: 'exact-manufacturer-model-lot', reason: 'all listed', deviceId, deviceName: `Device ${deviceId}`,
  deviceManufacturer: 'ICU Medical', deviceModel: `M-${deviceId}`, lotOrSerial: `SN-${deviceId}`, ward: 'ICU', recallNumber, recallClass: 'I',
  firm: 'ICU Medical, Inc.', product: 'Plum Duo pump', date: '2026-07-22', ...extra,
});

function setup({ roles = { administrator: true, projectAdministrator: false }, devices = [], savedMatches = null } = {}) {
  const kv = fakeKv();
  const clock = { now: T0 };
  const nowMs = () => clock.now;
  const deviceStore = createDeviceStore(kv);
  const matchCache = createMatchCache(kv, nowMs);
  let jobNumber = 0;
  const checkJobs = createCheckJobs(kv, nowMs, () => `job-${++jobNumber}`);
  const taskGuard = createTaskGuard(kv, nowMs);
  const wardTeams = createWardTeamStore(kv, nowMs);
  const calls = { queued: [], bulk: [], logged: [], graph: [], labels: [] };
  const state = { roles, rolesError: false, existingLabels: new Map(), statuses: new Map(), spaces: [{ key: 'MD', name: 'Mobile Dev', id: '1' }], spacesError: null };
  const jira = {
    async adminRoles() {
      if (state.rolesError) throw new Error('Jira answered 500');
      return state.roles;
    },
    async findByLabels(labels) {
      if (state.jiraSearchError) throw new Error('Jira answered 500');
      calls.labels.push(labels);
      return new Map(labels.filter((l) => state.existingLabels.has(l)).map((l) => [l, state.existingLabels.get(l)]));
    },
    // The same lookup with Jira's status of each task: "To Do" (category new) unless the test set one for that key.
    async findTasks(labels) {
      const keys = await this.findByLabels(labels);
      return new Map([...keys].map(([label, key]) => [label, { key, ...(state.statuses.get(key) || { status: 'To Do', category: 'new' }) }]));
    },
    async taskIssueTypeId() {
      return '10001';
    },
    async bulkCreate(fields) {
      calls.bulk.push(fields);
      return { created: fields.map((_, index) => ({ index, key: `KAN-${calls.bulk.length * 10 + index}` })), errors: [] };
    },
    async listProjects() {
      return { projects: [{ key: 'KAN', name: 'Kanban' }], recent: ['KAN'] };
    },
    async taskStatusCounts() {
      return { open: 3, done: 1, capped: false };
    },
  };
  const teamGraph = {
    async listTeams(accountId) {
      calls.graph.push(['listTeams', accountId]);
      return [{ ari: 'ari:cloud:identity::team/00000000-0000-4000-8000-000000000001', name: 'ICU Nursing' }];
    },
    async listMembers() {
      return [];
    },
  };
  const confluence = {
    async listSpaces() {
      if (state.spacesError) throw state.spacesError;
      return state.spaces;
    },
  };
  const log = { error: (...a) => calls.logged.push(a) };
  const handlers = createHandlers({
    deviceStore, matchCache, checkJobs, taskGuard, jira, confluence, teamGraph, wardTeams,
    openTaskCounts: async () => new Map(),
    loadSnapshot: async () => ({ devices: await deviceStore.listDevices(), result: null }),
    taskKeyLookup: () => async () => ({}),
    enqueue: async (message) => { calls.queued.push(message); },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }),
    now: () => new Date(clock.now),
    log,
  });
  const ready = (async () => {
    if (devices.length) await deviceStore.saveDevices(devices);
    if (savedMatches) {
      await matchCache.write(await deviceStore.listDevices(), { deviceCount: devices.length, recallCount: 3, matches: savedMatches, failedQueries: 0, cappedQueries: 0 }, new Date(T0).toISOString());
    }
  })();
  return { handlers, deviceStore, matchCache, wardTeams, state, calls, clock, ready };
}

const ask = (h, name, request = {}) => h.handlers[name]({ payload: {}, context: { accountId: 'acc-1' }, ...request });

test('every resolver the pages call exists', () => {
  const names = Object.keys(setup().handlers).sort();
  for (const expected of ['clearDevices', 'createRecallPage', 'createTasks', 'fetchRecalls', 'getCapabilities', 'getCheckStatus', 'getSavedMatches', 'getProgress', 'getTaskStates', 'getTaskSummary', 'getWardTeams', 'importDevices', 'listDevices', 'listProjects', 'listSpaces', 'listTeams', 'loadDemoHospital', 'removeImportedDevices', 'setWardTeam', 'startCheck', 'suggestAssignees']) {
    assert.ok(names.includes(expected), expected);
  }
});

test('capabilities: a Jira administrator may change devices and teams, a project administrator only teams, others neither', async () => {
  const caps = async (roles) => ask(setup({ roles }), 'getCapabilities');
  assert.deepEqual(await caps({ administrator: true, projectAdministrator: false }), { ok: true, canManageDevices: true, canManageTeams: true });
  assert.deepEqual(await caps({ administrator: false, projectAdministrator: true }), { ok: true, canManageDevices: false, canManageTeams: true });
  assert.deepEqual(await caps({ administrator: false, projectAdministrator: false }), { ok: true, canManageDevices: false, canManageTeams: false });
  const broken = setup();
  broken.state.rolesError = true;
  assert.deepEqual(await ask(broken, 'getCapabilities'), { ok: false });
});

test('the four resolvers that change the device list are for Jira administrators, and a refusal changes nothing', async () => {
  const text = 'Name\tManufacturer\tModel\nPump\tBaxter\t35700BAX2';
  for (const roles of [{ administrator: false, projectAdministrator: false }, { administrator: false, projectAdministrator: true }]) {
    const h = setup({ roles, devices: [device('d1')] });
    await h.ready;
    for (const [name, payload] of [['loadDemoHospital', {}], ['importDevices', { text }], ['removeImportedDevices', {}], ['clearDevices', {}]]) {
      assert.deepEqual(await ask(h, name, { payload }), { ok: false, notAllowed: true, error: NOT_ADMIN_MESSAGE }, name);
    }
    assert.equal((await h.deviceStore.listDevices()).length, 1, 'nothing was changed');
  }
});

test('a failed permission check refuses too, and says so', async () => {
  const h = setup({ devices: [device('d1')] });
  await h.ready;
  h.state.rolesError = true;
  const out = await ask(h, 'clearDevices');
  assert.deepEqual(out, { ok: false, error: PERMISSION_CHECK_FAILED });
  assert.equal((await h.deviceStore.listDevices()).length, 1);
});

test('an administrator can import, remove the imported devices and clear everything', async () => {
  const h = setup();
  const imported = await ask(h, 'importDevices', { payload: { text: 'Name\tManufacturer\tModel\nPump A\tBaxter\t35700BAX2\nPump B\tBaxter\t35700BAX2' } });
  assert.equal(imported.ok, true, JSON.stringify(imported));
  assert.equal(imported.count, 2);
  assert.equal((await ask(h, 'listDevices')).devices.length, 2);
  assert.deepEqual(await ask(h, 'removeImportedDevices'), { ok: true, count: 0 });
  await ask(h, 'importDevices', { payload: { text: 'Name\tManufacturer\tModel\nPump A\tBaxter\t35700BAX2' } });
  assert.deepEqual(await ask(h, 'clearDevices'), { ok: true, count: 0 });
  assert.equal((await ask(h, 'importDevices', { payload: { text: 'nonsense' } })).ok, false, 'a bad paste is reported, not thrown');
});

test('the ward-to-team mapping is for Jira administrators and project administrators', async () => {
  const request = { payload: { ward: 'ICU', teamAri: 'ari:cloud:identity::team/00000000-0000-4000-8000-000000000001' }, context: { accountId: 'acc-1' } };
  const denied = await ask(setup({ roles: { administrator: false, projectAdministrator: false } }), 'setWardTeam', request);
  assert.deepEqual(denied, { ok: false, notAllowed: true, error: NOT_TEAM_MANAGER_MESSAGE });
  for (const roles of [{ administrator: true, projectAdministrator: false }, { administrator: false, projectAdministrator: true }]) {
    const h = setup({ roles, devices: [device('d1')] });
    await h.ready;
    const out = await ask(h, 'setWardTeam', request);
    assert.equal(out.ok, true, JSON.stringify([roles, out]));
    assert.equal((await h.wardTeams.list()).length, 1);
  }
});

test('startCheck: no devices, a queued check, and Refresh pressed twice does not queue twice', async () => {
  const none = setup();
  assert.equal((await ask(none, 'startCheck')).state, 'no-devices');
  const h = setup({ devices: [device('d1')] });
  await h.ready;
  const first = await ask(h, 'startCheck', { payload: { refresh: true } });
  assert.equal(first.state, 'running');
  assert.deepEqual(h.calls.queued, [{ jobId: 'job-1', trigger: 'user' }]);
  const second = await ask(h, 'startCheck', { payload: { refresh: true } });
  assert.equal(second.state, 'running');
  assert.equal(h.calls.queued.length, 1, 'the running job is reused');
});

test('startCheck after a finished check answers with it instead of spending more openFDA requests', async () => {
  const h = setup({ devices: [device('d1')], savedMatches: [match('d1', 'Z-1-2026')] });
  await h.ready;
  h.clock.now = T0 + 30 * 1000;
  const out = await ask(h, 'startCheck', { payload: { refresh: true } });
  assert.equal(out.state, 'saved');
  assert.equal(h.calls.queued.length, 0);
});

test('createTasks needs a project, creates one task per match, and never twice', async () => {
  const h = setup({ devices: [device('d1'), device('d2')], savedMatches: [match('d1', 'Z-1-2026'), match('d2', 'Z-1-2026')] });
  await h.ready;
  const pairs = [{ recallNumber: 'Z-1-2026', deviceId: 'd1' }, { recallNumber: 'Z-1-2026', deviceId: 'd2' }];
  assert.match((await ask(h, 'createTasks', { payload: { pairs }, context: { accountId: 'a' } })).error, /Choose a project/);
  const created = await ask(h, 'createTasks', { payload: { pairs, projectKey: 'KAN' }, context: { accountId: 'a' } });
  assert.equal(created.ok, true);
  assert.equal(created.created.length, 2);
  assert.equal(h.calls.bulk.length, 1);
  const again = await ask(h, 'createTasks', { payload: { pairs, projectKey: 'KAN' }, context: { accountId: 'a' } });
  assert.equal(again.created.length, 0, 'the 2-minute guard stops a second click');
});

test('createTasks takes the task from the SAVED result, not from the page', async () => {
  const h = setup({ devices: [device('d1')], savedMatches: [match('d1', 'Z-1-2026')] });
  await h.ready;
  const out = await ask(h, 'createTasks', { payload: { projectKey: 'KAN', pairs: [{ recallNumber: 'Z-1-2026', deviceId: 'd1', title: 'forged', dueDate: '2000-01-01' }] }, context: { accountId: 'a' } });
  assert.equal(out.created.length, 1);
  const fields = JSON.stringify(h.calls.bulk[0][0]);
  assert.doesNotMatch(fields, /forged|2000-01-01/);
  assert.match(fields, /Z-1-2026/);
  const unknown = await ask(h, 'createTasks', { payload: { projectKey: 'KAN', pairs: [{ recallNumber: 'Z-404-2026', deviceId: 'd1' }] }, context: { accountId: 'a' } });
  assert.equal(unknown.created.length, 0);
  assert.equal(unknown.notFound.length, 1, 'a pair that is not in the saved check is reported, not created');
});

test('getTaskStates answers from the Jira labels', async () => {
  const h = setup({ devices: [device('d1')], savedMatches: [match('d1', 'Z-1-2026')] });
  await h.ready;
  const labelOf = (await import('./taskRules.js')).taskLabel('Z-1-2026', 'd1');
  h.state.existingLabels.set(labelOf, 'KAN-7');
  const out = await ask(h, 'getTaskStates', { payload: { pairs: [{ recallNumber: 'Z-1-2026', deviceId: 'd1' }] } });
  assert.deepEqual(out, { ok: true, tasks: { 'Z-1-2026|d1': 'KAN-7' }, states: { 'Z-1-2026|d1': { key: 'KAN-7', status: 'To Do', category: 'new' } } });
  h.state.statuses.set('KAN-7', { status: 'Closed', category: 'done' });
  const closed = await ask(h, 'getTaskStates', { payload: { pairs: [{ recallNumber: 'Z-1-2026', deviceId: 'd1' }] } });
  assert.deepEqual(closed.states['Z-1-2026|d1'], { key: 'KAN-7', status: 'Closed', category: 'done' }, "Jira's own status category comes through");
});

test('getProgress: per recall and per ward, from the saved check and the tasks Jira holds, open recalls only', async () => {
  const taskLabel = (await import('./taskRules.js')).taskLabel;
  const devices = [device('d1', { ward: 'ICU' }), device('d2', { ward: 'ICU' }), device('d3', { ward: 'ER' }), device('d4', { ward: 'ER' })];
  const matches = [
    match('d1', 'Z-1-2026'), match('d2', 'Z-1-2026'), match('d3', 'Z-1-2026', { ward: 'ER' }), match('d4', 'Z-2-2026', { ward: 'ER', recallClass: 'II', confidence: 'likely' }),
    match('d1', 'Z-3-2026', { confidence: 'possible' }), // a weak match: no task is needed
    match('d2', 'Z-9-2026'), // this recall is over
  ];
  const h = setup({ devices, savedMatches: matches });
  await h.ready;
  // recallDetails marks Z-9-2026 as terminated, so it is not part of the work
  await h.matchCache.write(await h.deviceStore.listDevices(), { deviceCount: 4, recallCount: 4, matches, failedQueries: 0, cappedQueries: 0, recallDetails: { 'Z-9-2026': { status: 'Terminated' }, 'Z-1-2026': { status: 'Ongoing' } } }, new Date(T0).toISOString());
  for (const [recall, dev, key, status, category] of [['Z-1-2026', 'd1', 'KAN-1', 'Done', 'done'], ['Z-1-2026', 'd2', 'KAN-2', 'In review', 'indeterminate'], ['Z-2-2026', 'd4', 'KAN-3', 'To Do', 'new']]) {
    h.state.existingLabels.set(taskLabel(recall, dev), key);
    h.state.statuses.set(key, { status, category });
  }
  const out = await ask(h, 'getProgress');
  assert.equal(out.ok, true);
  const { overall, byRecall, byWard } = out.progress;
  assert.deepEqual([overall.pairs, overall.noTask, overall.open, overall.inProgress, overall.done, overall.resolvedPercent], [4, 1, 1, 1, 1, 25]);
  assert.deepEqual(byRecall.map((r) => [r.recallNumber, r.pairs, r.done, r.resolvedPercent]), [['Z-1-2026', 3, 1, 33], ['Z-2-2026', 1, 0, 0]], 'Class I first; the closed recall and the possible match are not counted');
  assert.deepEqual(byWard.map((w) => [w.ward, w.pairs, w.done]), [['ER', 2, 0], ['ICU', 2, 1]], 'the least finished ward first');
});

test('getProgress: nothing affected is an empty roll-up, and a Jira failure is a plain message', async () => {
  const h = setup({ devices: [device('d1')], savedMatches: [match('d1', 'Z-1-2026', { confidence: 'possible' })] });
  await h.ready;
  const empty = await ask(h, 'getProgress');
  assert.equal(empty.ok, true);
  assert.equal(empty.progress.overall.pairs, 0);
  const broken = setup({ devices: [device('d1')], savedMatches: [match('d1', 'Z-1-2026')] });
  await broken.ready;
  broken.state.jiraSearchError = true;
  const failed = await ask(broken, 'getProgress');
  assert.equal(failed.ok, false);
  assert.match(failed.error, /status of the tasks/);
});

test('listSpaces: spaces, the plain "not connected" answer, and any other failure', async () => {
  const h = setup();
  assert.deepEqual(await ask(h, 'listSpaces'), { ok: true, spaces: [{ key: 'MD', name: 'Mobile Dev' }] });
  h.state.spacesError = Object.assign(new Error('Confluence answered 403'), { notConnected: true });
  assert.deepEqual(await ask(h, 'listSpaces'), { ok: false, notConnected: true, error: NOT_CONNECTED_MESSAGE });
  assert.equal(h.calls.logged.length, 0, 'not connected is not an error worth logging');
  h.state.spacesError = new Error('boom');
  const failed = await ask(h, 'listSpaces');
  assert.equal(failed.ok, false);
  assert.equal(failed.notConnected, undefined);
  assert.equal(h.calls.logged.length, 1);
});

test('a failing dependency comes back as ok:false with a plain message, never as a thrown error', async () => {
  const h = setup();
  h.handlers = createHandlers({ ...{}, deviceStore: { async listDevices() { throw new Error('storage down'); } }, matchCache: {}, checkJobs: {}, jira: { async listProjects() { throw new Error('x'); }, async taskStatusCounts() { throw new Error('x'); } }, log: { error() {} } });
  for (const name of ['listDevices', 'getSavedMatches', 'getWardTeams', 'getTaskSummary', 'listProjects']) {
    const out = await h.handlers[name]({ payload: {}, context: {} });
    assert.equal(out.ok, false, name);
    assert.equal(typeof out.error, 'string', name);
  }
});

test('fetchRecalls: the recent FDA list, or a plain failure', async () => {
  const h = setup();
  assert.deepEqual(await ask(h, 'fetchRecalls'), { ok: true, recalls: [] });
  const down = createHandlers({ fetch: async () => ({ ok: false, status: 503 }), log: { error() {} } });
  assert.deepEqual(await down.fetchRecalls({}), { ok: false, error: 'Could not load recalls from openFDA. Please try again later.' });
});

test('projectKeyFrom: the issue the panel is open on wins over a chosen project; the dashboard uses the chosen one', () => {
  assert.equal(projectKeyFrom({ extension: { issue: { key: 'MOBL-57' } } }, 'KAN'), 'MOBL');
  assert.equal(projectKeyFrom({ extension: { project: { key: 'ABC' } } }, undefined), 'ABC');
  assert.equal(projectKeyFrom({}, 'kan'), 'KAN');
  assert.equal(projectKeyFrom({}, 'not a key!'), null);
  assert.equal(projectKeyFrom(undefined, undefined), null);
});
