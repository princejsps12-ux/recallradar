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

// --- Task status and progress ---------------------------------------------------------------------------------------

// How a task's status is shown: the project's own word when Jira gave one ("In review"), else the plain name of Jira's
// status category. `category` is Jira's grouping: 'new' (to do), 'indeterminate' (in progress), 'done'.
export const CATEGORY_NAMES = { new: 'To do', indeterminate: 'In progress', done: 'Done' };
export function taskStatusLabel(info) {
  if (info && info.status) return info.status;
  return CATEGORY_NAMES[info && info.category] || CATEGORY_NAMES.new;
}
// Atlaskit lozenge appearance for a category: grey to do, blue in progress, green done.
export function taskStatusAppearance(info) {
  return { indeterminate: 'inprogress', done: 'success' }[info && info.category] || 'default';
}

// The four parts of a progress bar in the order they are drawn, with the words used for each.
export const PROGRESS_PARTS = [
  { key: 'done', label: 'done' },
  { key: 'inProgress', label: 'in progress' },
  { key: 'open', label: 'to do' },
  { key: 'noTask', label: 'no task yet' },
];

// A progress group ({ pairs, done, inProgress, open, noTask }) as bar parts: { key, label, count, share } where share is the
// part of the bar in percent. Parts with a zero count are kept (the legend lists all four), the bar draws only the others.
export function progressParts(group) {
  const pairs = (group && group.pairs) || 0;
  return PROGRESS_PARTS.map((part) => {
    const count = (group && group[part.key]) || 0;
    return { ...part, count, share: pairs ? (count / pairs) * 100 : 0 };
  });
}

// "3 done, 2 in progress, 1 to do, 4 no task yet": zero counts left out. '' when there is nothing.
export function progressText(group) {
  return progressParts(group).filter((part) => part.count > 0).map((part) => `${part.count} ${part.label}`).join(', ');
}

// --- Daily alerts ---------------------------------------------------------------------------------------------------

// The pairs the server says became affected in the last 24 hours ([{ recallNumber, deviceId, firstSeen }]) joined with the
// matches on screen: [{ match, firstSeen }], newest first. A pair that is no longer affected (or whose recall closed) is left
// out, so the card never shows a device that no longer needs anything.
export function newSinceMatches(result, newSince) {
  const byPair = new Map(affectedMatches(result).map((m) => [`${m.recallNumber}|${m.deviceId}`, m]));
  return (newSince || [])
    .map((n) => ({ match: byPair.get(`${n.recallNumber}|${n.deviceId}`), firstSeen: n.firstSeen }))
    .filter((item) => item.match)
    .sort((a, b) => String(b.firstSeen).localeCompare(String(a.firstSeen)) || a.match.recallNumber.localeCompare(b.match.recallNumber));
}

const KEYS_SHOWN = 5;

// What the last daily run did, in one sentence of parts: "2 new, 2 tasks created (AL-1, AL-2), comment posted". null when it
// has not run yet.
export function lastRunText(last) {
  if (!last) return null;
  const parts = [last.news ? `${last.news} new` : 'nothing new'];
  const created = last.created || [];
  if (created.length) {
    const keys = created.slice(0, KEYS_SHOWN).join(', ');
    const more = created.length > KEYS_SHOWN ? ` and ${created.length - KEYS_SHOWN} more` : '';
    parts.push(`${created.length} ${created.length === 1 ? 'task' : 'tasks'} created (${keys}${more})`);
  }
  if (last.existing) parts.push(`${last.existing} already had a task`);
  if (last.failed) parts.push(`${last.failed} could not be created`);
  if (last.comment === 'posted') parts.push('comment posted');
  if (last.comment === 'failed') parts.push('the comment could not be posted');
  if (last.left) parts.push(`${last.left} waiting for the next run`);
  return parts.join(', ');
}

// One line for the menu item: whether the alerts are on and where the tasks go.
export function alertsSummary(settings) {
  if (!settings || !settings.enabled) return 'Off';
  return `On: tasks go to ${settings.projectKey}`;
}

// Why "Run now" did nothing, in words.
export const NOT_RUN_REASONS = {
  off: 'The alerts are off. Turn them on and save first.',
  'no-project': 'Choose the project for the new tasks and save first.',
  incomplete: 'The last check did not finish all its FDA searches, so nothing was created. Refresh and try again.',
};

// --- Who handles a ward (the drawer card) ----------------------------------------------------------------------------

// A person's workload from the graph as one phrase: "3 open, 1 overdue", "No open work", "12+ open" (more than was read), or
// "Work could not be read" when the graph would not say.
export function workloadText(person) {
  if (!person || person.openWork === null || person.openWork === undefined) return 'Work could not be read';
  if (person.openWork === 0 && !person.capped) return 'No open work';
  const parts = [`${person.openWork}${person.capped ? '+' : ''} open`];
  if (person.overdue > 0) parts.push(`${person.overdue} overdue`);
  return parts.join(', ');
}

