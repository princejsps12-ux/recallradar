import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRovoHandlers, projectKeyFrom } from './rovoHandlers.js';
import { createPreviewStore } from './agentTools.js';
import { createTaskGuard } from './taskService.js';
import { fakeKv } from './fakeKv.mjs';

// The Rovo actions with every dependency faked: the pure tools are tested in agentTools.test.mjs; this checks the wiring
// (what each action loads, what it passes on, what it logs, what a failure looks like).
const device = { id: 'd1', name: 'Plum pump', manufacturer: 'ICU Medical', model: 'M-1', lotOrSerial: 'SN-1', ward: 'ICU', source: 'demo' };
const match = {
  confidence: 'exact', rule: 'exact-manufacturer-model-lot', reason: 'all listed', deviceId: 'd1', deviceName: 'Plum pump', deviceManufacturer: 'ICU Medical',
  deviceModel: 'M-1', lotOrSerial: 'SN-1', ward: 'ICU', recallNumber: 'Z-1-2026', recallClass: 'I', firm: 'ICU Medical, Inc.', product: 'Plum Duo pump', date: '2026-07-22',
};
const saved = { devices: [device], result: { checkedAt: '2026-11-16T10:00:00.000Z', deviceCount: 1, recallCount: 1, matches: [match], failedQueries: 0, recallDetails: { 'Z-1-2026': { status: 'Ongoing', reason: 'the pump may stop' } } } };

function setup({ snapshot = saved } = {}) {
  const logged = { info: [], error: [] };
  const created = [];
  const state = { snapshotError: null };
  const actions = createRovoHandlers({
    loadSnapshot: async () => {
      if (state.snapshotError) throw state.snapshotError;
      return snapshot;
    },
    jira: {
      async findByLabels() { return new Map(); },
      async taskIssueTypeId() { return '10001'; },
      async bulkCreate(fields) { created.push(fields); return { created: fields.map((_, index) => ({ index, key: `KAN-${index + 1}` })), errors: [] }; },
    },
    confluence: { async listSpaces() { return [{ id: '1', key: 'MD', name: 'Mobile Dev' }]; }, async findSpace() { return null; } },
    taskGuard: createTaskGuard(fakeKv()),
    previewStore: createPreviewStore(fakeKv()),
    teamGraph: { async listTeams() { return []; }, async listMembers() { return []; } },
    wardTeams: { async list() { return []; }, async get() { return null; } },
    openTaskCounts: async () => new Map(),
    taskKeyLookup: () => async () => ({}),
    now: () => new Date('2026-11-16T12:00:00Z'),
    log: { info: (...a) => logged.info.push(a), error: (...a) => logged.error.push(a) },
  });
  return { actions, logged, created, state };
}

test('list_open_recalls answers from the saved check, with citations', async () => {
  const { actions } = setup();
  const out = await actions.listOpenRecallsAction({});
  assert.equal(out.ok, true);
  assert.deepEqual(out.items.map((i) => i.recallNumber), ['Z-1-2026']);
  assert.deepEqual(out.citations.recallNumbers, ['Z-1-2026']);
});

test('check_device and recall_details read the same snapshot', async () => {
  const { actions } = setup();
  assert.equal((await actions.checkDeviceAction({ serial: 'SN-1' })).ok, true);
  const details = await actions.recallDetailsAction({ recallNumber: 'Z-1-2026' });
  assert.equal(details.ok, true);
});

test('with no saved check every reading action says how to get one, and nothing throws', async () => {
  const { actions } = setup({ snapshot: { devices: [device], result: null } });
  for (const run of [actions.listOpenRecallsAction({}), actions.checkDeviceAction({ serial: 'SN-1' }), actions.recallDetailsAction({ recallNumber: 'Z-1-2026' })]) {
    const out = await run;
    assert.equal(out.ok, false);
    assert.match(out.error, /saved recall check/);
  }
});

test('a failing snapshot becomes one plain error, and is logged', async () => {
  const { actions, state, logged } = setup();
  state.snapshotError = new Error('storage down');
  const out = await actions.listOpenRecallsAction({});
  assert.deepEqual(out, { ok: false, error: 'RecallRadar could not complete that. Please try again.' });
  assert.equal(logged.error.length, 1);
});

test('only the NAMES of the inputs are logged, never their values', async () => {
  const { actions, logged } = setup();
  await actions.checkDeviceAction({ serial: 'SECRET-SERIAL-123', context: { accountId: 'acct-xyz' } });
  const text = JSON.stringify(logged.info);
  assert.match(text, /serial/);
  assert.doesNotMatch(text, /SECRET-SERIAL-123|acct-xyz/);
});

test('create_remediation_tasks previews first (a token, nothing created), then creates exactly what was previewed', async () => {
  const { actions, created, logged } = setup();
  const context = { extension: { issue: { key: 'KAN-1' } } };
  const preview = await actions.createRemediationTasksAction({ recallClass: 'I' }, context);
  assert.equal(preview.ok, true, JSON.stringify([preview, logged.error.map((e) => String((e[1] && e[1].stack) || e[1]).slice(0, 300))]));
  assert.ok(preview.confirmationToken, 'a one-use token');
  assert.equal(created.length, 0, 'a preview creates nothing');
  assert.match(JSON.stringify(preview), /KAN/, 'the project is taken from the issue the chat is in');
  const done = await actions.createRemediationTasksAction({ confirmed: true, confirmationToken: preview.confirmationToken }, context);
  assert.equal(done.ok, true);
  assert.equal(created.length, 1);
  const reused = await actions.createRemediationTasksAction({ confirmed: true, confirmationToken: preview.confirmationToken }, context);
  assert.equal(created.length, 1, 'a token works once');
  assert.notEqual(reused.state, 'created');
});

test('create_recall_page asks for a space instead of guessing', async () => {
  const { actions } = setup();
  const out = await actions.createRecallPageAction({});
  assert.equal(out.needsSpace, true);
  assert.deepEqual(out.availableSpaces, [{ key: 'MD', name: 'Mobile Dev' }]);
});

test('who_handles_ward reads the saved mapping and the graph, and fails plainly', async () => {
  const { actions } = setup();
  const out = await actions.whoHandlesWardAction({ ward: 'ICU' });
  assert.equal(typeof out.ok, 'boolean');
  const broken = createRovoHandlers({ wardTeams: { async get() { throw new Error('x'); }, async list() { throw new Error('x'); } }, teamGraph: {}, openTaskCounts: async () => new Map(), log: { info() {}, error() {} } });
  assert.deepEqual(await broken.whoHandlesWardAction({ ward: 'ICU' }), { ok: false, error: 'RecallRadar could not read the Teamwork Graph. Please try again.' });
});

test('projectKeyFrom looks in every place Rovo documents, in order', () => {
  assert.equal(projectKeyFrom({ context: { jira: { projectKey: 'ABC' } } }, {}), 'ABC');
  assert.equal(projectKeyFrom({ context: { jira: { issueKey: 'MOBL-57' } } }, {}), 'MOBL');
  assert.equal(projectKeyFrom({}, { extension: { issue: { key: 'KAN-3' } } }), 'KAN');
  assert.equal(projectKeyFrom({}, { extension: { project: { key: 'XYZ' } } }), 'XYZ');
  assert.equal(projectKeyFrom({}, {}), '');
  assert.equal(projectKeyFrom(undefined, undefined), '');
});
