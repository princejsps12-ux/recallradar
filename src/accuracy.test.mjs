// Tests for the accuracy evaluation: the metric math with small hand-made tables, the numbers the real labeled set must keep
// (a rule change that makes the matcher worse fails here), and that docs/ACCURACY.md is the page the evaluation writes today.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreCases, percent } from './accuracy.js';
import { run, report, DOC_FILE } from '../scripts/eval-matching.mjs';

const row = (id, truth, predicted) => ({ id, truth, predicted });

test('scoreCases: precision and recall per level come from the confusion matrix', () => {
  const score = scoreCases([
    row('a', 'affected', 'exact'),
    row('b', 'affected', 'likely'), // under-claim
    row('c', 'product-covered', 'exact'), // over-claim
    row('d', 'product-covered', 'likely'),
    row('e', 'related', 'possible'),
    row('f', 'unrelated', 'none'),
    row('g', 'unrelated', 'possible'),
  ]);
  assert.equal(score.total, 7);
  assert.deepEqual(score.perLevel.exact, { tp: 1, predicted: 2, actual: 2, precision: 0.5, recall: 0.5 });
  assert.deepEqual(score.perLevel.likely, { tp: 1, predicted: 2, actual: 2, precision: 0.5, recall: 0.5 });
  assert.deepEqual(score.perLevel.possible, { tp: 1, predicted: 2, actual: 1, precision: 0.5, recall: 1 });
  assert.deepEqual(score.overClaims, ['c']);
  assert.deepEqual(score.underClaims, ['b']);
  assert.deepEqual(score.wrong.sort(), ['b', 'c', 'g']);
});

test('scoreCases: "gets a task" counts exact and likely together, so exact-for-likely is not an error there', () => {
  const score = scoreCases([row('a', 'affected', 'likely'), row('b', 'product-covered', 'exact'), row('c', 'related', 'likely'), row('d', 'unrelated', 'none')]);
  assert.deepEqual(score.task, { tp: 2, predicted: 3, actual: 2, precision: 2 / 3, recall: 1 });
});

test('scoreCases: excluded cases are counted on their own line and never in the tables', () => {
  const score = scoreCases([row('a', 'affected', 'exact'), row('x', 'excluded', 'likely'), row('y', 'excluded', 'none')]);
  assert.equal(score.total, 1);
  assert.deepEqual(score.excluded, { total: 2, saidLikely: 1 });
});

test('scoreCases: a level nobody predicted has no precision (n/a), and an unknown truth label is an error', () => {
  const score = scoreCases([row('a', 'unrelated', 'none')]);
  assert.equal(score.perLevel.exact.precision, null);
  assert.equal(percent(score.perLevel.exact.precision), 'n/a');
  assert.equal(percent(0.9333), '93.3%');
  assert.throws(() => scoreCases([row('z', 'maybe', 'exact')]), /Unknown truth "maybe" in case z/);
});

// The real set. These are the numbers the README quotes; change them only on purpose, together with docs/ACCURACY.md.
test('the matcher keeps its measured accuracy on the real labeled set', () => {
  const { score, rows, caseCount, recallCount } = run();
  assert.equal(recallCount, 40, 'eval/recalls.json holds 40 real recalls');
  assert.ok(caseCount >= 400, `the labeled set is ${caseCount} cases`);
  assert.ok(rows.length > 2000, 'plus the unrelated sweep');
  assert.equal(score.overClaims.length, 0, `never says exact for a unit that is not confirmed: ${score.overClaims.join(', ')}`);
  assert.equal(score.perLevel.exact.precision, 1, 'exact is always right');
  assert.ok(score.perLevel.exact.recall >= 0.98, 'exact finds at least 98% of the affected units');
  assert.ok(score.perLevel.likely.precision >= 0.99);
  assert.equal(score.perLevel.possible.precision, 1);
  assert.equal(score.perLevel.possible.recall, 1);
  assert.equal(score.task.recall, 1, 'no product that needs a task is missed');
  assert.ok(score.task.precision >= 0.99);
  assert.equal(score.confusion.none.exact + score.confusion.none.likely + score.confusion.none.possible, 0, 'an unrelated pair never produces a match');
  assert.deepEqual(score.wrong, ['Z-2285-2026/listed-unit'], 'the one known miss: a 3-character serial without a UDI-DI');
});

test('every label in the set is known, and every case names a recall that is in the set', () => {
  const { rows } = run();
  const truths = new Set(rows.map((r) => r.truth));
  assert.deepEqual([...truths].sort(), ['affected', 'excluded', 'product-covered', 'related', 'unrelated']);
  assert.ok(rows.every((r) => r.predicted), 'every pair got a verdict');
});

test('docs/ACCURACY.md is what the evaluation writes today (run npm run eval after a rule change)', () => {
  assert.equal(readFileSync(DOC_FILE, 'utf8'), report(), 'docs/ACCURACY.md is out of date: run npm run eval');
});
