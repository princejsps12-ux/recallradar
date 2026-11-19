import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUARD_TTL_MS,
  BULK_CREATE_LIMIT,
  MAX_PAIRS_PER_REQUEST,
  MAX_STATE_PAIRS_PER_REQUEST,
  createTaskGuard,
  createTasks,
  getTaskStates,
  getTaskStatuses,
  validatePairs,
  selectMatches,
} from './taskService.js';
import { pairKey, taskLabel } from './taskRules.js';
import { fakeKv } from './fakeKv.mjs';

const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
const TODAY = new Date(T0);

const match = (n, extra = {}) => ({
  confidence: 'exact',
  reason: 'because',
  deviceId: `demo-${String(n).padStart(3, '0')}`,
  deviceName: `Device ${n}`,
  deviceManufacturer: 'ICU Medical',
  deviceModel: 'M1000',
  lotOrSerial: `SN${n}`,
  ward: 'ICU',
  recallNumber: 'Z-1-2026',
  recallClass: 'II',
  firm: 'ICU Medical, Inc.',
  product: 'pump',
  date: '2026-07-22',
  ...extra,
});

// A fake Jira: remembers which labels already have a task, and numbers new issues P-1, P-2, ...
function fakeJira({ existing = {}, issueTypeId = '10002', failIndexes = [], bulkError = null, searchError = null } = {}) {
  const state = { existing: new Map(Object.entries(existing)), next: 1, searches: [], bulkCalls: [], created: [] };
  const jira = {
    async findByLabels(labels) {
      if (searchError) throw searchError;
      state.searches.push(labels);
      const found = new Map();
      for (const label of labels) if (state.existing.has(label)) found.set(label, state.existing.get(label));
      return found;
    },
    // The same lookup with Jira's status of each task (every fake task is "To Do", i.e. category new).
    async findTasks(labels) {
      const keys = await this.findByLabels(labels);
      return new Map([...keys].map(([label, key]) => [label, { key, status: 'To Do', category: 'new' }]));
    },
    async taskIssueTypeId() {
      return issueTypeId;
    },
    async bulkCreate(fieldsList) {
      state.bulkCalls.push(fieldsList);
      if (bulkError) throw bulkError;
      const created = [];
      const errors = [];
      fieldsList.forEach((fields, index) => {
        if (failIndexes.includes(index)) {
          errors.push({ index, message: 'Jira said no.' });
          return;
        }
        const key = `P-${state.next++}`;
        const label = fields.labels[1];
        state.existing.set(label, key);
        state.created.push({ key, fields });
        created.push({ index, key });
      });
      return { created, errors };
    },
  };
  return { jira, state };
}

function setup(jiraOptions) {
  const clock = { now: T0 };
  const kv = fakeKv();
  const guard = createTaskGuard(kv, () => clock.now);
  const { jira, state } = fakeJira(jiraOptions);
  return { clock, kv, guard, jira, state };
}

const run = (s, matches, extra = {}) =>
  createTasks({ matches, jira: s.jira, guard: s.guard, projectKey: 'MOBL', today: TODAY, ...extra });

// --- Creating ------------------------------------------------------------------------------------------

test('creates one task per task-worthy match, with the planned fields', async () => {
  const s = setup();
  const out = await run(s, [match(1), match(2, { confidence: 'likely' })]);
  assert.deepEqual(out.created.map((c) => c.key), ['P-1', 'P-2']);
  assert.deepEqual(out.created.map((c) => c.pair), [pairKey('Z-1-2026', 'demo-001'), pairKey('Z-1-2026', 'demo-002')]);
  assert.equal(s.state.bulkCalls.length, 1); // one bulk call, not two
  const fields = s.state.created[0].fields;
  assert.deepEqual(fields.project, { key: 'MOBL' });
  assert.deepEqual(fields.issuetype, { id: '10002' });
  assert.equal(fields.duedate, '2026-11-21');
});

test('"possible" matches are skipped, never created', async () => {
  const s = setup();
  const out = await run(s, [match(1), match(2, { confidence: 'possible' })]);
  assert.equal(out.created.length, 1);
  assert.deepEqual(out.skipped, [pairKey('Z-1-2026', 'demo-002')]);
});

test('nothing to do means no Jira calls', async () => {
  const s = setup();
  const out = await run(s, [match(1, { confidence: 'possible' })]);
  assert.equal(s.state.searches.length, 0);
  assert.equal(s.state.bulkCalls.length, 0);
  assert.equal(out.created.length, 0);
});

// --- Never a duplicate ---------------------------------------------------------------------------------

test('a task that already exists in Jira is reported, not created again', async () => {
  const s = setup({ existing: { [taskLabel('Z-1-2026', 'demo-001')]: 'P-99' } });
  const out = await run(s, [match(1), match(2)]);
  assert.deepEqual(out.existing, [{ pair: pairKey('Z-1-2026', 'demo-001'), key: 'P-99' }]);
  assert.deepEqual(out.created.map((c) => c.pair), [pairKey('Z-1-2026', 'demo-002')]);
});

test('clicking again creates nothing: the second run finds the tasks the first made', async () => {
  const s = setup();
  await run(s, [match(1), match(2)]);
  s.clock.now += GUARD_TTL_MS + 1; // long after the guard has expired, so only Jira's answer counts
  const again = await run(s, [match(1), match(2)]);
  assert.equal(again.created.length, 0);
  assert.equal(again.existing.length, 2);
  assert.equal(s.state.created.length, 2);
});

test('the same pair listed twice in one request makes one task', async () => {
  const s = setup();
  const out = await run(s, [match(1), match(1)]);
  assert.equal(out.created.length, 1);
  assert.equal(s.state.created.length, 1);
});

test('a double click is caught by the guard even if Jira\'s search has not caught up yet', async () => {
  const s = setup();
  await run(s, [match(1)]);
  // Jira's search index lags: forget what Jira would report, as if the new issue were not visible yet.
  s.state.existing.clear();
  const second = await run(s, [match(1)]);
  assert.equal(second.created.length, 0);
  assert.deepEqual(second.existing, [{ pair: pairKey('Z-1-2026', 'demo-001'), key: 'P-1' }]);
});

test('a task being created right now by another click is reported as in progress', async () => {
  const s = setup();
  await s.guard.reserve(taskLabel('Z-1-2026', 'demo-001')); // the other click has claimed it but not finished
  const out = await run(s, [match(1)]);
  assert.deepEqual(out.inProgress, [pairKey('Z-1-2026', 'demo-001')]);
  assert.equal(out.created.length, 0);
});

test('an abandoned claim expires, so a crashed request cannot block a task forever', async () => {
  const s = setup();
  await s.guard.reserve(taskLabel('Z-1-2026', 'demo-001'));
  s.clock.now += GUARD_TTL_MS;
  assert.equal((await run(s, [match(1)])).created.length, 1);
});

test('a task deleted in Jira can be created again once the guard has expired', async () => {
  const s = setup();
  await run(s, [match(1)]);
  s.state.existing.clear(); // deleted in Jira
  s.clock.now += GUARD_TTL_MS;
  assert.equal((await run(s, [match(1)])).created.length, 1);
});

test('different devices for the same recall each get their own task', async () => {
  const s = setup();
  assert.equal((await run(s, [match(1), match(2), match(3)])).created.length, 3);
});

test('the same device with different recalls each gets its own task', async () => {
  const s = setup();
  const out = await run(s, [match(1, { recallNumber: 'Z-1-2026' }), match(1, { recallNumber: 'Z-2-2026' })]);
  assert.equal(out.created.length, 2);
});

// --- Failures ---------------------------------------------------------------------------------------------

test('a task Jira refuses is reported as failed and can be retried', async () => {
  const s = setup({ failIndexes: [1] });
  const out = await run(s, [match(1), match(2), match(3)]);
  assert.deepEqual(out.created.map((c) => c.pair), [pairKey('Z-1-2026', 'demo-001'), pairKey('Z-1-2026', 'demo-003')]);
  assert.deepEqual(out.failed, [{ pair: pairKey('Z-1-2026', 'demo-002'), error: 'Jira said no.' }]);
  // The failed one was released, so a retry is not blocked by the guard.
  assert.equal(await s.guard.read(taskLabel('Z-1-2026', 'demo-002')), null);
});

test('if the whole bulk call fails, every task is reported failed and none is blocked', async () => {
  const s = setup({ bulkError: new Error('Jira answered 500') });
  const out = await run(s, [match(1), match(2)]);
  assert.equal(out.created.length, 0);
  assert.equal(out.failed.length, 2);
  assert.match(out.failed[0].error, /500/);
  assert.equal(await s.guard.read(taskLabel('Z-1-2026', 'demo-001')), null);
});

test('a project with no usable issue type fails every task with a clear message', async () => {
  const s = setup({ issueTypeId: null });
  const out = await run(s, [match(1)]);
  assert.equal(out.failed.length, 1);
  assert.match(out.failed[0].error, /no issue type/);
  assert.equal(s.state.bulkCalls.length, 0);
});

test('if Jira\'s search fails, nothing is created (we cannot rule out duplicates)', async () => {
  const s = setup({ searchError: new Error('search down') });
  await assert.rejects(run(s, [match(1)]), /search down/);
  assert.equal(s.state.bulkCalls.length, 0);
});

test('a storage problem does not block creating tasks', async () => {
  const s = setup();
  s.kv.get = async () => {
    throw new Error('storage down');
  };
  assert.equal((await run(s, [match(1)])).created.length, 1);
});

// --- Size --------------------------------------------------------------------------------------------------

test('more tasks than one bulk call allows are split into several calls', async () => {
  const s = setup();
  const many = Array.from({ length: BULK_CREATE_LIMIT + 7 }, (_, i) => match(i + 1));
  const out = await run(s, many);
  assert.equal(out.created.length, many.length);
  assert.equal(s.state.bulkCalls.length, 2);
  assert.equal(s.state.bulkCalls[0].length, BULK_CREATE_LIMIT);
  assert.equal(s.state.bulkCalls[1].length, 7);
});

test('the bulk limit is Jira\'s 50', () => {
  assert.equal(BULK_CREATE_LIMIT, 50);
});

// --- The guard itself -----------------------------------------------------------------------------------------

test('the guard remembers a created task until it expires', async () => {
  const clock = { now: T0 };
  const guard = createTaskGuard(fakeKv(), () => clock.now);
  await guard.record('label-a', 'P-5');
  assert.equal((await guard.read('label-a')).key, 'P-5');
  clock.now += GUARD_TTL_MS - 1;
  assert.ok(await guard.read('label-a'));
  clock.now += 1;
  assert.equal(await guard.read('label-a'), null);
});

test('the guard ignores damaged entries and entries dated in the future', async () => {
  const clock = { now: T0 };
  const kv = fakeKv({
    'task-guard:bad': 'text',
    'task-guard:future': { at: T0 + 60000 },
    'task-guard:nodate': { key: 'P-1' },
  });
  const guard = createTaskGuard(kv, () => clock.now);
  for (const label of ['bad', 'future', 'nodate', 'missing']) assert.equal(await guard.read(label), null, label);
});

test('releasing a claim removes it', async () => {
  const guard = createTaskGuard(fakeKv(), () => T0);
  await guard.reserve('label-a');
  await guard.release('label-a');
  assert.equal(await guard.read('label-a'), null);
});

// --- Showing what already has a task ------------------------------------------------------------------------------

test('getTaskStates maps each pair that has a task to its issue key', async () => {
  const s = setup({ existing: { [taskLabel('Z-1-2026', 'demo-001')]: 'P-7' } });
  const tasks = await getTaskStates({ matches: [match(1), match(2)], jira: s.jira, guard: s.guard });
  assert.deepEqual(tasks, { [pairKey('Z-1-2026', 'demo-001')]: 'P-7' });
});

test('getTaskStates ignores "possible" matches and never creates anything', async () => {
  const s = setup();
  const tasks = await getTaskStates({ matches: [match(1, { confidence: 'possible' })], jira: s.jira, guard: s.guard });
  assert.deepEqual(tasks, {});
  assert.equal(s.state.bulkCalls.length, 0);
});

test('getTaskStates shows a task the guard knows about before Jira\'s search does', async () => {
  const s = setup();
  await s.guard.record(taskLabel('Z-1-2026', 'demo-001'), 'P-3');
  const tasks = await getTaskStates({ matches: [match(1)], jira: s.jira, guard: s.guard });
  assert.equal(tasks[pairKey('Z-1-2026', 'demo-001')], 'P-3');
});

test('getTaskStates does not count a claim that is still in progress as a finished task', async () => {
  const s = setup();
  await s.guard.reserve(taskLabel('Z-1-2026', 'demo-001'));
  assert.deepEqual(await getTaskStates({ matches: [match(1)], jira: s.jira, guard: s.guard }), {});
});

// --- Status of the tasks (closure tracking) ---------------------------------------------------------------------------

test('getTaskStatuses reports the key and Jira\'s own status of each task', async () => {
  const s = setup({ existing: { [taskLabel('Z-1-2026', 'demo-001')]: 'P-7', [taskLabel('Z-1-2026', 'demo-002')]: 'P-8' } });
  const statuses = { 'P-7': { status: 'Closed', category: 'done' }, 'P-8': { status: 'In review', category: 'indeterminate' } };
  const findTasks = s.jira.findTasks;
  s.jira.findTasks = async function withStatus(labels) {
    const found = await findTasks.call(this, labels);
    return new Map([...found].map(([label, task]) => [label, { ...task, ...statuses[task.key] }]));
  };
  const out = await getTaskStatuses({ matches: [match(1), match(2), match(3)], jira: s.jira, guard: s.guard });
  assert.deepEqual(out, {
    [pairKey('Z-1-2026', 'demo-001')]: { key: 'P-7', status: 'Closed', category: 'done' },
    [pairKey('Z-1-2026', 'demo-002')]: { key: 'P-8', status: 'In review', category: 'indeterminate' },
  });
});

test('getTaskStatuses: a task made a moment ago (guard only) is "new" with no status name, and Jira is not asked for it', async () => {
  const s = setup();
  await s.guard.record(taskLabel('Z-1-2026', 'demo-001'), 'P-3');
  const out = await getTaskStatuses({ matches: [match(1), match(2)], jira: s.jira, guard: s.guard });
  assert.deepEqual(out, { [pairKey('Z-1-2026', 'demo-001')]: { key: 'P-3', status: '', category: 'new' } });
  assert.deepEqual(s.state.searches.flat(), [taskLabel('Z-1-2026', 'demo-002')], 'only the label the guard did not know was searched');
});

test('getTaskStatuses: a claim in progress is not a task yet, "possible" matches are ignored, and a Jira failure is thrown, not hidden', async () => {
  const s = setup();
  await s.guard.reserve(taskLabel('Z-1-2026', 'demo-001'));
  assert.deepEqual(await getTaskStatuses({ matches: [match(1), match(2, { confidence: 'possible' })], jira: s.jira, guard: s.guard }), {});
  const broken = setup({ searchError: new Error('Jira answered 500') });
  await assert.rejects(getTaskStatuses({ matches: [match(1)], jira: broken.jira, guard: broken.guard }), /500/);
});

test('getTaskStates is the same answer reduced to the issue key', async () => {
  const s = setup({ existing: { [taskLabel('Z-1-2026', 'demo-001')]: 'P-7' } });
  assert.deepEqual(await getTaskStates({ matches: [match(1)], jira: s.jira, guard: s.guard }), { [pairKey('Z-1-2026', 'demo-001')]: 'P-7' });
});

test('guard.readMany lists once and returns only the fresh entries asked for', async () => {
  const clock = { now: T0 };
  const kv = fakeKv();
  const guard = createTaskGuard(kv, () => clock.now);
  await guard.record('a', 'P-1');
  await guard.record('b', 'P-2');
  await guard.record('other', 'P-3');
  clock.now += GUARD_TTL_MS - 1;
  await guard.record('c', 'P-4');
  let lists = 0;
  const listByPrefix = kv.listByPrefix;
  kv.listByPrefix = async (...args) => { lists += 1; return listByPrefix(...args); };
  clock.now += 1; // a, b and other are now expired; c is fresh
  const found = await guard.readMany(['a', 'b', 'c', 'missing']);
  assert.deepEqual([...found.keys()], ['c']);
  assert.equal(found.get('c').key, 'P-4');
  assert.equal(lists, 1);
});

test('guard.readMany falls back to single reads when the storage cannot list, or listing fails', async () => {
  const clock = { now: T0 };
  const kv = fakeKv();
  const guard = createTaskGuard(kv, () => clock.now);
  await guard.record('a', 'P-1');
  await guard.record('b', 'P-2');
  kv.listByPrefix = async () => { throw new Error('storage trouble'); };
  assert.deepEqual([...(await guard.readMany(['a', 'b', 'x'])).keys()].sort(), ['a', 'b']);
  delete kv.listByPrefix;
  assert.deepEqual([...(await guard.readMany(['a', 'b'])).keys()].sort(), ['a', 'b']);
});

// --- What the browser may ask for ---------------------------------------------------------------------------------

test('validatePairs accepts a list of recall + device pairs and keeps only those two fields', () => {
  const pairs = validatePairs([{ recallNumber: 'Z-1', deviceId: 'd1', summary: 'forged', duedate: '2000-01-01' }]);
  assert.deepEqual(pairs, [{ recallNumber: 'Z-1', deviceId: 'd1' }]);
});

test('validatePairs rejects anything that is not a non-empty list', () => {
  for (const bad of [undefined, null, 'x', {}, []]) {
    assert.throws(() => validatePairs(bad), /No tasks/, String(bad));
  }
});

test('validatePairs rejects pairs with missing, blank or non-text parts', () => {
  for (const bad of [
    [{ deviceId: 'd1' }],
    [{ recallNumber: 'Z-1' }],
    [{ recallNumber: '  ', deviceId: 'd1' }],
    [{ recallNumber: 'Z-1', deviceId: 5 }],
    [null],
    ['Z-1|d1'],
  ]) {
    assert.throws(() => validatePairs(bad), /not valid/, JSON.stringify(bad));
  }
});

test('a request may ask for at most 25 tasks, so it finishes inside the 25 s UI limit', () => {
  assert.equal(MAX_PAIRS_PER_REQUEST, 25);
});

test('validatePairs refuses an oversized request', () => {
  const many = Array.from({ length: MAX_PAIRS_PER_REQUEST + 1 }, (_, i) => ({ recallNumber: 'Z-1', deviceId: `d${i}` }));
  assert.throws(() => validatePairs(many), /Too many/);
  assert.equal(validatePairs(many.slice(0, MAX_PAIRS_PER_REQUEST)).length, MAX_PAIRS_PER_REQUEST);
});

test('selectMatches takes the full match from the saved result, in the order asked', () => {
  const saved = [match(1), match(2), match(3)];
  const { matches, notFound } = selectMatches(saved, [
    { recallNumber: 'Z-1-2026', deviceId: 'demo-003' },
    { recallNumber: 'Z-1-2026', deviceId: 'demo-001' },
  ]);
  assert.deepEqual(matches.map((m) => m.deviceId), ['demo-003', 'demo-001']);
  assert.deepEqual(notFound, []);
});

test('selectMatches never trusts the page: a pair that is not in the saved result is not found', () => {
  const { matches, notFound } = selectMatches([match(1)], [{ recallNumber: 'Z-9-2026', deviceId: 'demo-001' }]);
  assert.deepEqual(matches, []);
  assert.deepEqual(notFound, ['Z-9-2026|demo-001']);
});

test('a lookup may carry more pairs than a creation request, since it only searches Jira', () => {
  assert.ok(MAX_STATE_PAIRS_PER_REQUEST > MAX_PAIRS_PER_REQUEST);
  const pairs = Array.from({ length: 35 }, (_, i) => ({ recallNumber: 'Z-1', deviceId: `d${i}` }));
  assert.throws(() => validatePairs(pairs), /Too many/); // too many to CREATE in one request ...
  assert.equal(validatePairs(pairs, MAX_STATE_PAIRS_PER_REQUEST).length, 35); // ... but fine to look up
});

test('the lookup limit still stops an absurdly large request', () => {
  const huge = Array.from({ length: MAX_STATE_PAIRS_PER_REQUEST + 1 }, (_, i) => ({ recallNumber: 'Z-1', deviceId: `d${i}` }));
  assert.throws(() => validatePairs(huge, MAX_STATE_PAIRS_PER_REQUEST), /Too many/);
});

// --- Assignees ----------------------------------------------------------------------------------------------

test('a task is unassigned unless the caller passes an assignee for it', async () => {
  const s = setup();
  await run(s, [match(1)]);
  assert.equal('assignee' in s.state.created[0].fields, false);
});

test('an agreed assignee is set on exactly that task', async () => {
  const s = setup();
  const assignees = new Map([[pairKey('Z-1-2026', 'demo-002'), { accountId: 'acc-2', name: 'Sam' }]]);
  await run(s, [match(1), match(2)], { assignees });
  assert.equal('assignee' in s.state.created[0].fields, false);
  assert.deepEqual(s.state.created[1].fields.assignee, { accountId: 'acc-2' });
});

test('an assignee for a task that already exists changes nothing', async () => {
  const s = setup({ existing: { [taskLabel('Z-1-2026', 'demo-001')]: 'P-9' } });
  const assignees = new Map([[pairKey('Z-1-2026', 'demo-001'), { accountId: 'acc-1' }]]);
  const out = await run(s, [match(1)], { assignees });
  assert.equal(out.created.length, 0);
  assert.equal(s.state.bulkCalls.length, 0);
});

// --- Cleanup of guards --------------------------------------------------------------------------------------------

test('guards: purgeExpired deletes expired and damaged guards and keeps fresh ones and other keys', async () => {
  const kv = fakeKv();
  const clock = { now: T0 };
  const guard = createTaskGuard(kv, () => clock.now);
  await guard.reserve('recallradar-Z-1-a');
  kv.data.set('task-guard:old', { at: T0 - GUARD_TTL_MS - 1, key: 'P-1' });
  kv.data.set('task-guard:broken', 'text');
  kv.data.set('device:other', { at: 0 });
  assert.equal(await guard.purgeExpired(), 2);
  assert.deepEqual([...kv.data.keys()].sort(), ['device:other', 'task-guard:recallradar-Z-1-a']);
  clock.now += GUARD_TTL_MS;
  assert.equal(await guard.purgeExpired(), 1);
});

test('guards: reading an expired guard deletes it', async () => {
  const kv = fakeKv({ 'task-guard:x': { at: T0 - GUARD_TTL_MS - 1 } });
  const guard = createTaskGuard(kv, () => T0);
  assert.equal(await guard.read('x'), null);
  await new Promise((r) => setImmediate(r));
  assert.equal(kv.data.has('task-guard:x'), false);
});

test('creating tasks clears out expired guards on the way', async () => {
  const s = setup();
  s.kv.data.set('task-guard:stale', { at: T0 - GUARD_TTL_MS - 1 });
  await run(s, [match(1)]);
  assert.equal(s.kv.data.has('task-guard:stale'), false);
});

test('two requests for the same pair at the same moment create ONE task: the claim is atomic', async () => {
  const s = setup();
  const [a, b] = await Promise.all([run(s, [match(1)]), run(s, [match(1)])]);
  assert.equal(s.state.created.length, 1, 'Jira got one task');
  assert.equal(a.created.length + b.created.length, 1);
  assert.equal(a.inProgress.length + b.inProgress.length, 1, 'the other request is told it is in progress');
});

test('guard.claim: a fresh claim is refused, an expired one can be taken, and a failed creation releases it', async () => {
  const clock = { now: T0 };
  const kv = fakeKv();
  const guard = createTaskGuard(kv, () => clock.now);
  assert.equal(await guard.claim('a'), true);
  assert.equal(await guard.claim('a'), false);
  clock.now += GUARD_TTL_MS;
  assert.equal(await guard.claim('a'), true, 'the claim expired (the real storage deletes it by ttl; read() does here)');
  await guard.release('a');
  assert.equal(await guard.claim('a'), true);
});


// --- Team routing and escalation ---------------------------------------------------------------------------------------------
import { createTeamRouter } from './teamRouting.js';

test('createTasks labels each task for the team that owns the ward, escalates when the team is swamped, and reports it', async () => {
  const fields = [];
  const jira = {
    findByLabels: async () => new Map(),
    taskIssueTypeId: async () => '10001',
    bulkCreate: async (list) => { fields.push(...list); return { created: list.map((_, index) => ({ index, key: `MOBL-${index + 1}` })), errors: [] }; },
  };
  const guard = { read: async () => null, claim: async () => true, record: async () => {}, release: async () => {}, reserve: async () => {} };
  const match = (n, ward) => ({ recallNumber: 'Z-1-2026', deviceId: `d${n}`, deviceName: 'Pump', deviceManufacturer: 'Acme', deviceModel: 'X', ward, recallClass: 'I', confidence: 'exact', reason: 'r', firm: 'Acme', date: '2026-01-01', product: 'p' });
  const routing = createTeamRouter({ store: { async get(ward) { return ward === 'ICU' ? { teamName: 'Team Atlas' } : null; } }, countOpen: async () => 9, limit: 10 });
  const out = await createTasks({ matches: [match(1, 'ICU'), match(2, 'ICU'), match(3, 'ER')], jira, guard, projectKey: 'MOBL', today: new Date('2026-11-18T00:00:00Z'), routing });
  assert.equal(out.created.length, 3);
  assert.deepEqual(out.routed, [{ pair: 'Z-1-2026|d1', team: 'Team Atlas', escalated: false }, { pair: 'Z-1-2026|d2', team: 'Team Atlas', escalated: true }]);
  assert.ok(fields[0].labels.includes('recallradar-team-team-atlas'));
  assert.ok(!fields[0].labels.includes('recallradar-escalated'));
  assert.ok(fields[1].labels.includes('recallradar-escalated'));
  assert.ok(!fields[2].labels.some((l) => l.startsWith('recallradar-team-')), 'a ward without a team is created as before');
  assert.match(JSON.stringify(fields[1].description), /Escalated/);
});

test('a routing failure never stops a task from being created', async () => {
  const jira = { findByLabels: async () => new Map(), taskIssueTypeId: async () => '1', bulkCreate: async (list) => ({ created: list.map((_, index) => ({ index, key: `K-${index}` })), errors: [] }) };
  const guard = { read: async () => null, claim: async () => true, record: async () => {}, release: async () => {}, reserve: async () => {} };
  const m = { recallNumber: 'Z-1', deviceId: 'd1', deviceName: 'P', deviceManufacturer: 'A', deviceModel: 'X', ward: 'ICU', recallClass: 'II', confidence: 'likely', reason: 'r', firm: 'A', date: '2026-01-01', product: 'p' };
  const out = await createTasks({ matches: [m], jira, guard, projectKey: 'K', today: new Date(), routing: { route: async () => { throw new Error('graph'); } } });
  assert.equal(out.created.length, 1);
  assert.deepEqual(out.routed, []);
});
