// How far along the recall work is. Every affected (recall, device) pair needs one task; for each pair this knows whether the
// task exists yet and what Jira's status for it is, and rolls that up per recall and per ward as a percentage resolved.
//
// A pair is resolved when its task is in a "done" status (Jira's own status category, whatever the project calls it).
// A pair with no task is not resolved and not hidden: "no task yet" is the number that says where work has not started.
// No Forge imports, so every rule is unit tested with plain Node.
// Where a pair stands: no task yet, a task still to do (open), being worked on, or done.
export function bucketOf(task) {
  if (!task) return 'noTask';
  if (task.category === 'done') return 'done';
  if (task.category === 'indeterminate') return 'inProgress';
  return 'open';
}

// Share resolved, 0 to 100. Rounded, but never shown as 100 until every pair is done (99.6 % is not finished).
export function percentResolved(done, pairs) {
  if (!pairs) return 0;
  if (done >= pairs) return 100;
  return Math.min(99, Math.round((done / pairs) * 100));
}

const newGroup = (extra) => ({ ...extra, pairs: 0, noTask: 0, open: 0, inProgress: 0, done: 0, deviceIds: new Set() });

function add(group, bucket, match) {
  group.pairs += 1;
  group[bucket] += 1;
  group.deviceIds.add(match.deviceId);
}

function finish({ deviceIds, ...group }) {
  return { ...group, devices: deviceIds.size, withTask: group.pairs - group.noTask, resolvedPercent: percentResolved(group.done, group.pairs) };
}

// A product description in a recall can run to hundreds of characters; the row shows one line of it.
const PRODUCT_LENGTH = 140;
export function shorten(text, length = PRODUCT_LENGTH) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= length) return clean;
  return `${clean.slice(0, length).replace(/\s+\S*$/, '')}…`; // cut at the last whole word
}
const NO_WARD = 'No ward';

// Unknown class counts as Class I (the same rule as the task due date and the urgency order): it is listed first.
const classRank = (recallClass) => ({ I: 0, II: 1, III: 2 }[recallClass] ?? 0);

/**
 * @param matches  the affected matches (exact or likely, recall still open), as saved by the check
 * @param states   { "recall|device": { key, status, category } } for the pairs that have a task (see getTaskStatuses)
 * @returns { overall, byRecall, byWard }: each a group of { pairs, devices, noTask, open, inProgress, done, withTask,
 *          resolvedPercent }. byRecall is the least finished first, Class I before the rest; byWard the least finished first.
 */
export function summarizeProgress(matches, states = {}) {
  const overall = newGroup({});
  const recalls = new Map();
  const wards = new Map();
  for (const match of matches || []) {
    const pair = `${match.recallNumber}|${match.deviceId}`;
    const bucket = bucketOf(states[pair]);
    add(overall, bucket, match);
    if (!recalls.has(match.recallNumber)) {
      recalls.set(match.recallNumber, newGroup({ recallNumber: match.recallNumber, recallClass: match.recallClass || '', firm: match.firm || '', product: shorten(match.product) }));
    }
    add(recalls.get(match.recallNumber), bucket, match);
    const ward = match.ward || NO_WARD;
    if (!wards.has(ward)) wards.set(ward, newGroup({ ward }));
    add(wards.get(ward), bucket, match);
  }
  const byRecall = [...recalls.values()].map(finish).sort((a, b) => classRank(a.recallClass) - classRank(b.recallClass) || a.resolvedPercent - b.resolvedPercent || a.recallNumber.localeCompare(b.recallNumber));
  const byWard = [...wards.values()].map(finish).sort((a, b) => a.resolvedPercent - b.resolvedPercent || a.ward.localeCompare(b.ward));
  return { overall: finish(overall), byRecall, byWard };
}
