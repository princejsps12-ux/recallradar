// What a RecallRadar task looks like: which matches get one, its due date, its title, its labels
// and its description. No Forge imports, so every rule is unit tested with plain Node.

// --- Which matches get a task ---------------------------------------------------------------------

// Only matches we are fairly sure about. "possible" matches are weak (same maker and kind of
// device, or a model number from another firm), and a task for each would bury the hospital's
// team in noise: those stay on screen for a person to judge.
export const TASK_CONFIDENCES = Object.freeze(['exact', 'likely']);

export function isTaskWorthy(match) {
  return TASK_CONFIDENCES.includes(match.confidence);
}

// openFDA recall statuses that mean the recall is over. Anything else (including "Ongoing", or no status in an older saved
// check) counts as open. static/ui/src/dashboardData.mjs keeps its own copy (the UI bundle cannot import from src/).
export const CLOSED_STATUSES = Object.freeze(['terminated', 'completed']);

export function isRecallClosed(details) {
  return Boolean(details && CLOSED_STATUSES.includes(String(details.status).toLowerCase()));
}

// The matches a person has to act on: exact or likely, and the recall is still open.
export function openTaskMatches(result) {
  if (!result || !Array.isArray(result.matches)) return [];
  const details = result.recallDetails || {};
  return result.matches.filter((m) => isTaskWorthy(m) && !isRecallClosed(details[m.recallNumber]));
}

// --- Due date (the rule, and the reason for every number) --------------------------------------------
//
// FDA classes recalls by how dangerous the problem is (21 CFR 7.3):
//   Class I    a reasonable chance of serious harm or death
//   Class II   temporary or medically reversible harm, or a remote chance of serious harm
//   Class III  not likely to cause harm
//
// The due date is a number of CALENDAR days counted from the day the task is created (the UTC
// date), so it never depends on weekends or holidays.
//
//   Class I        2 days   Serious harm is possible, so the hospital should find and quarantine
//                           the device within a couple of days, not wait for a weekly review.
//   Class II / III 7 days   Harm is unlikely or reversible, so the team's normal weekly review
//                           is soon enough.
//   Unknown class  2 days   We cannot rule out serious harm, and in a hospital a task that is
//                           due too early costs far less than a missed recall, so it is treated
//                           like Class I.
export const DUE_DAYS_CLASS_I = 2;
export const DUE_DAYS_CLASS_II_III = 7;

export const DUE_DAYS_BY_CLASS = Object.freeze({
  I: DUE_DAYS_CLASS_I,
  II: DUE_DAYS_CLASS_II_III,
  III: DUE_DAYS_CLASS_II_III,
});
export const UNKNOWN_CLASS_DUE_DAYS = DUE_DAYS_CLASS_I;

// How many days a recall of this class is given. `recallClass` is "I", "II" or "III".
export function dueDaysFor(recallClass) {
  return DUE_DAYS_BY_CLASS[recallClass] ?? UNKNOWN_CLASS_DUE_DAYS;
}

// The due date as Jira wants it (YYYY-MM-DD): `today` plus the class's days, in UTC.
export function dueDateFor(recallClass, today) {
  const due = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  due.setUTCDate(due.getUTCDate() + dueDaysFor(recallClass));
  return due.toISOString().slice(0, 10);
}

// --- Identity: one task per recall + device -----------------------------------------------------------

// Every task carries this label, so the hospital can find all RecallRadar tasks with one search.
export const APP_LABEL = 'recallradar';

// Jira labels cannot contain spaces and are limited to 255 characters.
const MAX_LABEL_LENGTH = 255;

// A key for one (recall, device) pair, used between the panel and the server.
export function pairKey(recallNumber, deviceId) {
  return `${recallNumber}|${deviceId}`;
}

function safeLabelPart(text) {
  return String(text).replace(/[^A-Za-z0-9_.-]/g, '_');
}

// The label that marks "this recall has a task for this device". Looking it up in Jira is how
// we know a task already exists, even if our own storage was cleared.
export function taskLabel(recallNumber, deviceId) {
  return `${APP_LABEL}-${safeLabelPart(recallNumber)}-${safeLabelPart(deviceId)}`.slice(0, MAX_LABEL_LENGTH);
}

// --- Links ----------------------------------------------------------------------------------------------

// The openFDA record for exactly this recall (verified to return it). FDA does not publish a
// stable per-recall web page we could verify, so this is the dependable link to the recall itself.
export function recallRecordUrl(recallNumber) {
  return `https://api.fda.gov/device/enforcement.json?search=recall_number:%22${encodeURIComponent(recallNumber)}%22`;
}

// FDA's searchable medical device recall database, for browsing around the recall.
export const FDA_RECALL_DATABASE_URL = 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfRES/res.cfm';

// --- Text ---------------------------------------------------------------------------------------------------

// Jira rejects summaries longer than this.
export const SUMMARY_MAX_LENGTH = 255;

// "FDA recall Z-2723-2026: Plum Duo infusion pump (ICU Medical 400020401)"
export function buildTaskSummary(match) {
  const text = `FDA recall ${match.recallNumber}: ${match.deviceName} (${match.deviceManufacturer} ${match.deviceModel})`;
  return text.length <= SUMMARY_MAX_LENGTH ? text : `${text.slice(0, SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
}

// Atlassian Document Format helpers: Jira's REST API v3 takes rich text only in this shape.
const text = (value, marks) => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value });
const bold = (value) => text(value, [{ type: 'strong' }]);
const link = (url) => text(url, [{ type: 'link', attrs: { href: url } }]);
const paragraph = (...parts) => ({ type: 'paragraph', content: parts });

// The task body: where the device is, why we think it is affected, what the recall is, and
// where to read it. `dueDate` is shown with the rule so the reader knows why it is that soon.
export function buildTaskDescription(match, dueDate, route) {
  const confidence = match.confidence.toUpperCase();
  const classText = match.recallClass ? `Class ${match.recallClass}` : 'class unknown';
  const days = dueDaysFor(match.recallClass);
  return {
    type: 'doc',
    version: 1,
    content: [
      paragraph(bold('Ward: '), text(match.ward || 'not recorded')),
      ...(route ? [paragraph(bold('Owning team: '), text(`${route.teamName} (the team mapped to this ward in RecallRadar)`))] : []),
      ...(route && route.escalated ? [paragraph(bold('Escalated: '), text(`${route.teamName} already has ${route.open} open RecallRadar tasks (limit ${route.limit}). Ask a lead to rebalance the work or confirm who takes this one.`))] : []),
      paragraph(
        bold('Device: '),
        text(
          `${match.deviceName}, ${match.deviceManufacturer} ${match.deviceModel}, serial/lot ${
            match.lotOrSerial || 'not recorded'
          }${match.deviceUdiDi ? `, UDI-DI ${match.deviceUdiDi}` : ''}`,
        ),
      ),
      paragraph(bold(`Why this device (${confidence} match): `), text(match.reason)),
      paragraph(
        bold('Recall: '),
        text(`${match.recallNumber}, ${classText}, ${match.firm}, reported ${match.date || 'date unknown'}`),
      ),
      paragraph(bold('Product: '), text(match.product || 'not stated')),
      paragraph(bold('FDA recall record (raw openFDA data, for checking): '), link(recallRecordUrl(match.recallNumber))),
      paragraph(bold('Search the FDA recall database: '), link(FDA_RECALL_DATABASE_URL)),
      paragraph(
        bold('Due: '),
        text(`${dueDate} (${days} days after this task was created, because the recall is ${classText})`),
      ),
      paragraph(text('Created by RecallRadar. Check the device against the recall before acting.')),
    ],
  };
}

// All the Jira fields for one task. `assigneeAccountId` is optional: a task is only assigned when
// the person was asked and said yes (the caller passes it), never by default.
export function buildIssueFields({ match, projectKey, issueTypeId, today, assigneeAccountId, route }) {
  const dueDate = dueDateFor(match.recallClass, today);
  const fields = {
    project: { key: projectKey },
    issuetype: { id: issueTypeId },
    summary: buildTaskSummary(match),
    description: buildTaskDescription(match, dueDate, route),
    duedate: dueDate,
    labels: [APP_LABEL, taskLabel(match.recallNumber, match.deviceId), ...(route ? [route.label, ...(route.escalated ? ['recallradar-escalated'] : [])] : [])],
  };
  if (assigneeAccountId) fields.assignee = { accountId: assigneeAccountId };
  return fields;
}
