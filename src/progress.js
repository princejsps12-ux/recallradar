// How far along the recall work is. Every affected (recall, device) pair needs one task; for each pair this knows whether the
// task exists yet and what Jira's status for it is, and rolls that up per recall and per ward as a percentage resolved.
//
// A pair is resolved when its task is in a "done" status (Jira's own status category, whatever the project calls it).
// A pair with no task is not resolved and not hidden: "no task yet" is the number that says where work has not started.
// No Forge imports, so every rule is unit tested with plain Node.
/**
 * @typedef {'noTask' | 'open' | 'inProgress' | 'done'} Bucket
 * @typedef {{ pairs: number, noTask: number, open: number, inProgress: number, done: number }} Counts
 * @typedef {Counts & { deviceIds: Set<string> }} Tally            a group while it is being counted
 * @typedef {Counts & { devices: number, withTask: number, resolvedPercent: number }} Group     a finished group
 * @typedef {Group & { recallNumber: string, recallClass: string, firm: string, product: string }} RecallGroup
 * @typedef {Group & { ward: string }} WardGroup
 * @typedef {{ overall: Group, byRecall: RecallGroup[], byWard: WardGroup[] }} Progress
 * @typedef {Record<string, import('./types.js').TaskInfo>} TaskStates     "recall|device" -> its task
 */

// Where a pair stands: no task yet, a task still to do (open), being worked on, or done.
/**
 * @param {import('./types.js').TaskInfo | undefined} task
 * @returns {Bucket}
 */
export function bucketOf(task) {
  if (!task) return 'noTask';
  if (task.category === 'done') return 'done';
  if (task.category === 'indeterminate') return 'inProgress';
  return 'open';
}

// Share resolved, 0 to 100. Rounded, but never shown as 100 until every pair is done (99.6 % is not finished).
/**
 * @param {number} done
 * @param {number} pairs
 * @returns {number}
 */
export function percentResolved(done, pairs) {
  if (!pairs) return 0;
  if (done >= pairs) return 100;
  return Math.min(99, Math.round((done / pairs) * 100));
}

/** @returns {Tally} */
const newTally = () => ({ pairs: 0, noTask: 0, open: 0, inProgress: 0, done: 0, deviceIds: new Set() });

/**
 * @param {Tally} group
 * @param {Bucket} bucket
 * @param {import('./types.js').Match} match
 */
function add(group, bucket, match) {
  group.pairs += 1;
  group[bucket] += 1;
  group.deviceIds.add(match.deviceId);
}

/**
 * @param {Tally} tally
 * @returns {Group}
 */
function finish({ deviceIds, ...counts }) {
  return { ...counts, devices: deviceIds.size, withTask: counts.pairs - counts.noTask, resolvedPercent: percentResolved(counts.done, counts.pairs) };
}

// A product description in a recall can run to hundreds of characters; the row shows one line of it.
const PRODUCT_LENGTH = 140;
/**
 * @param {unknown} text
 * @param {number} [length]
 * @returns {string}
 */
export function shorten(text, length = PRODUCT_LENGTH) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= length) return clean;
  return `${clean.slice(0, length).replace(/\s+\S*$/, '')}…`; // cut at the last whole word
}
const NO_WARD = 'No ward';

// Unknown class counts as Class I (the same rule as the task due date and the urgency order): it is listed first.
/** @param {string} recallClass */
const classRank = (recallClass) => /** @type {Record<string, number>} */ ({ I: 0, II: 1, III: 2 })[recallClass] ?? 0;

/**
 * @param {import('./types.js').Match[] | undefined} matches  the affected matches (exact or likely, recall still open), as saved by the check
 * @param {TaskStates} [states]  for the pairs that have a task (see getTaskStatuses)
 * @returns {Progress}  each group counts { pairs, devices, noTask, open, inProgress, done, withTask, resolvedPercent }. byRecall is the
 *          least finished first, Class I before the rest; byWard the least finished first.
 */
export function summarizeProgress(matches, states = {}) {
  const overall = newTally();
  /** @type {Map<string, Tally & { recallNumber: string, recallClass: string, firm: string, product: string }>} */
  const recalls = new Map();
  /** @type {Map<string, Tally & { ward: string }>} */
  const wards = new Map();
  for (const match of matches || []) {
    const pair = `${match.recallNumber}|${match.deviceId}`;
    const bucket = bucketOf(states[pair]);
    add(overall, bucket, match);
    let recall = recalls.get(match.recallNumber);
    if (!recall) {
      recall = { ...newTally(), recallNumber: match.recallNumber, recallClass: match.recallClass || '', firm: match.firm || '', product: shorten(match.product) };
      recalls.set(match.recallNumber, recall);
    }
    add(recall, bucket, match);
    const wardName = match.ward || NO_WARD;
    let ward = wards.get(wardName);
    if (!ward) {
      ward = { ...newTally(), ward: wardName };
      wards.set(wardName, ward);
    }
    add(ward, bucket, match);
  }
  /** @type {RecallGroup[]} */
  const byRecall = [...recalls.values()].map(({ recallNumber, recallClass, firm, product, ...tally }) => ({ recallNumber, recallClass, firm, product, ...finish(tally) }));
  byRecall.sort((a, b) => classRank(a.recallClass) - classRank(b.recallClass) || a.resolvedPercent - b.resolvedPercent || a.recallNumber.localeCompare(b.recallNumber));
  /** @type {WardGroup[]} */
  const byWard = [...wards.values()].map(({ ward, ...tally }) => ({ ward, ...finish(tally) }));
  byWard.sort((a, b) => a.resolvedPercent - b.resolvedPercent || a.ward.localeCompare(b.ward));
  return { overall: finish(overall), byRecall, byWard };
}
