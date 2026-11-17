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
  assert.deepEqual(score.excluded, { total: 2, saidExact: 0, saidLikely: 1 });
  assert.deepEqual(score.overClaims, []);
});

test('scoreCases: a unit the recall rules out that is called exact is an over-claim, though excluded cases are not in the tables', () => {
  const score = scoreCases([row('a', 'affected', 'exact'), row('x', 'excluded', 'exact'), row('y', 'excluded', 'likely')]);
  assert.equal(score.total, 1, 'still not in the tables');
  assert.deepEqual(score.excluded, { total: 2, saidExact: 1, saidLikely: 1 });
  assert.deepEqual(score.overClaims, ['x']);
});

test('scoreCases: a level nobody predicted has no precision (n/a), and an unknown truth label is an error', () => {
  const score = scoreCases([row('a', 'unrelated', 'none')]);
  assert.equal(score.perLevel.exact.precision, null);
  assert.equal(percent(score.perLevel.exact.precision), 'n/a');
  assert.equal(percent(0.9333), '93.3%');
  assert.throws(() => scoreCases([row('z', 'maybe', 'exact')]), /Unknown truth "maybe" in case z/);
});

// The real set. These are the numbers the README quotes; change them only on purpose, together with docs/ACCURACY.md.
// Every pair the matcher gets wrong is named here with the reason, so a rule change cannot move one in silently.
const KNOWN_MISSES = [
  // A 3-character serial without a UDI-DI is not trusted on its own (MIN_LOT_LENGTH): likely, though the recall lists the unit.
  'Z-2285-2026/listed-unit',
  // A recall whose text leaves units out is never read as exact (EXCLUSION in src/matching.js): the unit is affected, the answer
  // is likely (and still gets a task). Z-0420-2024 excludes six serials from a range; Z-1884-2024 ends in "(Excluding K17160001)".
  'Z-0420-2024/listed-unit', 'Z-0420-2024/udi-listed-unit', 'Z-0420-2024/range-inside', 'Z-0420-2024/udi-range-inside',
  'Z-1884-2024/bound-inside', 'Z-1884-2024/udi-bound-inside', // and "Serial Number Before K17160001" is an open-ended bound nobody parses
];

test('the matcher keeps its measured accuracy on the real labeled set', () => {
  const { score, rows, caseCount, recallCount } = run();
  assert.equal(recallCount, 48, 'eval/recalls.json holds 48 real recalls');
  assert.ok(caseCount >= 500, `the labeled set is ${caseCount} cases`);
  assert.ok(rows.length > 3000, 'plus the unrelated sweep');
  assert.equal(score.overClaims.length, 0, `never says exact for a unit that is not confirmed: ${score.overClaims.join(', ')}`);
  assert.equal(score.perLevel.exact.precision, 1, 'exact is always right');
  assert.ok(score.perLevel.exact.recall >= 0.93, `exact finds ${score.perLevel.exact.recall}, at least 93% of the affected units (the misses are the known ones below)`);
  assert.ok(score.perLevel.likely.precision >= 0.96);
  assert.equal(score.perLevel.possible.precision, 1);
  assert.equal(score.perLevel.possible.recall, 1);
  assert.equal(score.task.recall, 1, 'no product that needs a task is missed');
  assert.ok(score.task.precision >= 0.99);
  assert.equal(score.confusion.none.exact + score.confusion.none.likely + score.confusion.none.possible, 0, 'an unrelated pair never produces a match');
  assert.deepEqual([...score.wrong].sort(), [...KNOWN_MISSES].sort(), 'the pairs the matcher gets wrong are exactly the known ones');
  assert.deepEqual(score.underClaims.sort(), KNOWN_MISSES.slice().sort(), 'every miss is an under-claim: affected, said less than exact');
});

test('a lot or serial that the recall lists for ANOTHER product of the same recall never makes a unit exact', () => {
  const { rows } = run();
  const cross = rows.filter((r) => r.template.includes('other-product'));
  assert.ok(cross.length >= 25, `${cross.length} such pairs in the set`);
  const wrong = cross.filter((r) => r.predicted === 'exact');
  assert.deepEqual(wrong.map((r) => r.id), []);
  const own = rows.filter((r) => r.template === 'multi-own-unit' || r.template === 'multi-udi-own-unit');
  assert.ok(own.length >= 15);
  assert.ok(own.every((r) => r.predicted === 'exact'), 'and the unit that IS listed for its own product is exact');
});

test('a unit that the recall names as excluded, or that lies outside its range, is never exact', () => {
  const { rows, score } = run();
  const ruledOut = rows.filter((r) => r.truth === 'excluded');
  assert.ok(ruledOut.length >= 8, `${ruledOut.length} such pairs`);
  assert.deepEqual(ruledOut.filter((r) => r.predicted === 'exact').map((r) => r.id), []);
  assert.equal(score.excluded.saidExact, 0);
  assert.ok(ruledOut.some((r) => r.template === 'excluded-unit'), 'the set holds units a text names as excluded, not only units outside a range');
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
