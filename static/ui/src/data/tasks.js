import { invoke } from '@forge/bridge';

// How many tasks to create per request. Keep at or below MAX_PAIRS_PER_REQUEST in src/taskService.js
// (creating a task takes about 0.6 s and a UI function is cut off at 25 s).
export const TASKS_PER_REQUEST = 10;

export const pairOf = (match) => `${match.recallNumber}|${match.deviceId}`;
const toRequest = (match) => ({ recallNumber: match.recallNumber, deviceId: match.deviceId });

// Create tasks for these matches in batches, one request after another. `assign` sends the suggested
// assignee (from `suggestions`) for each match; the server checks every one against the ward's team again.
// `projectKey` is used only on the dashboard (the panel's project comes from its issue).
// onProgress(done, total) is called between batches; onTasks({pair: key}) as tasks appear.
// Returns { created, existing, inProgress, failed: [{pair, error}], notFound, assigned, refused, assignError, stopped }.
export async function createInBatches({ matches, assign, suggestions = {}, projectKey, onProgress, onTasks }) {
  const total = { created: 0, existing: 0, inProgress: 0, failed: [], notFound: 0, assigned: 0, refused: 0, routed: 0, escalated: 0, assignError: '', stopped: '' };
  for (let start = 0; start < matches.length; start += TASKS_PER_REQUEST) {
    if (onProgress) onProgress(start, matches.length);
    const batch = matches.slice(start, start + TASKS_PER_REQUEST);
    const assignees = {};
    if (assign) {
      for (const match of batch) {
        const suggestion = suggestions[pairOf(match)];
        if (suggestion) assignees[pairOf(match)] = suggestion.accountId;
      }
    }
    try {
      const response = await invoke('createTasks', { pairs: batch.map(toRequest), assignees, projectKey });
      if (!response || !response.ok) {
        total.stopped = (response && response.error) || 'Could not create the tasks.';
        break;
      }
      const known = {};
      [...response.created, ...response.existing].forEach((t) => {
        known[t.pair] = t.key;
      });
      if (onTasks) onTasks(known);
      total.created += response.created.length;
      total.existing += response.existing.length;
      total.inProgress += response.inProgress.length;
      total.failed.push(...response.failed);
      total.notFound += response.notFound.length;
      total.assigned += Object.keys(response.assignedTo || {}).length;
      total.refused += (response.assignRefused || []).length;
      total.routed += (response.routed || []).length;
      total.escalated += (response.routed || []).filter((r) => r.escalated).length;
      if (response.assignError) total.assignError = response.assignError;
    } catch (e) {
      total.stopped = 'Could not reach RecallRadar.';
      break;
    }
  }
  return total;
}

// One plain sentence about what happened, for a message the person reads.
export function summarize(total) {
  const parts = [];
  if (total.created) parts.push(`Created ${total.created} task${total.created === 1 ? '' : 's'}`);
  if (total.routed) parts.push(`${total.routed} labelled for the team that owns the ward${total.escalated ? `, ${total.escalated} escalated because that team already has many open tasks` : ''}`);
  if (total.assigned) parts.push(`${total.assigned} assigned to the suggested team member`);
  if (total.refused) parts.push(`${total.refused} not assigned (that person is not in the ward's team)`);
  if (total.assignError) parts.push(total.assignError);
  if (total.existing) parts.push(`${total.existing} already had a task`);
  if (total.inProgress) parts.push(`${total.inProgress} being created by another click`);
  if (total.failed.length) parts.push(`${total.failed.length} failed (${total.failed[0].error})`);
  if (total.notFound) parts.push(`${total.notFound} no longer in the result, try Refresh`);
  if (total.stopped) parts.push(`Stopped: ${total.stopped} Click again to continue`);
  return parts.length ? `${parts.join('. ')}.` : '';
}
