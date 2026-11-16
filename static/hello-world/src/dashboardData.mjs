// What the dashboard shows, worked out from the saved check result. Pure functions with no React and no
// Forge, so they are unit tested from the repository's test runner (src/dashboardData.test.mjs).

// Only matches we are fairly sure about count as "affected". Keep in step with TASK_CONFIDENCES in src/taskRules.js.
export const AFFECTED_CONFIDENCES = ['exact', 'likely'];
// Statuses of a recall that is no longer open. Keep in step with CLOSED_STATUSES in src/agentTools.js.
export const CLOSED_STATUSES = ['terminated', 'completed'];
export const CLASSES = ['I', 'II', 'III'];
export const UNKNOWN_CLASS = '?';

const classOf = (match) => (CLASSES.includes(match.recallClass) ? match.recallClass : UNKNOWN_CLASS);

function isOpen(result, recallNumber) {
  const details = (result.recallDetails || {})[recallNumber];
  return !(details && CLOSED_STATUSES.includes(String(details.status).toLowerCase()));
}

// The exact and likely matches of recalls that are still open: the devices a person has to act on.
export function affectedMatches(result) {
  if (!result || !Array.isArray(result.matches)) return [];
  return result.matches.filter((m) => AFFECTED_CONFIDENCES.includes(m.confidence) && isOpen(result, m.recallNumber));
}

// { I: n, II: n, III: n, '?': n }: how many DIFFERENT open recalls there are in each class.
export function openRecallsByClass(result) {
  const seen = new Map();
  for (const m of affectedMatches(result)) if (!seen.has(m.recallNumber)) seen.set(m.recallNumber, classOf(m));
  const counts = { I: 0, II: 0, III: 0, [UNKNOWN_CLASS]: 0 };
  for (const cls of seen.values()) counts[cls] += 1;
  return counts;
}

// How many different devices are affected.
export function affectedDeviceCount(result) {
  return new Set(affectedMatches(result).map((m) => m.deviceId)).size;
}

// The wards that appear among the affected matches, sorted; matches with no ward are grouped as "No ward".
export const NO_WARD = 'No ward';
const wardOf = (m) => m.ward || NO_WARD;
export function wardsOf(matches) {
  return [...new Set(matches.map(wardOf))].sort((a, b) => a.localeCompare(b));
}

// Filter by ward and class ('' means all). Order is kept: the saved check already puts the most serious first.
export function filterMatches(matches, { ward = '', recallClass = '' } = {}) {
  return matches.filter((m) => (!ward || wardOf(m) === ward) && (!recallClass || classOf(m) === recallClass));
}

// Summary of the Jira tasks, from the server's answer { open, done }: total and share done (0 to 100).
export function taskProgress(summary) {
  if (!summary) return null;
  const total = summary.open + summary.done;
  return { open: summary.open, done: summary.done, total, percentDone: total === 0 ? 0 : Math.round((summary.done / total) * 100) };
}

// The tasks part of the dashboard's summary line, as { lead, rest }: the number that is shown bold, and the words after
// it. null while the counts are still loading (the page shows a placeholder). `capped` means Jira may hold more tasks
// than were counted, so both numbers are "at least".
export function taskSummaryParts(progress, state, capped = false) {
  if (state === 'loading') return null;
  if (state === 'error' || !progress) return { lead: '', rest: 'Task counts unavailable' };
  if (progress.total === 0) return { lead: '', rest: 'No RecallRadar tasks yet' };
  const plus = capped ? '+' : '';
  return { lead: `${progress.open}${plus}`, rest: `${progress.open === 1 && !capped ? 'task' : 'tasks'} open, ${progress.done}${plus} done` };
}

// Which screen to show: 'loading', 'error', 'first-run' (no devices), 'no-check' (devices, never checked),
// 'ready'. `devicesCount` is null until known.
export function screenFor({ devicesCount, result, error, loading }) {
  if (error) return 'error';
  if (loading || devicesCount === null) return 'loading';
  if (devicesCount === 0) return 'first-run';
  if (!result) return 'no-check';
  return 'ready';
}

// --- "Do this first" and the hero -------------------------------------------------------------------------

// Lower is more urgent: Class I first (an unknown class is treated as Class I, like the task due-date rule),
// then exact before likely.
export function urgencyRank(match) {
  const cls = { I: 0, II: 1, III: 2 }[match.recallClass] ?? 0;
  return cls * 2 + (match.confidence === 'exact' ? 0 : 1);
}

// Matches sorted most urgent first (stable: the saved order breaks ties).
export function sortByUrgency(matches) {
  return matches.map((m, i) => [m, i]).sort((a, b) => urgencyRank(a[0]) - urgencyRank(b[0]) || a[1] - b[1]).map(([m]) => m);
}

// The `limit` most urgent DEVICES that still have no task: one row per device (its most urgent match).
// `tasks` is the { "recall|device": "MOBL-1" } map.
export function urgentMatches(result, tasks = {}, limit = 5) {
  const seen = new Set();
  const out = [];
  for (const m of sortByUrgency(affectedMatches(result))) {
    if (tasks[`${m.recallNumber}|${m.deviceId}`] || seen.has(m.deviceId)) continue;
    seen.add(m.deviceId);
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

// The big numbers: devices that need action, how many of them have a Class I match, and open recalls.
export function heroStats(result) {
  const affected = affectedMatches(result);
  const devices = new Set(affected.map((m) => m.deviceId));
  const classI = new Set(affected.filter((m) => classOf(m) === 'I').map((m) => m.deviceId));
  return { devices: devices.size, classIDevices: classI.size, openRecalls: new Set(affected.map((m) => m.recallNumber)).size };
}

// Every affected match of one device, most urgent first (for the side drawer).
export function matchesForDevice(result, deviceId) {
  return sortByUrgency(affectedMatches(result).filter((m) => m.deviceId === deviceId));
}
