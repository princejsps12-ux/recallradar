import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  affectedMatches,
  openRecallsByClass,
  affectedDeviceCount,
  wardsOf,
  filterMatches,
  taskProgress,
  screenFor,
  NO_WARD,
} from '../static/hello-world/src/dashboardData.mjs';

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
