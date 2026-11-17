import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketOf, percentResolved, summarizeProgress, shorten } from './progress.js';

const match = (recallNumber, deviceId, extra = {}) => ({ recallNumber, deviceId, ward: 'ICU', recallClass: 'II', firm: 'Maker', product: 'Pump', confidence: 'exact', ...extra });
const task = (key, category, status = '') => ({ key, status, category });

test('bucketOf: Jira status categories decide, and an unknown task is never counted as done', () => {
  assert.equal(bucketOf(undefined), 'noTask');
  assert.equal(bucketOf(task('A-1', 'new')), 'open');
  assert.equal(bucketOf(task('A-1', 'indeterminate')), 'inProgress');
  assert.equal(bucketOf(task('A-1', 'done')), 'done');
  assert.equal(bucketOf(task('A-1', 'something-new')), 'open');
});

test('percentResolved: rounded, and 100 only when every pair is done', () => {
  assert.equal(percentResolved(0, 0), 0, 'nothing to do is 0, not NaN');
  assert.equal(percentResolved(1, 3), 33);
  assert.equal(percentResolved(2, 3), 67);
  assert.equal(percentResolved(199, 200), 99, '99.5 % must not read as finished');
  assert.equal(percentResolved(3, 3), 100);
});

test('summarizeProgress counts every pair once, and "no task" is a number of its own', () => {
  const matches = [match('Z-1', 'd1'), match('Z-1', 'd2'), match('Z-1', 'd3'), match('Z-2', 'd1', { ward: 'ER' })];
  const states = { 'Z-1|d1': task('A-1', 'done', 'Done'), 'Z-1|d2': task('A-2', 'indeterminate', 'In progress'), 'Z-2|d1': task('A-3', 'new', 'To Do') };
  const { overall } = summarizeProgress(matches, states);
  assert.deepEqual([overall.pairs, overall.devices, overall.noTask, overall.open, overall.inProgress, overall.done, overall.withTask, overall.resolvedPercent], [4, 3, 1, 1, 1, 1, 3, 25]);
  assert.equal(overall.pairs, overall.noTask + overall.open + overall.inProgress + overall.done, 'the four buckets add up to the pairs');
});

test('summarizeProgress per recall: Class I first (an unknown class counts as Class I), then the least finished', () => {
  const matches = [
    match('Z-2', 'd1', { recallClass: 'II' }), match('Z-2', 'd2', { recallClass: 'II' }),
    match('Z-3', 'd1', { recallClass: 'III' }),
    match('Z-1', 'd1', { recallClass: 'I' }), match('Z-1', 'd2', { recallClass: 'I' }),
    match('Z-4', 'd9', { recallClass: '' }),
  ];
  const states = { 'Z-1|d1': task('A-1', 'done'), 'Z-1|d2': task('A-2', 'done'), 'Z-2|d1': task('A-3', 'done') };
  const { byRecall } = summarizeProgress(matches, states);
  assert.deepEqual(byRecall.map((r) => [r.recallNumber, r.resolvedPercent]), [['Z-4', 0], ['Z-1', 100], ['Z-2', 50], ['Z-3', 0]]);
  assert.equal(byRecall[1].devices, 2);
  assert.equal(byRecall[1].firm, 'Maker');
});

test('summarizeProgress per ward: the least finished ward first, devices without a ward grouped as "No ward"', () => {
  const matches = [match('Z-1', 'd1', { ward: 'ICU' }), match('Z-1', 'd2', { ward: 'ER' }), match('Z-1', 'd3', { ward: '' }), match('Z-2', 'd2', { ward: 'ER' })];
  const states = { 'Z-1|d1': task('A-1', 'done') };
  const { byWard } = summarizeProgress(matches, states);
  assert.deepEqual(byWard.map((w) => [w.ward, w.pairs, w.done, w.resolvedPercent]), [['ER', 2, 0, 0], ['No ward', 1, 0, 0], ['ICU', 1, 1, 100]]);
  assert.equal(byWard[0].devices, 1, 'one device with two recalls is one device');
});

test('summarizeProgress: no matches is an empty roll-up, long products are cut, a pair is never counted twice for one task', () => {
  const empty = summarizeProgress([], {});
  assert.equal(empty.overall.pairs, 0);
  assert.equal(empty.overall.resolvedPercent, 0);
  assert.deepEqual(empty.byRecall, []);
  assert.deepEqual(empty.byWard, []);
  const long = summarizeProgress([match('Z-1', 'd1', { product: `${'word '.repeat(100)}` })], {});
  assert.ok(long.byRecall[0].product.length <= 141 && long.byRecall[0].product.endsWith('word…'), 'cut at a whole word, with an ellipsis');
  assert.equal(shorten('short text'), 'short text');
  assert.equal(shorten('  two   spaces\nhere '), 'two spaces here', 'whitespace is tidied');
  assert.equal(shorten(undefined), '');
  assert.equal(shorten('x'.repeat(300)).length, 141, 'one very long word is cut where it is');
  assert.deepEqual(summarizeProgress(undefined, undefined).byRecall, []);
});
