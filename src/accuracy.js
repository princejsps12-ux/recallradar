// Scores the matcher against labeled cases: for every (device, recall) pair a person decided beforehand what the right
// answer is, and this counts how often the matcher gave it, per match level.
//
// The truth labels, and the level each one is expected to produce:
//
//   affected         this physical unit is covered by the recall            -> exact
//   product-covered  the product is named by the recall, this unit is not
//                    confirmed (serial not listed, not recorded, or the
//                    recall's scope depends on something else)               -> likely
//   related          same maker and kind of device, or the same model
//                    number from another firm                               -> possible
//   unrelated        nothing to do with this recall                         -> no match
//   excluded         the recall itself rules the unit out (its serial is
//                    outside a stated range). A perfect system says "no
//                    match"; this matcher cannot rule units out yet, so
//                    these are counted on their own line, not in the tables.
//
// No Forge imports, so this is unit tested with plain Node.

export const LEVELS = Object.freeze(['exact', 'likely', 'possible', 'none']);

export const TRUTH_LEVEL = Object.freeze({
  affected: 'exact',
  'product-covered': 'likely',
  related: 'possible',
  unrelated: 'none',
});

const ratio = (num, den) => (den === 0 ? null : num / den);

/**
 * @param rows  [{ id, truth, predicted }]  predicted is 'exact' | 'likely' | 'possible' | 'none'
 * @returns per-level precision and recall, the same for "gets a task" (exact or likely), the confusion matrix, the number of
 *          dangerous over-claims (predicted exact, truth not affected) and the excluded cases kept apart.
 */
export function scoreCases(rows) {
  const scored = rows.filter((row) => row.truth !== 'excluded');
  const excluded = rows.filter((row) => row.truth === 'excluded');
  const expected = (row) => TRUTH_LEVEL[row.truth];
  for (const row of scored) if (!expected(row)) throw new Error(`Unknown truth "${row.truth}" in case ${row.id}`);

  const confusion = {};
  for (const e of LEVELS) {
    confusion[e] = {};
    for (const p of LEVELS) confusion[e][p] = 0;
  }
  for (const row of scored) confusion[expected(row)][row.predicted] += 1;

  const perLevel = {};
  for (const level of LEVELS.filter((l) => l !== 'none')) {
    const tp = confusion[level][level];
    const predicted = LEVELS.reduce((sum, e) => sum + confusion[e][level], 0);
    const actual = LEVELS.reduce((sum, p) => sum + confusion[level][p], 0);
    perLevel[level] = { tp, predicted, actual, precision: ratio(tp, predicted), recall: ratio(tp, actual) };
  }

  // "Gets a task": exact or likely. This is the line that decides whether a person is sent after a device.
  const gets = (level) => level === 'exact' || level === 'likely';
  let taskTp = 0;
  let taskPredicted = 0;
  let taskActual = 0;
  for (const row of scored) {
    const e = gets(expected(row));
    const p = gets(row.predicted);
    if (p) taskPredicted += 1;
    if (e) taskActual += 1;
    if (e && p) taskTp += 1;
  }

  const overClaims = scored.filter((row) => row.predicted === 'exact' && expected(row) !== 'exact');
  const underClaims = scored.filter((row) => expected(row) === 'exact' && row.predicted !== 'exact');
  return {
    total: scored.length,
    perLevel,
    task: { tp: taskTp, predicted: taskPredicted, actual: taskActual, precision: ratio(taskTp, taskPredicted), recall: ratio(taskTp, taskActual) },
    confusion,
    overClaims: overClaims.map((row) => row.id),
    underClaims: underClaims.map((row) => row.id),
    wrong: scored.filter((row) => row.predicted !== expected(row)).map((row) => row.id),
    excluded: { total: excluded.length, saidLikely: excluded.filter((row) => row.predicted === 'likely' || row.predicted === 'exact').length },
  };
}

// 0.9333 -> "93.3%"; null (nothing to divide by) -> "n/a".
export function percent(value) {
  return value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}
