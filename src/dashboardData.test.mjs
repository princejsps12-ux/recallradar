import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  affectedMatches,
  openRecallsByClass,
  affectedDeviceCount,
  wardsOf,
  filterMatches,
  taskProgress,
  taskStatusLabel,
  taskStatusAppearance,
  progressParts,
  progressText,
  taskSummaryParts,
  screenFor,
  NO_WARD,
  urgencyRank,
  sortByUrgency,
  urgentMatches,
  heroStats,
  matchesForDevice,
} from '../static/ui/src/dashboardData.mjs';

const m = (deviceId, recallNumber, extra = {}) => ({ deviceId, recallNumber, confidence: 'exact', recallClass: 'I', ward: 'ICU', ...extra });
const result = {
  matches: [
    m('d1', 'Z-1'),
    m('d2', 'Z-1', { ward: 'ER' }),
    m('d3', 'Z-2', { recallClass: 'II', confidence: 'likely', ward: 'ICU' }),
    m('d4', 'Z-3', { confidence: 'possible' }),
    m('d5', 'Z-9', { recallClass: 'III' }),
    m('d6', 'Z-4', { recallClass: undefined, ward: '' }),
  ],
  recallDetails: { 'Z-9': { status: 'Terminated' }, 'Z-1': { status: 'Ongoing' } },
};

test('affected matches are exact or likely and still open', () => {
  assert.deepEqual(affectedMatches(result).map((x) => x.deviceId), ['d1', 'd2', 'd3', 'd6']); // not possible d4, not closed d5
});

test('a missing result or list is no matches', () => {
  assert.deepEqual(affectedMatches(null), []);
  assert.deepEqual(affectedMatches({}), []);
});

test('open recalls are counted once per recall, by class, with unknown class kept apart', () => {
  assert.deepEqual(openRecallsByClass(result), { I: 1, II: 1, III: 0, '?': 1 }); // Z-1 has two devices but is one recall
});

test('affected devices are counted once each', () => {
  assert.equal(affectedDeviceCount(result), 4);
  assert.equal(affectedDeviceCount({ matches: [m('d1', 'Z-1'), m('d1', 'Z-2')] }), 1);
});

test('wards come sorted, and a missing ward is grouped as "No ward"', () => {
  assert.deepEqual(wardsOf(affectedMatches(result)), ['ER', 'ICU', NO_WARD]);
});

test('filtering by ward and class, with empty meaning all', () => {
  const all = affectedMatches(result);
  assert.equal(filterMatches(all, {}).length, 4);
  assert.deepEqual(filterMatches(all, { ward: 'ICU' }).map((x) => x.deviceId), ['d1', 'd3']);
  assert.deepEqual(filterMatches(all, { recallClass: 'II' }).map((x) => x.deviceId), ['d3']);
  assert.deepEqual(filterMatches(all, { ward: 'ICU', recallClass: 'I' }).map((x) => x.deviceId), ['d1']);
  assert.deepEqual(filterMatches(all, { ward: NO_WARD }).map((x) => x.deviceId), ['d6']);
  assert.deepEqual(filterMatches(all, { ward: 'ER', recallClass: 'II' }), []);
});

test('task progress: totals, percentage, and no tasks at all', () => {
  assert.deepEqual(taskProgress({ open: 3, done: 1 }), { open: 3, done: 1, total: 4, percentDone: 25 });
  assert.deepEqual(taskProgress({ open: 0, done: 0 }), { open: 0, done: 0, total: 0, percentDone: 0 });
  assert.equal(taskProgress(null), null);
});

test('which screen: error beats everything, then loading, first run, no check, ready', () => {
  assert.equal(screenFor({ devicesCount: 5, result, error: 'x' }), 'error');
  assert.equal(screenFor({ devicesCount: null, result: null }), 'loading');
  assert.equal(screenFor({ devicesCount: 5, result, loading: true }), 'loading');
  assert.equal(screenFor({ devicesCount: 0, result: null }), 'first-run');
  assert.equal(screenFor({ devicesCount: 5, result: null }), 'no-check');
  assert.equal(screenFor({ devicesCount: 5, result }), 'ready');
});

test('urgency: Class I before II before III, exact before likely, unknown class counts as Class I', () => {
  const a = m('a', 'Z-1', { recallClass: 'II' });
  const b = m('b', 'Z-2', { recallClass: 'I', confidence: 'likely' });
  const c = m('c', 'Z-3', { recallClass: 'I' });
  const d = m('d', 'Z-4', { recallClass: undefined });
  assert.deepEqual(sortByUrgency([a, b, c, d]).map((x) => x.deviceId), ['c', 'd', 'b', 'a']);
  assert.ok(urgencyRank(c) < urgencyRank(b) && urgencyRank(b) < urgencyRank(a));
});

test('do-this-first: one row per device, skips devices that have a task, respects the limit', () => {
  const r = { matches: [m('d1', 'Z-1'), m('d1', 'Z-2', { recallClass: 'II' }), m('d2', 'Z-3', { recallClass: 'II' }), m('d3', 'Z-4', { recallClass: 'III' }), m('d4', 'Z-5')], recallDetails: {} };
  assert.deepEqual(urgentMatches(r, {}, 10).map((x) => x.deviceId), ['d1', 'd4', 'd2', 'd3']);
  assert.deepEqual(urgentMatches(r, { 'Z-1|d1': 'P-1' }, 10).map((x) => `${x.deviceId}:${x.recallNumber}`), ['d4:Z-5', 'd1:Z-2', 'd2:Z-3', 'd3:Z-4']);
  assert.equal(urgentMatches(r, {}, 2).length, 2);
  assert.deepEqual(urgentMatches(null, {}), []);
});

test('hero numbers: devices needing action, devices with a Class I match, open recalls', () => {
  assert.deepEqual(heroStats(result), { devices: 4, classIDevices: 2, openRecalls: 3 }); // d1,d2 are Class I; d6 (unknown class) is urgent but not counted as Class I
  assert.deepEqual(heroStats({ matches: [] }), { devices: 0, classIDevices: 0, openRecalls: 0 });
});

test('matches for one device, most urgent first', () => {
  const r = { matches: [m('d1', 'Z-2', { recallClass: 'II' }), m('d1', 'Z-1'), m('d2', 'Z-3')], recallDetails: {} };
  assert.deepEqual(matchesForDevice(r, 'd1').map((x) => x.recallNumber), ['Z-1', 'Z-2']);
  assert.deepEqual(matchesForDevice(r, 'nope'), []);
});

test('the tasks part of the summary line says what the counts are, or why there are none', () => {
  assert.equal(taskSummaryParts(null, 'loading'), null, 'a placeholder is shown while loading');
  assert.deepEqual(taskSummaryParts(null, 'error'), { lead: '', rest: 'Task counts unavailable' });
  assert.deepEqual(taskSummaryParts(null, 'ok'), { lead: '', rest: 'Task counts unavailable' }, 'ok but no numbers is still unavailable');
  assert.deepEqual(taskSummaryParts(taskProgress({ open: 0, done: 0 }), 'ok'), { lead: '', rest: 'No RecallRadar tasks yet' });
  assert.deepEqual(taskSummaryParts(taskProgress({ open: 4, done: 2 }), 'ok'), { lead: '4', rest: 'tasks open, 2 done' });
  assert.deepEqual(taskSummaryParts(taskProgress({ open: 1, done: 0 }), 'ok'), { lead: '1', rest: 'task open, 0 done' }, 'one task is singular');
  assert.deepEqual(taskSummaryParts(taskProgress({ open: 100, done: 20 }), 'ok', true), { lead: '100+', rest: 'tasks open, 20+ done' }, 'a capped count is "at least"');
});

test('taskStatusLabel: the project\'s own word, else the plain name of Jira\'s category; the appearance follows the category', () => {
  assert.equal(taskStatusLabel({ status: 'In review', category: 'indeterminate' }), 'In review');
  assert.equal(taskStatusLabel({ status: '', category: 'done' }), 'Done');
  assert.equal(taskStatusLabel({ category: 'indeterminate' }), 'In progress');
  assert.equal(taskStatusLabel({ category: 'new' }), 'To do');
  assert.equal(taskStatusLabel(undefined), 'To do', 'no information is "to do", never "done"');
  assert.equal(taskStatusAppearance({ category: 'done' }), 'success');
  assert.equal(taskStatusAppearance({ category: 'indeterminate' }), 'inprogress');
  assert.equal(taskStatusAppearance({ category: 'new' }), 'default');
  assert.equal(taskStatusAppearance(undefined), 'default');
});

test('progressParts: four parts in drawing order with their share of the bar; progressText leaves out the zeros', () => {
  const group = { pairs: 10, done: 5, inProgress: 2, open: 1, noTask: 2 };
  assert.deepEqual(progressParts(group).map((p) => [p.key, p.count, p.share]), [['done', 5, 50], ['inProgress', 2, 20], ['open', 1, 10], ['noTask', 2, 20]]);
  assert.equal(progressText(group), '5 done, 2 in progress, 1 to do, 2 no task yet');
  assert.equal(progressText({ pairs: 3, done: 3, inProgress: 0, open: 0, noTask: 0 }), '3 done');
  assert.equal(progressText({ pairs: 0, done: 0, inProgress: 0, open: 0, noTask: 0 }), '');
  assert.deepEqual(progressParts(null).map((p) => p.share), [0, 0, 0, 0], 'no group is an empty bar, not NaN');
});

