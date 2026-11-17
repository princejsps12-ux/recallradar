// The daily alert: when a recall has started to affect a device since the last look, create the Jira task for it and post one
// comment listing what was found, so the people who follow the project hear about it without opening the dashboard.
//
// It runs after the daily check (and on an administrator's "Run now") and works from the SAVED check result, so it never calls
// openFDA itself. It runs WITHOUT a signed-in person, so Jira is called as the app (`jira` is the app's own client, see
// runtime.js): the app user needs permission to create issues in the chosen project, and says so plainly when it does not.
// Nobody is assigned (the Teamwork Graph can only be read on behalf of a person), and nothing is created twice: the task
// service finds a pair's existing task by its label first.
//
// `state` is made by alertState.js, `settings` by alertSettings.js, `guard` by taskService.js. No Forge imports, so every
// path is unit tested with fakes.
import { createTasks } from './taskService.js';
import { openTaskMatches, pairKey } from './taskRules.js';

// The most tasks one run creates. More than this in a day means something other than news (a rule change, a very large import
// that was not marked as such); the rest stay waiting (see ALERT_WINDOW_MS in alertState.js) and the run says how many.
export const MAX_ALERT_TASKS_PER_RUN = 50;

// The comment lists at most this many devices; the rest are counted.
export const MAX_COMMENT_ITEMS = 20;

const CLASS_TEXT = { I: 'Class I', II: 'Class II', III: 'Class III' };

// An ADF document (Jira's comment format) for the comment: what was found, one line per task, where to look next.
// `items` are [{ match, key }]; `baseUrl` (the site address) turns the task keys into links, and is '' when unknown.
export function buildAlertComment({ items, dateText, baseUrl = '', leftOut = 0 }) {
  const recalls = new Set(items.map((i) => i.match.recallNumber)).size;
  const devices = new Set(items.map((i) => i.match.deviceId)).size;
  const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
  const para = (...content) => ({ type: 'paragraph', content });
  const shown = items.slice(0, MAX_COMMENT_ITEMS);
  const lines = shown.map(({ match, key }) => {
    const label = `${match.recallNumber} (${CLASS_TEXT[match.recallClass] || 'class not stated'})`;
    const where = `${match.deviceName}${match.ward ? `, ${match.ward}` : ''}`;
    const link = key ? [text(key, baseUrl ? [{ type: 'link', attrs: { href: `${baseUrl}/browse/${key}` } }] : undefined)] : [text('no task yet')];
    return { type: 'listItem', content: [para(text(label, [{ type: 'strong' }]), text(` ${where}: `), ...link)] };
  });
  const more = items.length - shown.length;
  const content = [
    para(text('RecallRadar: ', [{ type: 'strong' }]), text(`${recalls} new ${recalls === 1 ? 'recall affects' : 'recalls affect'} ${devices} ${devices === 1 ? 'device' : 'devices'} (${dateText}).`)),
    { type: 'bulletList', content: lines },
  ];
  if (more > 0) content.push(para(text(`...and ${more} more.`)));
  if (leftOut > 0) content.push(para(text(`${leftOut} more will be handled at the next daily run.`)));
  content.push(para(text('Open the RecallRadar dashboard to see why each device matches and how the work is going.')));
  return { version: 1, type: 'doc', content };
}

// A Jira failure in words an administrator can act on. The app user is a person-less account: when Jira refuses it, the
// project's permissions are the first thing to look at.
export function friendlyJiraError(error, projectKey = '') {
  const message = String((error && error.message) || error || '');
  if (/\b(401|403|404)\b/.test(message)) {
    return `Jira would not let the RecallRadar app work in ${projectKey || 'that project'}. Open the project, Project settings, Access (or Permissions), and give the RecallRadar app user the permissions to browse the project, create issues and add comments.`;
  }
  if (/\b429\b/.test(message)) return 'Jira asked RecallRadar to slow down. The next daily run will try again.';
  return 'Jira did not accept the request. The next daily run will try again.';
}

// The same for the issue that gets the comment.
export function friendlyIssueError(error, issueKey = '') {
  const message = String((error && error.message) || error || '');
  if (/\b(401|403|404)\b/.test(message)) {
    return `RecallRadar could not open ${issueKey || 'that issue'} as the app user. Check the issue key, and that the RecallRadar app user may browse that project and add comments.`;
  }
  return 'Jira did not answer. Please try again.';
}

/**
 * Handle the news. Returns { ran: false, reason } when there was nothing to do (alerts off, no project, an incomplete check), or
 * { ran: true, summary } with what was done; the summary is also saved as the "last run".
 *   summary: { at, news, created: [keys], existing, failed, left, comment: 'none'|'posted'|'failed', error }
 */
export async function runAlerts({ state, settings, result, jira, guard, now = () => new Date(), log = console }) {
  const config = await settings.get();
  if (!config.enabled) return { ran: false, reason: 'off' };
  if (!config.projectKey) return { ran: false, reason: 'no-project' };
  if (!result || result.failedQueries > 0) return { ran: false, reason: 'incomplete' };

  const affected = openTaskMatches(result);
  const byPair = new Map(affected.map((m) => [pairKey(m.recallNumber, m.deviceId), m]));
  const { due, expired } = await state.pendingAlerts(new Set(byPair.keys()));
  await state.markAlerted(expired);

  const summary = { at: now().toISOString(), news: due.length, created: [], existing: 0, failed: 0, left: 0, comment: 'none', error: '' };
  if (due.length === 0) {
    await state.setLast(summary);
    return { ran: true, summary };
  }

  const batch = due.slice(0, MAX_ALERT_TASKS_PER_RUN);
  summary.left = due.length - batch.length;
  let outcome;
  try {
    outcome = await createTasks({ matches: batch.map((pair) => byPair.get(pair)), jira, guard, projectKey: config.projectKey, today: now() });
  } catch (error) {
    log.error('Daily alert could not create tasks', error);
    summary.error = friendlyJiraError(error, config.projectKey);
    await state.setLast(summary);
    return { ran: true, summary };
  }

  const keyOf = new Map([...outcome.created, ...outcome.existing].map(({ pair, key }) => [pair, key]));
  summary.created = outcome.created.map(({ key }) => key);
  summary.existing = outcome.existing.length;
  summary.failed = outcome.failed.length;
  if (outcome.failed.length) summary.error = friendlyJiraError(new Error(outcome.failed[0].error), config.projectKey);
  // Handled: a task was made, or one already existed (somebody got there first), or another run is making it right now.
  await state.markAlerted([...keyOf.keys(), ...outcome.inProgress]);

  if (config.commentIssueKey && keyOf.size > 0) {
    try {
      const baseUrl = await jira.baseUrl().catch(() => '');
      const items = batch.filter((pair) => keyOf.has(pair)).map((pair) => ({ match: byPair.get(pair), key: keyOf.get(pair) }));
      const dateText = now().toISOString().slice(0, 10);
      await jira.addComment(config.commentIssueKey, buildAlertComment({ items, dateText, baseUrl, leftOut: summary.left }));
      summary.comment = 'posted';
    } catch (error) {
      log.error('Daily alert could not post its comment', error);
      summary.comment = 'failed';
      summary.error = summary.error || friendlyIssueError(error, config.commentIssueKey);
    }
  }
  await state.setLast(summary);
  return { ran: true, summary };
}
