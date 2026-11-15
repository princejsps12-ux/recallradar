// Creates Jira tasks for recall matches, and never creates the same task twice.
//
// "The same task" means the same recall for the same device. Each task carries a label that
// encodes that pair (see taskLabel in taskRules.js), and that gives two layers of protection:
//
//   1. JIRA IS THE SOURCE OF TRUTH. Before creating anything we search Jira for the labels. A
//      task that exists is reported, not recreated, even if our own storage was cleared or the
//      task was made from another browser.
//   2. A SHORT-LIVED GUARD IN FORGE STORAGE. Jira's search index can lag a few seconds behind a
//      new issue, so a fast double click could slip past layer 1. For GUARD_TTL_MS we remember
//      which tasks we have just created (or are creating), and treat those as existing. After
//      that Jira's own search knows about them, so the guard expires and a task that was deleted
//      in Jira can be created again.
//
// `jira` is injected (see jiraClient.js): findByLabels, taskIssueTypeId, bulkCreate.
// `guard` is made by createTaskGuard below. No Forge imports, so this is unit tested.
import { buildIssueFields, isTaskWorthy, pairKey, taskLabel } from './taskRules.js';

// How long a just-created task is remembered locally. Longer than any realistic search-index lag,
// short enough that a deleted task can be recreated the same day.
export const GUARD_TTL_MS = 2 * 60 * 1000;

// Jira's bulk-create endpoint accepts at most this many issues per call.
export const BULK_CREATE_LIMIT = 50;

// A guard entry: { at } while a task is being created, { at, key } once it exists.
export function createTaskGuard(kv, nowMs = () => Date.now()) {
  const storageKey = (label) => `task-guard:${label}`;

  // The fresh entry for this label, or null.
  async function read(label) {
    let entry;
    try {
      entry = await kv.get(storageKey(label));
    } catch (error) {
      return null; // storage trouble never blocks a task: Jira's search is the real check
    }
    if (!entry || typeof entry.at !== 'number') return null;
    const age = nowMs() - entry.at;
    return age >= 0 && age < GUARD_TTL_MS ? entry : null;
  }

  const reserve = (label) => kv.set(storageKey(label), { at: nowMs() });
  const record = (label, key) => kv.set(storageKey(label), { at: nowMs(), key });
  const release = (label) => kv.delete(storageKey(label));

  return { read, reserve, record, release };
}

// The most pairs one request may ask for. Measured on the demo site: creating 34 tasks in one
// request took about 20 s, and a UI function is cut off at 25 s, so one request must stay well
// below that. 25 tasks is about 15 s. The panel sends batches of 10 (see TASKS_PER_REQUEST in
// App.js), which is about 6 s each, so a long list is created one batch at a time.
export const MAX_PAIRS_PER_REQUEST = 25;

// Looking up which pairs already have a task only runs a few JQL searches (20 labels each, about
// 0.3 s apiece) and creates nothing, so it may cover far more pairs than a creation request: the
// panel asks about every exact or likely match at once.
export const MAX_STATE_PAIRS_PER_REQUEST = 200;

// Check what the browser sent: a list of { recallNumber, deviceId } strings. Anything else throws,
// so nothing odd ever reaches Jira. Only the two IDs are taken from the browser; every other
// field of a task is rebuilt on the server from the saved check result (see selectMatches).
// `max` is how many pairs this kind of request may carry.
export function validatePairs(pairs, max = MAX_PAIRS_PER_REQUEST) {
  if (!Array.isArray(pairs) || pairs.length === 0) throw new Error('No tasks were requested.');
  if (pairs.length > max) throw new Error('Too many tasks requested at once.');
  return pairs.map((pair) => {
    const ok =
      pair &&
      typeof pair.recallNumber === 'string' &&
      typeof pair.deviceId === 'string' &&
      pair.recallNumber.trim() &&
      pair.deviceId.trim();
    if (!ok) throw new Error('A requested task was not valid.');
    return { recallNumber: pair.recallNumber, deviceId: pair.deviceId };
  });
}

// Find the saved matches for the requested pairs, in the order asked. Pairs that are not in the
// saved result (it changed, or the browser sent something made up) come back in `notFound`.
export function selectMatches(savedMatches, pairs) {
  const byPair = new Map(savedMatches.map((m) => [pairKey(m.recallNumber, m.deviceId), m]));
  const matches = [];
  const notFound = [];
  for (const { recallNumber, deviceId } of pairs) {
    const found = byPair.get(pairKey(recallNumber, deviceId));
    if (found) matches.push(found);
    else notFound.push(pairKey(recallNumber, deviceId));
  }
  return { matches, notFound };
}

function chunk(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
}

// Which of these matches already have a task? Returns
//   { existing: Map(label -> issueKey), inProgress: Set(label) }
async function findExisting(items, jira, guard) {
  const existing = new Map();
  const inProgress = new Set();

  for (const { label } of items) {
    const entry = await guard.read(label);
    if (!entry) continue;
    if (entry.key) existing.set(label, entry.key);
    else inProgress.add(label);
  }

  const toSearch = items.map((i) => i.label).filter((label) => !existing.has(label));
  const found = toSearch.length ? await jira.findByLabels(toSearch) : new Map();
  for (const [label, key] of found) {
    existing.set(label, key);
    inProgress.delete(label); // Jira already has it: no longer "in progress"
  }
  return { existing, inProgress };
}

// What the panel shows for each (recall, device) pair: the issue key if a task exists.
// `matches` must already be limited to the pairs of interest.
export async function getTaskStates({ matches, jira, guard }) {
  const items = matches.filter(isTaskWorthy).map((match) => ({
    match,
    label: taskLabel(match.recallNumber, match.deviceId),
  }));
  const { existing } = await findExisting(items, jira, guard);
  const tasks = {};
  for (const { match, label } of items) {
    if (existing.has(label)) tasks[pairKey(match.recallNumber, match.deviceId)] = existing.get(label);
  }
  return tasks;
}

// Create a task for each match that does not have one yet.
// Returns { created, existing, inProgress, failed, skipped }:
//   created     [{ pair, key }]    new tasks
//   existing    [{ pair, key }]    already had a task (nothing was created)
//   inProgress  [pair]             being created right now by another click
//   failed      [{ pair, error }]  Jira refused or something broke
//   skipped     [pair]             not task-worthy (a "possible" match)
//
// `assignees` (optional) is a Map(pairKey -> { accountId }) of people the user has already agreed to
// assign; pairs not in it stay unassigned. It only matters for tasks that are really created.
export async function createTasks({ matches, jira, guard, projectKey, today, assignees = new Map() }) {
  const result = { created: [], existing: [], inProgress: [], failed: [], skipped: [] };

  // The same pair twice in one request must still produce one task.
  const seen = new Set();
  const items = [];
  for (const match of matches) {
    const pair = pairKey(match.recallNumber, match.deviceId);
    if (seen.has(pair)) continue;
    seen.add(pair);
    if (!isTaskWorthy(match)) {
      result.skipped.push(pair);
      continue;
    }
    items.push({ match, pair, label: taskLabel(match.recallNumber, match.deviceId) });
  }
  if (items.length === 0) return result;

  const { existing, inProgress } = await findExisting(items, jira, guard);
  const toCreate = [];
  for (const item of items) {
    if (existing.has(item.label)) result.existing.push({ pair: item.pair, key: existing.get(item.label) });
    else if (inProgress.has(item.label)) result.inProgress.push(item.pair);
    else toCreate.push(item);
  }
  if (toCreate.length === 0) return result;

  const issueTypeId = await jira.taskIssueTypeId(projectKey);
  if (!issueTypeId) {
    for (const item of toCreate) result.failed.push({ pair: item.pair, error: 'This project has no issue type for tasks.' });
    return result;
  }

  // Claim every label first, so a second click made while we are working sees "in progress".
  await Promise.all(toCreate.map((item) => guard.reserve(item.label)));

  for (const group of chunk(toCreate, BULK_CREATE_LIMIT)) {
    const fields = group.map((item) => {
      const assignee = assignees.get(item.pair);
      return buildIssueFields({ match: item.match, projectKey, issueTypeId, today, assigneeAccountId: assignee && assignee.accountId });
    });
    let outcome;
    try {
      outcome = await jira.bulkCreate(fields);
    } catch (error) {
      outcome = { created: [], errors: group.map((_, index) => ({ index, message: error.message || 'Jira request failed.' })) };
    }
    for (const { index, key } of outcome.created) {
      result.created.push({ pair: group[index].pair, key });
      await guard.record(group[index].label, key);
    }
    for (const { index, message } of outcome.errors) {
      result.failed.push({ pair: group[index].pair, error: message });
      await guard.release(group[index].label); // nothing was created, so allow a retry
    }
  }
  return result;
}
