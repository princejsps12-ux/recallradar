import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  MAX_TASKS_PER_ACTION,
  PREVIEW_TTL_MS,
  CLASS_MEANINGS,
  parseRecallClassInput,
  readInputs,
  wardMatches,
  listOpenRecalls,
  groupByDevice,
  checkDevice,
  recallDetails,
  createRemediationTasks,
  createRemediationTask,
  createPreviewStore,
  noData,
} from './agentTools.js';
import { createTaskGuard } from './taskService.js';
import { pairKey, taskLabel } from './taskRules.js';
import { fakeKv } from './fakeKv.mjs';

const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);

// --- Fixtures: a small hospital and the saved check for it -------------------------------------------------------------

const device = (id, extra = {}) => ({
  id,
  name: `Device ${id}`,
  type: 'infusion pump',
  manufacturer: 'ICU Medical',
  model: `M-${id}`,
  lotOrSerial: `SN-${id}`,
  ward: 'ICU',
  ...extra,
});

const match = (deviceId, recallNumber, extra = {}) => ({
  confidence: 'exact',
  rule: 'exact-manufacturer-model-lot',
  reason: `reason for ${deviceId}`,
  deviceId,
  deviceName: `Device ${deviceId}`,
  deviceManufacturer: 'ICU Medical',
  deviceModel: `M-${deviceId}`,
  lotOrSerial: `SN-${deviceId}`,
  ward: 'ICU',
  recallNumber,
  recallClass: 'I',
  firm: 'ICU Medical, Inc.',
  product: 'Plum Duo pump',
  date: '2026-07-22',
  ...extra,
});

const devices = [
  device('d1'),
  device('d2', { ward: 'ER' }),
  device('d3', { ward: 'Med-Surg 3W', manufacturer: 'Baxter Healthcare', model: '40800BAXUS', lotOrSerial: '' }),
  device('d4', { ward: 'ICU' }),
  device('d5', { ward: 'ICU' }),
];

const matches = [
  match('d1', 'Z-1-2026', { recallClass: 'I' }),
  match('d2', 'Z-1-2026', { recallClass: 'I', ward: 'ER' }),
  match('d3', 'Z-2-2026', { recallClass: 'II', ward: 'Med-Surg 3W', confidence: 'likely', reason: 'model matches, serial unknown', firm: 'Baxter Healthcare Corporation' }),
  match('d4', 'Z-3-2026', { recallClass: 'III', confidence: 'possible', reason: 'same maker and kind of device' }),
  match('d5', 'Z-9-2026', { recallClass: 'II' }), // this recall is closed (see recallDetails)
];

const result = (extra = {}) => ({
  deviceCount: 5,
  recallCount: 12,
  checkedAt: new Date(T0 - 3600 * 1000).toISOString(),
  stale: false,
  failedQueries: 0,
  matches,
  recallDetails: {
    'Z-1-2026': { status: 'Ongoing', initiated: '2026-06-01', reason: 'Pump software can stop an infusion without an alarm.' },
    'Z-2-2026': { status: 'Ongoing', initiated: '2026-07-01', reason: 'Label may be wrong.' },
    'Z-9-2026': { status: 'Terminated', initiated: '2025-01-01', reason: 'Old issue.' },
  },
  ...extra,
});

const snap = (extra) => ({ devices, result: extra === null ? null : result(extra) });
const ids = (items) => items.map((i) => `${i.recallNumber}|${i.deviceId}`);

// --- Inputs ------------------------------------------------------------------------------------------------------------------

test('recall class input accepts the common spellings and rejects the rest', () => {
  for (const [input, expected] of [['I', 'I'], ['ii', 'II'], ['Class III', 'III'], ['class 2', 'II'], [1, 'I'], ['3', 'III'], ['', ''], [undefined, '']]) {
    assert.equal(parseRecallClassInput(input), expected, String(input));
  }
  for (const bad of ['IV', 'high', '0', 'class x']) assert.equal(parseRecallClassInput(bad), null, bad);
});

test('readInputs finds the inputs on the payload, or in payload.inputs', () => {
  assert.deepEqual(readInputs({ ward: 'ICU' }), { ward: 'ICU' });
  assert.deepEqual(readInputs({ inputs: { ward: 'ER' }, context: {} }), { ward: 'ER' });
  assert.deepEqual(readInputs(undefined), {});
});

test('ward matching ignores case and punctuation and allows a partial ward name', () => {
  assert.equal(wardMatches('ICU', 'icu'), true);
  assert.equal(wardMatches('Med-Surg 3W', 'med surg'), true);
  assert.equal(wardMatches('Med-Surg 3W', 'Med-Surg 3W'), true);
  assert.equal(wardMatches('ICU', 'ER'), false);
  assert.equal(wardMatches('ICU', ''), true);
  assert.equal(wardMatches('', 'ICU'), false);
});

// --- list_open_recalls -----------------------------------------------------------------------------------------------

test('list: without a saved check it says how to get one', async () => {
  const out = await listOpenRecalls({ snapshot: snap(null) });
  assert.equal(out.ok, false);
  assert.match(out.error, /saved recall check/);
});

test('list: with no devices at all it says so and how to load them', async () => {
  const out = await listOpenRecalls({ snapshot: { devices: [], result: null } });
  assert.equal(out.ok, false);
  assert.match(out.error, /no devices on this site yet/);
  assert.match(out.error, /RecallRadar dashboard in Jira/);
  assert.match(out.error, /Load demo hospital/);
  assert.doesNotMatch(out.error, /Rovo Home|out of reach/, 'one installation serves Jira, Confluence and Rovo Home, so there is no other place to blame');
});

test('devices without a saved check ask for a check instead', () => {
  const out = noData({ devices, result: null });
  assert.equal(out.ok, false);
  assert.match(out.error, /saved recall check/);
  assert.doesNotMatch(out.error, /no devices/);
});

test('every tool that needs the saved check gives the same no-devices answer', async () => {
  const snapshot = { devices: [], result: null };
  const expected = noData(snapshot).error;
  assert.equal((await listOpenRecalls({ snapshot })).error, expected);
  assert.equal((await checkDevice({ snapshot, inputs: { serial: 'SN-d1' } })).error, expected);
  assert.equal((await recallDetails({ snapshot, inputs: { recallNumber: 'Z-1-2026' } })).error, expected);
});

test('list: returns exact and likely matches only, never possible ones, and drops closed recalls', async () => {
  const out = await listOpenRecalls({ snapshot: snap() });
  assert.equal(out.ok, true);
  assert.deepEqual(ids(out.items), ['Z-1-2026|d1', 'Z-1-2026|d2', 'Z-2-2026|d3']);
  assert.equal(out.total, 3);
});

test('list: every item carries the real recall number, device id, ward, class and confidence', async () => {
  const [first] = (await listOpenRecalls({ snapshot: snap() })).items;
  assert.equal(first.recallNumber, 'Z-1-2026');
  assert.equal(first.deviceId, 'd1');
  assert.equal(first.ward, 'ICU');
  assert.equal(first.recallClass, 'I');
  assert.equal(first.confidence, 'exact');
  assert.equal(first.recallStatus, 'Ongoing');
  assert.ok(first.whyMatched);
});

test('list: filters by ward', async () => {
  const out = await listOpenRecalls({ snapshot: snap(), inputs: { ward: 'ICU' } });
  assert.deepEqual(ids(out.items), ['Z-1-2026|d1']);
  assert.deepEqual(out.filtersApplied, { ward: 'ICU' });
});

test('list: filters by recall class, in any spelling', async () => {
  for (const cls of ['I', 'class I', '1']) {
    assert.deepEqual(ids((await listOpenRecalls({ snapshot: snap(), inputs: { recallClass: cls } })).items), ['Z-1-2026|d1', 'Z-1-2026|d2'], cls);
  }
  assert.deepEqual(ids((await listOpenRecalls({ snapshot: snap(), inputs: { recallClass: 'II' } })).items), ['Z-2-2026|d3']);
});

test('list: filters by ward AND class together ("Which ICU devices have open Class I recalls?")', async () => {
  const out = await listOpenRecalls({ snapshot: snap(), inputs: { ward: 'ICU', recallClass: 'I' } });
  assert.deepEqual(ids(out.items), ['Z-1-2026|d1']);
});

test('list: filters by confidence', async () => {
  assert.deepEqual(ids((await listOpenRecalls({ snapshot: snap(), inputs: { confidence: 'likely' } })).items), ['Z-2-2026|d3']);
});

test('list: rejects bad filters with a clear message', async () => {
  assert.match((await listOpenRecalls({ snapshot: snap(), inputs: { recallClass: 'IV' } })).error, /recallClass/);
  assert.match((await listOpenRecalls({ snapshot: snap(), inputs: { confidence: 'possible' } })).error, /confidence/);
  assert.match((await listOpenRecalls({ snapshot: snap(), inputs: { confidence: 'maybe' } })).error, /confidence/);
});

test('list: an empty answer says so and names the wards that do have matches', async () => {
  const out = await listOpenRecalls({ snapshot: snap(), inputs: { ward: 'Pediatrics' } });
  assert.equal(out.total, 0);
  assert.deepEqual(out.items, []);
  assert.match(out.message, /No device/);
  assert.deepEqual(out.wardsWithMatches, ['ER', 'ICU', 'Med-Surg 3W']);
});

test('list: a long answer is cut to the limit, and says how many there were', async () => {
  const many = Array.from({ length: 60 }, (_, i) => match(`x${i}`, `Z-${i}-2026`));
  const out = await listOpenRecalls({ snapshot: { devices, result: result({ matches: many, recallDetails: {} }) }, inputs: { limit: 5 } });
  assert.equal(out.shown, 5);
  assert.equal(out.total, 60);
  assert.match(out.note, /first 5 of 60/);
});

test('list: the limit has a default and a maximum', async () => {
  const many = Array.from({ length: 80 }, (_, i) => match(`x${i}`, `Z-${i}-2026`));
  const snapshot = { devices, result: result({ matches: many, recallDetails: {} }) };
  assert.equal((await listOpenRecalls({ snapshot })).shown, DEFAULT_LIST_LIMIT);
  assert.equal((await listOpenRecalls({ snapshot, inputs: { limit: 999 } })).shown, MAX_LIST_LIMIT);
  assert.equal((await listOpenRecalls({ snapshot, inputs: { limit: 'abc' } })).shown, DEFAULT_LIST_LIMIT);
  assert.equal((await listOpenRecalls({ snapshot, inputs: { limit: -3 } })).shown, DEFAULT_LIST_LIMIT);
});

test('list: the citations are exactly the recall numbers and device ids that were shown', async () => {
  const out = await listOpenRecalls({ snapshot: snap(), inputs: { ward: 'ICU' } });
  assert.deepEqual(out.citations.recallNumbers, ['Z-1-2026']);
  assert.deepEqual(out.citations.deviceIds, ['d1']);
  assert.match(out.citations.rule, /Never invent/);
});

test('list: a recall with no saved status counts as open (older saved check)', async () => {
  const out = await listOpenRecalls({ snapshot: snap({ recallDetails: undefined }) });
  assert.equal(out.total, 4); // the "closed" Z-9-2026 can no longer be told apart, so it is included
});

test('list: says how fresh the data is, and warns when stale or incomplete', async () => {
  const fresh = await listOpenRecalls({ snapshot: snap() });
  assert.equal(fresh.basedOn.stale, false);
  assert.equal(fresh.basedOn.note, undefined);
  const stale = await listOpenRecalls({ snapshot: snap({ stale: true, failedQueries: 2 }) });
  assert.match(stale.basedOn.note, /older than 6 hours/);
  assert.match(stale.basedOn.warning, /incomplete/);
  assert.match(fresh.basedOn.source, /no live openFDA/);
});

test('list: shows existing Jira tasks when a lookup is given, and survives a lookup failure', async () => {
  const getTaskKeys = async () => ({ [pairKey('Z-1-2026', 'd1')]: 'MOBL-5' });
  const out = await listOpenRecalls({ snapshot: snap(), deps: { getTaskKeys } });
  assert.equal(out.items.find((i) => i.deviceId === 'd1').jiraTask, 'MOBL-5');
  assert.equal(out.items.find((i) => i.deviceId === 'd2').jiraTask, undefined);
  const broken = await listOpenRecalls({ snapshot: snap(), deps: { getTaskKeys: async () => { throw new Error('jira down'); } } });
  assert.equal(broken.ok, true);
  assert.equal(broken.items.length, 3);
});

test('list: summarises by class and confidence', async () => {
  const out = await listOpenRecalls({ snapshot: snap() });
  assert.deepEqual(out.summary.byRecallClass, { I: 2, II: 1 });
  assert.deepEqual(out.summary.byConfidence, { exact: 2, likely: 1 });
  assert.equal(out.summary.devices, 3);
});

// --- check_device ------------------------------------------------------------------------------------------------------

test('check: needs a model, a serial or a device id', () => {
  assert.match(checkDevice({ snapshot: snap(), inputs: {} }).error, /at least a model/);
  assert.match(checkDevice({ snapshot: snap(), inputs: { manufacturer: 'ICU Medical' } }).error, /at least a model/);
});

test('check: without a saved check it says how to get one', () => {
  assert.match(checkDevice({ snapshot: snap(null), inputs: { serial: 'SN-d1' } }).error, /saved recall check/);
});

test('check: finds a device by serial and reports the exact match with its recall number', () => {
  const out = checkDevice({ snapshot: snap(), inputs: { serial: 'sn-d1' } });
  assert.equal(out.devicesFound, 1);
  assert.equal(out.devices[0].deviceId, 'd1');
  assert.equal(out.devices[0].verdict, 'affected');
  assert.equal(out.devices[0].matches[0].recallNumber, 'Z-1-2026');
  assert.deepEqual(out.citations.recallNumbers, ['Z-1-2026']);
  assert.deepEqual(out.citations.deviceIds, ['d1']);
});

test('check: finds a device by model, ignoring punctuation and case', () => {
  const out = checkDevice({ snapshot: snap(), inputs: { model: '40800 baxus' } });
  assert.equal(out.devices[0].deviceId, 'd3');
  assert.equal(out.devices[0].verdict, 'likely-affected');
});

test('check: finds a device by device id', () => {
  assert.equal(checkDevice({ snapshot: snap(), inputs: { deviceId: 'D2' } }).devices[0].deviceId, 'd2');
});

test('check: a manufacturer narrows the search', () => {
  assert.equal(checkDevice({ snapshot: snap(), inputs: { model: 'M-d1', manufacturer: 'Baxter' } }).devicesFound, 0);
  assert.equal(checkDevice({ snapshot: snap(), inputs: { model: 'M-d1', manufacturer: 'icu medical' } }).devicesFound, 1);
});

test('check: weak matches are reported too, as "possible"', () => {
  const out = checkDevice({ snapshot: snap(), inputs: { deviceId: 'd4' } });
  assert.equal(out.devices[0].verdict, 'possible');
  assert.equal(out.devices[0].matches[0].confidence, 'possible');
});

test('check: a device with no match says no recall was found, and cites nothing it did not find', () => {
  const out = checkDevice({ snapshot: { devices, result: result({ matches: [] }) }, inputs: { deviceId: 'd1' } });
  assert.equal(out.devices[0].verdict, 'no-recall-found');
  assert.deepEqual(out.devices[0].matches, []);
  assert.deepEqual(out.citations.recallNumbers, []);
  assert.deepEqual(out.citations.deviceIds, ['d1']);
});

test('check: a device that is not in the hospital list is not guessed at', () => {
  const out = checkDevice({ snapshot: snap(), inputs: { serial: 'NOPE-123' } });
  assert.equal(out.ok, true);
  assert.equal(out.devicesFound, 0);
  assert.match(out.message, /not in the hospital device list/);
  assert.deepEqual(out.citations.recallNumbers, []);
  assert.deepEqual(out.citations.deviceIds, []);
});

test('check: several devices can share a model, and all are reported', () => {
  const twin = device('d9', { model: 'M-d1' });
  const out = checkDevice({ snapshot: { devices: [...devices, twin], result: result() }, inputs: { model: 'M-d1' } });
  assert.deepEqual(out.devices.map((d) => d.deviceId).sort(), ['d1', 'd9']);
});

// --- recall_details ----------------------------------------------------------------------------------------------------

test('details: needs a recall number', async () => {
  assert.match((await recallDetails({ snapshot: snap(), inputs: {} })).error, /recall number/);
});

test('details: without a saved check it says how to get one', async () => {
  assert.match((await recallDetails({ snapshot: snap(null), inputs: { recallNumber: 'Z-1-2026' } })).error, /saved recall check/);
});

test('details: explains what is wrong, with the class meaning, citing the recall number', async () => {
  const out = await recallDetails({ snapshot: snap(), inputs: { recallNumber: 'Z-1-2026' } });
  assert.equal(out.found, true);
  assert.equal(out.recall.recallNumber, 'Z-1-2026');
  assert.equal(out.recall.recallClass, 'I');
  assert.equal(out.recall.classMeaning, CLASS_MEANINGS.I);
  assert.match(out.recall.whatIsWrong, /stop an infusion without an alarm/);
  assert.equal(out.recall.status, 'Ongoing');
  assert.equal(out.recall.recallInitiated, '2026-06-01');
  assert.deepEqual(out.citations.recallNumbers, ['Z-1-2026']);
});

test('details: lists the affected devices with ward, serial and why they matched', async () => {
  const out = await recallDetails({ snapshot: snap(), inputs: { recallNumber: 'Z-1-2026' } });
  assert.deepEqual(out.affectedDevices.map((d) => d.deviceId), ['d1', 'd2']);
  assert.equal(out.affectedDevices[0].ward, 'ICU');
  assert.equal(out.affectedDevices[0].serialOrLot, 'SN-d1');
  assert.ok(out.affectedDevices[0].whyMatched);
  assert.deepEqual(out.citations.deviceIds, ['d1', 'd2']);
});

test('details: the recall number is found however it is typed', async () => {
  for (const typed of ['z-1-2026', ' Z-1-2026 ', 'Z 1 2026']) {
    assert.equal((await recallDetails({ snapshot: snap(), inputs: { recallNumber: typed } })).found, true, typed);
  }
});

test('details: "what to do" gives the due days for the class and points to the notice, never an invented fix', async () => {
  const one = await recallDetails({ snapshot: snap(), inputs: { recallNumber: 'Z-1-2026' } });
  assert.ok(one.whatToDo.some((s) => /about 2 days/.test(s)));
  assert.ok(one.whatToDo.some((s) => /manufacturer's recall notice/.test(s)));
  const two = await recallDetails({ snapshot: snap(), inputs: { recallNumber: 'Z-2-2026' } });
  assert.ok(two.whatToDo.some((s) => /about 7 days/.test(s)));
});

test('details: a likely match adds a "check the serial first" step', async () => {
  const exact = await recallDetails({ snapshot: snap(), inputs: { recallNumber: 'Z-1-2026' } });
  const likely = await recallDetails({ snapshot: snap(), inputs: { recallNumber: 'Z-2-2026' } });
  assert.ok(!exact.whatToDo.some((s) => /likely/.test(s)));
  assert.ok(likely.whatToDo.some((s) => /likely/.test(s)));
});

test('details: gives real links to the recall record and the FDA database', async () => {
  const out = await recallDetails({ snapshot: snap(), inputs: { recallNumber: 'Z-1-2026' } });
  assert.match(out.links.fdaRecallRecord, /recall_number:%22Z-1-2026%22/);
  assert.match(out.links.fdaRecallDatabase, /accessdata\.fda\.gov/);
});

test('details: when the saved check has no reason text, it says so instead of making one up', async () => {
  const out = await recallDetails({ snapshot: snap({ recallDetails: {} }), inputs: { recallNumber: 'Z-1-2026' } });
  assert.match(out.recall.whatIsWrong, /not stored in this saved check/);
  assert.equal(out.recall.status, null);
});

test('details: an unknown class is described honestly and treated as urgent', async () => {
  const unknown = [match('d1', 'Z-7-2026', { recallClass: '' })];
  const out = await recallDetails({ snapshot: { devices, result: result({ matches: unknown }) }, inputs: { recallNumber: 'Z-7-2026' } });
  assert.match(out.recall.classMeaning, /Class not stated/);
  assert.ok(out.whatToDo.some((s) => /about 2 days/.test(s)));
});

test('details: a recall that did not match any device is not explained from guesswork', async () => {
  const out = await recallDetails({ snapshot: snap(), inputs: { recallNumber: 'Z-4242-2026' } });
  assert.equal(out.found, false);
  assert.match(out.message, /Do not guess/);
  assert.deepEqual(out.citations.recallNumbers, []);
});

test('details: shows existing tasks for the affected devices', async () => {
  const getTaskKeys = async () => ({ [pairKey('Z-1-2026', 'd2')]: 'MOBL-8' });
  const out = await recallDetails({ snapshot: snap(), inputs: { recallNumber: 'Z-1-2026' }, deps: { getTaskKeys } });
  assert.equal(out.affectedDevices.find((d) => d.deviceId === 'd2').jiraTask, 'MOBL-8');
});

// --- create_remediation_tasks --------------------------------------------------------------------------------------------

// A fake Jira (as in taskService.test.mjs) plus a clock, a guard and a preview store, wired together.
function setupTasks({ existing = {}, bulkError = null } = {}) {
  const clock = { now: T0 };
  const kv = fakeKv();
  const existingMap = new Map(Object.entries(existing));
  const state = { bulkCalls: [], created: [], next: 1 };
  const jira = {
    async findByLabels(labels) {
      const found = new Map();
      for (const label of labels) if (existingMap.has(label)) found.set(label, existingMap.get(label));
      return found;
    },
    // The same lookup with Jira's status of each task (every fake task is "To Do", i.e. category new).
    async findTasks(labels) {
      const keys = await this.findByLabels(labels);
      return new Map([...keys].map(([label, key]) => [label, { key, status: 'To Do', category: 'new' }]));
    },
    async taskIssueTypeId() {
      return '10002';
    },
    async bulkCreate(fieldsList) {
      state.bulkCalls.push(fieldsList);
      if (bulkError) throw bulkError;
      const created = fieldsList.map((fields, index) => {
        const key = `MOBL-${state.next++}`;
        existingMap.set(fields.labels[1], key);
        state.created.push({ key, fields });
        return { index, key };
      });
      return { created, errors: [] };
    },
  };
  const guard = createTaskGuard(kv, () => clock.now);
  let n = 0;
  const previewStore = createPreviewStore(kv, () => clock.now, () => `tok${++n}`);
  const deps = { jira, guard, previewStore, now: () => new Date(clock.now), defaultProjectKey: 'MOBL' };
  return { clock, kv, state, deps };
}

const run = (s, inputs, snapshot = snap()) => createRemediationTasks({ snapshot, inputs, deps: s.deps });

test('tasks: without a saved check it says how to get one', async () => {
  assert.match((await run(setupTasks(), { ward: 'ICU' }, snap(null))).error, /saved recall check/);
});

test('tasks: asking for "everything" with no selection is refused', async () => {
  const out = await run(setupTasks(), {});
  assert.equal(out.ok, false);
  assert.match(out.error, /Say which matches/);
});

test('tasks: a preview creates NOTHING, and shows what would be created', async () => {
  const s = setupTasks();
  const out = await run(s, { ward: 'ICU', recallClass: 'I' });
  assert.equal(out.state, 'preview');
  assert.equal(s.state.bulkCalls.length, 0);
  assert.deepEqual(out.willCreate.map((w) => `${w.recallNumber}|${w.deviceId}`), ['Z-1-2026|d1']);
  const [item] = out.willCreate;
  assert.equal(item.taskTitle, 'FDA recall Z-1-2026: Device d1 (ICU Medical M-d1)');
  assert.equal(item.dueDate, '2026-11-17'); // Class I: 2 days from 2026-11-15
  assert.equal(item.ward, 'ICU');
  assert.ok(item.whyMatched);
  assert.equal(out.projectKey, 'MOBL');
  assert.ok(out.confirmationToken);
  assert.match(out.instructions, /NOTHING HAS BEEN CREATED YET/);
  assert.deepEqual(out.citations.recallNumbers, ['Z-1-2026']);
});

test('tasks: class II recalls get the later due date in the preview', async () => {
  const out = await run(setupTasks(), { recallNumber: 'Z-2-2026' });
  assert.equal(out.willCreate[0].dueDate, '2026-11-22');
});

test('tasks: a preview can select by recall number, by device id, or by ward', async () => {
  assert.equal((await run(setupTasks(), { recallNumber: 'Z-1-2026' })).willCreate.length, 2);
  assert.equal((await run(setupTasks(), { deviceId: 'd3' })).willCreate.length, 1);
  assert.equal((await run(setupTasks(), { ward: 'ER' })).willCreate.length, 1);
});

test('tasks: possible matches and closed recalls are never offered', async () => {
  const s = setupTasks();
  assert.equal((await run(s, { deviceId: 'd4' })).state, 'nothing-to-create'); // d4 is only a possible match
  assert.equal((await run(s, { deviceId: 'd5' })).state, 'nothing-to-create'); // d5's recall is terminated
  assert.match((await run(s, { confidence: 'possible' })).error, /never created for possible/);
});

test('tasks: the project comes from the input, else the default, else the agent must ask', async () => {
  const s = setupTasks();
  assert.equal((await run(s, { ward: 'ER', projectKey: 'abc' })).projectKey, 'ABC');
  assert.equal((await run(s, { ward: 'ER' })).projectKey, 'MOBL');
  s.deps.defaultProjectKey = undefined;
  assert.match((await run(s, { ward: 'ER' })).error, /Which Jira project/);
  assert.match((await run(s, { ward: 'ER', projectKey: 'not a key!' })).error, /Which Jira project/);
});

test('tasks: matches that already have a task are shown as such, not offered again', async () => {
  const s = setupTasks({ existing: { [taskLabel('Z-1-2026', 'd1')]: 'MOBL-77' } });
  const out = await run(s, { recallNumber: 'Z-1-2026' });
  assert.deepEqual(out.willCreate.map((w) => w.deviceId), ['d2']);
  assert.deepEqual(out.alreadyHadTask, [{ deviceId: 'd1', recallNumber: 'Z-1-2026', jiraTask: 'MOBL-77' }]);
});

test('tasks: when everything already has a task, there is nothing to confirm', async () => {
  const s = setupTasks({ existing: { [taskLabel('Z-2-2026', 'd3')]: 'MOBL-9' } });
  const out = await run(s, { deviceId: 'd3' });
  assert.equal(out.state, 'nothing-to-create');
  assert.equal(out.confirmationToken, undefined);
  assert.equal(out.alreadyHadTask[0].jiraTask, 'MOBL-9');
});

test('tasks: a big selection is previewed in rounds, and says how many were left out', async () => {
  const many = Array.from({ length: MAX_TASKS_PER_ACTION + 6 }, (_, i) => match(`m${i}`, 'Z-5-2026', { ward: 'ICU' }));
  const out = await run(setupTasks(), { ward: 'ICU' }, { devices, result: result({ matches: many, recallDetails: {} }) });
  assert.equal(out.willCreate.length, MAX_TASKS_PER_ACTION);
  assert.equal(out.notIncluded, 6);
});

test('tasks: CONFIRM without a token creates nothing', async () => {
  const s = setupTasks();
  const out = await run(s, { ward: 'ICU', confirmed: true });
  assert.equal(out.ok, false);
  assert.match(out.error, /WITHOUT confirmed/);
  assert.equal(s.state.bulkCalls.length, 0);
});

test('tasks: CONFIRM with a made-up token creates nothing', async () => {
  const s = setupTasks();
  const out = await run(s, { confirmed: true, confirmationToken: 'invented' });
  assert.match(out.error, /unknown, already used/);
  assert.equal(s.state.bulkCalls.length, 0);
});

test('tasks: preview then confirm creates exactly the previewed tasks and returns the real Jira keys', async () => {
  const s = setupTasks();
  const preview = await run(s, { recallNumber: 'Z-1-2026' });
  const out = await run(s, { confirmed: true, confirmationToken: preview.confirmationToken });
  assert.equal(out.state, 'created');
  assert.equal(out.projectKey, 'MOBL');
  assert.deepEqual(out.created, [
    { pair: 'Z-1-2026|d1', jiraTask: 'MOBL-1' },
    { pair: 'Z-1-2026|d2', jiraTask: 'MOBL-2' },
  ]);
  assert.equal(s.state.created.length, 2);
  assert.equal(s.state.created[0].fields.duedate, '2026-11-17');
});

test('tasks: confirming "true" as text works too (models often send strings)', async () => {
  const s = setupTasks();
  const preview = await run(s, { deviceId: 'd3' });
  assert.equal((await run(s, { confirmed: 'true', confirmationToken: preview.confirmationToken })).state, 'created');
});

test('tasks: a token works once', async () => {
  const s = setupTasks();
  const { confirmationToken } = await run(s, { deviceId: 'd3' });
  assert.equal((await run(s, { confirmed: true, confirmationToken })).state, 'created');
  const again = await run(s, { confirmed: true, confirmationToken });
  assert.equal(again.ok, false);
  assert.equal(s.state.created.length, 1);
});

test('tasks: a token expires', async () => {
  const s = setupTasks();
  const { confirmationToken } = await run(s, { deviceId: 'd3' });
  s.clock.now += PREVIEW_TTL_MS;
  const out = await run(s, { confirmed: true, confirmationToken });
  assert.equal(out.ok, false);
  assert.equal(s.state.created.length, 0);
});

test('tasks: confirm creates ONLY what was previewed, whatever else is in the inputs', async () => {
  const s = setupTasks();
  const preview = await run(s, { deviceId: 'd3' });
  // A confirm call that also asks for a wider selection must not widen what is created.
  const out = await run(s, { confirmed: true, confirmationToken: preview.confirmationToken, ward: 'ICU', recallNumber: 'Z-1-2026' });
  assert.deepEqual(out.created.map((c) => c.pair), ['Z-2-2026|d3']);
  assert.equal(s.state.created.length, 1);
});

test('tasks: a token cannot be used for a different selection', async () => {
  const s = setupTasks();
  const a = await run(s, { deviceId: 'd3' });
  const b = await run(s, { deviceId: 'd1' });
  const out = await run(s, { confirmed: true, confirmationToken: a.confirmationToken });
  assert.deepEqual(out.created.map((c) => c.pair), ['Z-2-2026|d3']);
  const other = await run(s, { confirmed: true, confirmationToken: b.confirmationToken });
  assert.deepEqual(other.created.map((c) => c.pair), ['Z-1-2026|d1']);
});

test('tasks: a task made by someone else between preview and confirm is not duplicated', async () => {
  const s = setupTasks();
  const preview = await run(s, { deviceId: 'd3' });
  await s.deps.guard.record(taskLabel('Z-2-2026', 'd3'), 'MOBL-50'); // another click got there first
  const out = await run(s, { confirmed: true, confirmationToken: preview.confirmationToken });
  assert.equal(out.created.length, 0);
  assert.deepEqual(out.alreadyHadTask, [{ pair: 'Z-2-2026|d3', jiraTask: 'MOBL-50' }]);
});

test('tasks: if the saved check changed and a previewed match is gone, it is reported, not created', async () => {
  const s = setupTasks();
  const preview = await run(s, { recallNumber: 'Z-1-2026' });
  const changed = { devices, result: result({ matches: matches.filter((m) => m.deviceId !== 'd2') }) };
  const out = await run(s, { confirmed: true, confirmationToken: preview.confirmationToken }, changed);
  assert.deepEqual(out.created.map((c) => c.pair), ['Z-1-2026|d1']);
  assert.deepEqual(out.noLongerInSavedCheck, ['Z-1-2026|d2']);
});

test('tasks: Jira failures during confirm are reported, not hidden', async () => {
  const s = setupTasks({ bulkError: new Error('Jira answered 500') });
  const preview = await run(s, { deviceId: 'd3' });
  const out = await run(s, { confirmed: true, confirmationToken: preview.confirmationToken });
  assert.equal(out.created.length, 0);
  assert.equal(out.failed.length, 1);
  assert.match(out.failed[0].error, /500/);
});

// --- The preview store -----------------------------------------------------------------------------------------------------

test('preview store: a saved preview can be taken once', async () => {
  const clock = { now: T0 };
  const store = createPreviewStore(fakeKv(), () => clock.now, () => 'abc');
  const token = await store.save({ projectKey: 'P', pairs: [] });
  assert.equal((await store.take(token)).projectKey, 'P');
  assert.equal(await store.take(token), null);
});

test('preview store: unknown, empty and expired tokens give nothing', async () => {
  const clock = { now: T0 };
  const store = createPreviewStore(fakeKv(), () => clock.now, () => 'abc');
  assert.equal(await store.take(''), null);
  assert.equal(await store.take('nope'), null);
  const token = await store.save({ pairs: [] });
  clock.now += PREVIEW_TTL_MS - 1;
  assert.ok(await store.take(token));
  const late = await store.save({ pairs: [] });
  clock.now += PREVIEW_TTL_MS;
  assert.equal(await store.take(late), null);
});

test('preview store: two previews get two different tokens', async () => {
  let n = 0;
  const store = createPreviewStore(fakeKv(), () => T0, () => `r${++n}`);
  assert.notEqual(await store.save({}), await store.save({}));
});

test('preview store: a storage error is treated as "no such preview"', async () => {
  const kv = fakeKv();
  kv.get = async () => {
    throw new Error('storage down');
  };
  assert.equal(await createPreviewStore(kv).take('x'), null);
});

test('the preview time is ten minutes', () => {
  assert.equal(PREVIEW_TTL_MS, 10 * 60 * 1000);
});

test('list: an empty ward answer suggests only wards that fit the other filters (e.g. the class)', async () => {
  // Class I matches exist in ICU and ER only (d1, d2); Med-Surg 3W has a Class II match.
  const out = await listOpenRecalls({ snapshot: snap(), inputs: { ward: 'Pediatrics', recallClass: 'I' } });
  assert.equal(out.total, 0);
  assert.deepEqual(out.wardsWithMatches, ['ER', 'ICU']);
  const classII = await listOpenRecalls({ snapshot: snap(), inputs: { ward: 'Pediatrics', recallClass: 'II' } });
  assert.deepEqual(classII.wardsWithMatches, ['Med-Surg 3W']);
});

// --- create_remediation_task (one task, for external agents) ----------------------------------------------------------------

const runOne = (s, inputs, snapshot = snap()) => createRemediationTask({ snapshot, inputs, deps: s.deps });

test('one task: without a saved check it says how to get one', async () => {
  assert.match((await runOne(setupTasks(), { recallNumber: 'Z-1-2026', deviceId: 'd1', projectKey: 'MOBL' }, snap(null))).error, /saved recall check/);
});

test('one task: both the recall number and the device id are required (it never creates in bulk)', async () => {
  const s = setupTasks();
  assert.match((await runOne(s, { recallNumber: 'Z-1-2026', projectKey: 'MOBL' })).error, /Both recallNumber and deviceId/);
  assert.match((await runOne(s, { deviceId: 'd1', projectKey: 'MOBL' })).error, /Both recallNumber and deviceId/);
  assert.match((await runOne(s, { projectKey: 'MOBL' })).error, /Both recallNumber and deviceId/);
  assert.equal(s.state.bulkCalls.length, 0);
});

test('one task: the project is required unless one is known from context', async () => {
  const s = setupTasks();
  s.deps.defaultProjectKey = undefined;
  assert.match((await runOne(s, { recallNumber: 'Z-1-2026', deviceId: 'd1' })).error, /projectKey is required/);
  assert.match((await runOne(s, { recallNumber: 'Z-1-2026', deviceId: 'd1', projectKey: 'bad key!' })).error, /projectKey is required/);
  assert.equal(s.state.bulkCalls.length, 0);
});

test('one task: creates exactly one task for the named recall and device', async () => {
  const s = setupTasks();
  const out = await runOne(s, { recallNumber: 'Z-1-2026', deviceId: 'd1', projectKey: 'mobl' });
  assert.equal(out.state, 'created');
  assert.equal(out.jiraTask, 'MOBL-1');
  assert.equal(out.projectKey, 'MOBL');
  assert.equal(out.taskTitle, 'FDA recall Z-1-2026: Device d1 (ICU Medical M-d1)');
  assert.equal(out.dueDate, '2026-11-17');
  assert.deepEqual(out.citations.recallNumbers, ['Z-1-2026']);
  assert.deepEqual(out.citations.deviceIds, ['d1']);
  assert.equal(s.state.created.length, 1);
  // The recall also affects d2, but only d1 was asked for.
  assert.equal(s.state.created[0].fields.labels[1], taskLabel('Z-1-2026', 'd1'));
});

test('one task: a second call for the same pair creates nothing and returns the existing key', async () => {
  const s = setupTasks();
  await runOne(s, { recallNumber: 'Z-1-2026', deviceId: 'd1', projectKey: 'MOBL' });
  s.clock.now += 3 * 60 * 1000; // past the short guard, so Jira's own search is what knows about it
  const again = await runOne(s, { recallNumber: 'Z-1-2026', deviceId: 'd1', projectKey: 'MOBL' });
  assert.equal(again.state, 'already-exists');
  assert.equal(again.jiraTask, 'MOBL-1');
  assert.equal(s.state.created.length, 1);
});

test('one task: an immediate repeat is caught by the guard too', async () => {
  const s = setupTasks();
  await runOne(s, { recallNumber: 'Z-1-2026', deviceId: 'd1', projectKey: 'MOBL' });
  assert.equal((await runOne(s, { recallNumber: 'Z-1-2026', deviceId: 'd1', projectKey: 'MOBL' })).state, 'already-exists');
  assert.equal(s.state.created.length, 1);
});

test('one task: a pair that is not in the saved check is not guessed at', async () => {
  const s = setupTasks();
  const out = await runOne(s, { recallNumber: 'Z-4242-2026', deviceId: 'd1', projectKey: 'MOBL' });
  assert.equal(out.state, 'not-found');
  assert.match(out.message, /list_open_recalls/);
  assert.deepEqual(out.citations.recallNumbers, []);
  assert.equal(s.state.bulkCalls.length, 0);
});

test('one task: the recall number and device id are found however they are typed', async () => {
  const s = setupTasks();
  assert.equal((await runOne(s, { recallNumber: ' z-1-2026 ', deviceId: 'D1', projectKey: 'MOBL' })).state, 'created');
});

test('one task: a possible match is refused', async () => {
  const s = setupTasks();
  const out = await runOne(s, { recallNumber: 'Z-3-2026', deviceId: 'd4', projectKey: 'MOBL' });
  assert.equal(out.ok, false);
  assert.match(out.error, /only a possible match/);
  assert.equal(s.state.bulkCalls.length, 0);
});

test('one task: a closed recall is refused', async () => {
  const s = setupTasks();
  const out = await runOne(s, { recallNumber: 'Z-9-2026', deviceId: 'd5', projectKey: 'MOBL' });
  assert.equal(out.ok, false);
  assert.match(out.error, /no longer open/);
  assert.equal(s.state.bulkCalls.length, 0);
});

test('one task: a Jira failure is reported, not hidden', async () => {
  const s = setupTasks({ bulkError: new Error('Jira answered 500') });
  const out = await runOne(s, { recallNumber: 'Z-1-2026', deviceId: 'd1', projectKey: 'MOBL' });
  assert.equal(out.ok, false);
  assert.equal(out.state, 'failed');
  assert.match(out.error, /500/);
});

test('one task: a task being created by someone else right now is reported as in progress', async () => {
  const s = setupTasks();
  await s.deps.guard.reserve(taskLabel('Z-1-2026', 'd1'));
  assert.equal((await runOne(s, { recallNumber: 'Z-1-2026', deviceId: 'd1', projectKey: 'MOBL' })).state, 'in-progress');
  assert.equal(s.state.created.length, 0);
});

// --- create_remediation_tasks: proposing assignees from the Teamwork Graph ------------------------------------------------

import { createWardTeamStore } from './wardTeams.js';
import { SUGGESTION_RULE } from './teamService.js';

const T_ICU = 'ari:cloud:identity::team/11111111-aaaa-4bbb-8ccc-111111111111';

async function setupAssign({ graphDown = false, memberIds = ['acc-a', 'acc-b'] } = {}) {
  const s = setupTasks();
  const store = createWardTeamStore(fakeKv());
  await store.set('ICU', { ari: T_ICU, name: 'ICU Team' });
  const members = memberIds.map((id) => ({ accountId: id, name: `Person ${id}` }));
  const graph = {
    async listMembers() {
      if (graphDown) throw new Error('graph down');
      return members;
    },
    async listTeams() {
      return [];
    },
  };
  s.deps.team = { store, graph, openCounts: async () => new Map() };
  s.members = members;
  return s;
}

test('assign: without assignSuggested the preview proposes nobody', async () => {
  const s = await setupAssign();
  const out = await run(s, { ward: 'ICU', recallClass: 'I' });
  assert.equal('proposedAssignee' in out.willCreate[0], false);
  assert.equal(out.assignment, undefined);
});

test('assign: the preview shows each proposed person, the team, the source and the rule, and creates nothing', async () => {
  const s = await setupAssign();
  const out = await run(s, { ward: 'ICU', recallClass: 'I', assignSuggested: true });
  assert.equal(out.state, 'preview');
  assert.equal(s.state.bulkCalls.length, 0);
  assert.deepEqual(out.willCreate[0].proposedAssignee, { name: 'Person acc-a', team: 'ICU Team', source: 'Teamwork Graph' });
  assert.equal(out.assignment.rule, SUGGESTION_RULE);
  assert.match(out.assignment.note, /only proposed/);
});

test('assign: confirming assigns exactly the people shown in the preview', async () => {
  const s = await setupAssign();
  const preview = await run(s, { ward: 'ICU', recallClass: 'I', assignSuggested: true });
  const done = await run(s, { confirmed: true, confirmationToken: preview.confirmationToken });
  assert.equal(done.state, 'created');
  assert.deepEqual(s.state.created[0].fields.assignee, { accountId: 'acc-a' });
  assert.equal(done.created[0].assignedTo, 'Person acc-a');
});

test('assign: the preview record holds NO person: no account id, no name', async () => {
  const s = await setupAssign();
  await run(s, { ward: 'ICU', recallClass: 'I', assignSuggested: true });
  const stored = [...s.kv.data.entries()].filter(([k]) => k.startsWith('rovo-preview:'));
  assert.equal(stored.length, 1);
  const text = JSON.stringify(stored[0][1]);
  assert.ok(!text.includes('acc-a') && !text.includes('acc-b'), text);
  assert.ok(!text.includes('Person'), text);
  assert.equal(stored[0][1].assignSuggested, true);
  assert.ok(!('assignees' in stored[0][1]));
});

test('assign: people are looked up again at confirm time, so someone who left the team is not assigned', async () => {
  const s = await setupAssign();
  const preview = await run(s, { ward: 'ICU', recallClass: 'I', assignSuggested: true });
  s.deps.team.graph.listMembers = async () => [{ accountId: 'acc-z', name: 'Someone New' }]; // acc-a and acc-b left
  const done = await run(s, { confirmed: true, confirmationToken: preview.confirmationToken });
  assert.equal(done.state, 'created');
  assert.deepEqual(s.state.created[0].fields.assignee, { accountId: 'acc-z' }); // the CURRENT member, not the one previewed
  assert.equal(done.created[0].assignedTo, 'Someone New');
});

test('assign: if the graph is down at confirm time the tasks are still created, unassigned, with a note', async () => {
  const s = await setupAssign();
  const preview = await run(s, { ward: 'ICU', recallClass: 'I', assignSuggested: true });
  s.deps.team.graph.listMembers = async () => {
    throw new Error('down');
  };
  const done = await run(s, { confirmed: true, confirmationToken: preview.confirmationToken });
  assert.equal(done.state, 'created');
  assert.equal('assignee' in s.state.created[0].fields, false);
  assert.match(done.assignNote, /could not be reached/);
});

// --- Cleanup of previews ------------------------------------------------------------------------------------------------

test('previews: purgeExpired deletes expired and damaged previews and keeps live ones', async () => {
  const kv = fakeKv();
  let now = T0;
  const store = createPreviewStore(kv, () => now, () => 'x');
  const live = await store.save({ projectKey: 'MOBL', pairs: [] });
  kv.data.set('rovo-preview:old', { at: T0 - PREVIEW_TTL_MS - 1 });
  kv.data.set('rovo-preview:broken', { nope: true });
  kv.data.set('device:keep-me', { at: 0 }); // other keys are never touched
  assert.equal(await store.purgeExpired(), 2);
  assert.deepEqual([...kv.data.keys()].sort(), ['device:keep-me', `rovo-preview:${live}`].sort());
  now += PREVIEW_TTL_MS + 1;
  assert.equal(await store.purgeExpired(), 1); // the live one has now expired too
});

test('previews: saving a new preview also clears out expired ones', async () => {
  const kv = fakeKv({ 'rovo-preview:stale': { at: T0 - PREVIEW_TTL_MS - 5 } });
  const store = createPreviewStore(kv, () => T0, () => 'y');
  await store.save({ projectKey: 'MOBL', pairs: [] });
  assert.equal(kv.data.has('rovo-preview:stale'), false);
});
test('assign: a preview made without assignSuggested never assigns, even on a team ward', async () => {
  const s = await setupAssign();
  const preview = await run(s, { ward: 'ICU', recallClass: 'I' });
  await run(s, { confirmed: true, confirmationToken: preview.confirmationToken });
  assert.equal('assignee' in s.state.created[0].fields, false);
});

test('assign: a ward with no team gets no proposal and the reason is listed', async () => {
  const s = await setupAssign();
  const out = await run(s, { ward: 'ER', assignSuggested: true });
  assert.equal(out.willCreate[0].proposedAssignee, null);
  assert.match(out.assignment.noAssignee[0].reason, /ward ER has no team yet/);
});

test('assign: if the Teamwork Graph is down the preview still works, with a note and no proposals', async () => {
  const s = await setupAssign({ graphDown: true });
  const out = await run(s, { ward: 'ICU', recallClass: 'I', assignSuggested: true });
  assert.equal(out.state, 'preview');
  assert.equal(out.willCreate[0].proposedAssignee, null);
  assert.match(out.assignment.note, /could not be reached/);
});

test('assign: when assigning is not available at all, the note says tasks are unassigned', async () => {
  const s = setupTasks(); // no deps.team
  const out = await run(s, { ward: 'ICU', recallClass: 'I', assignSuggested: true });
  assert.equal(out.state, 'preview');
  assert.match(out.assignment.note, /unassigned/);
});

test('assign: assignSuggested may arrive as the text "true"', async () => {
  const s = await setupAssign();
  const out = await run(s, { ward: 'ICU', recallClass: 'I', assignSuggested: 'true' });
  assert.ok(out.willCreate[0].proposedAssignee);
});

test('groupByDevice makes one entry per device, most urgent first, with counts by class and confidence', () => {
  const item = (deviceId, recallNumber, recallClass, confidence, jiraTask) => ({ deviceId, deviceName: deviceId, ward: 'ICU', manufacturer: 'M', model: 'X', recallNumber, recallClass, confidence, ...(jiraTask ? { jiraTask } : {}) });
  const groups = groupByDevice([item('a', 'Z-1', 'II', 'likely'), item('b', 'Z-2', 'I', 'exact', 'MOBL-1'), item('a', 'Z-3', 'I', 'exact'), item('a', 'Z-4', 'I', 'likely')]);
  assert.deepEqual(groups.map((g) => g.deviceId), ['a', 'b']);
  assert.deepEqual(groups[0].recalls.map((r) => r.recallNumber), ['Z-3', 'Z-4', 'Z-1']);
  assert.equal(groups[0].recallCount, 3);
  assert.deepEqual(groups[0].byRecallClass, { I: 2, II: 1 });
  assert.deepEqual(groups[0].byConfidence, { exact: 1, likely: 2 });
  assert.equal(groups[0].withoutTask, 3);
  assert.equal(groups[1].withoutTask, 0);
});

test('list_open_recalls also answers grouped by device', async () => {
  const out = await listOpenRecalls({ snapshot: snap({}) });
  assert.equal(out.devices.length, new Set(out.items.map((i) => i.deviceId)).size);
  assert.match(out.presentation, /one line per device/);
});
