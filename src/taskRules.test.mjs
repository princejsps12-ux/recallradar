import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_CONFIDENCES,
  DUE_DAYS_CLASS_I,
  DUE_DAYS_CLASS_II_III,
  UNKNOWN_CLASS_DUE_DAYS,
  APP_LABEL,
  SUMMARY_MAX_LENGTH,
  FDA_RECALL_DATABASE_URL,
  isTaskWorthy,
  dueDaysFor,
  dueDateFor,
  pairKey,
  taskLabel,
  recallRecordUrl,
  buildTaskSummary,
  buildTaskDescription,
  buildIssueFields,
} from './taskRules.js';

const match = {
  confidence: 'exact',
  rule: 'exact-manufacturer-model-lot',
  reason: 'Manufacturer, model "400020401" and serial/lot "50003704" are all listed in this recall.',
  deviceId: 'demo-001',
  deviceName: 'Plum Duo infusion pump',
  deviceManufacturer: 'ICU Medical',
  deviceModel: '400020401',
  lotOrSerial: '50003704',
  ward: 'ICU',
  recallNumber: 'Z-2723-2026',
  recallClass: 'II',
  firm: 'ICU Medical, Inc.',
  product: 'ICU Medical Plum Duo Infusion Pump',
  date: '2026-07-22',
};

const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

// Flatten an ADF document to plain text, to check what a person would read.
function adfText(node) {
  if (node.text) return node.text;
  return (node.content || []).map(adfText).join(node.type === 'doc' ? '\n' : '');
}

// --- Which matches get a task ---------------------------------------------------------------------

test('exact and likely matches are task-worthy; possible ones are not', () => {
  assert.deepEqual(TASK_CONFIDENCES, ['exact', 'likely']);
  assert.equal(isTaskWorthy({ confidence: 'exact' }), true);
  assert.equal(isTaskWorthy({ confidence: 'likely' }), true);
  assert.equal(isTaskWorthy({ confidence: 'possible' }), false);
  assert.equal(isTaskWorthy({ confidence: 'nonsense' }), false);
});

// --- Due date ---------------------------------------------------------------------------------------

test('the due-date numbers: Class I is 2 days, Class II and III are 7, unknown is treated as Class I', () => {
  assert.equal(DUE_DAYS_CLASS_I, 2);
  assert.equal(DUE_DAYS_CLASS_II_III, 7);
  assert.equal(UNKNOWN_CLASS_DUE_DAYS, DUE_DAYS_CLASS_I);
});

test('Class I is due sooner than Class II and III', () => {
  assert.ok(dueDaysFor('I') < dueDaysFor('II'));
  assert.ok(dueDaysFor('I') < dueDaysFor('III'));
});

test('Class II and III share the same due time', () => {
  assert.equal(dueDaysFor('II'), dueDaysFor('III'));
});

test('an unknown, empty or missing class gets the Class I time', () => {
  for (const value of ['', undefined, null, 'IV', 'Class II', 'ii']) {
    assert.equal(dueDaysFor(value), DUE_DAYS_CLASS_I, String(value));
  }
});

test('dueDateFor adds the class\'s calendar days to today', () => {
  assert.equal(dueDateFor('I', day(2026, 11, 14)), '2026-11-16');
  assert.equal(dueDateFor('II', day(2026, 11, 14)), '2026-11-21');
  assert.equal(dueDateFor('III', day(2026, 11, 14)), '2026-11-21');
});

test('dueDateFor rolls over months and years', () => {
  assert.equal(dueDateFor('I', day(2026, 11, 29)), '2026-12-01');
  assert.equal(dueDateFor('II', day(2026, 12, 28)), '2027-01-04');
});

test('dueDateFor handles leap days', () => {
  assert.equal(dueDateFor('I', day(2028, 2, 28)), '2028-03-01');
  assert.equal(dueDateFor('I', day(2027, 2, 27)), '2027-03-01');
});

test('dueDateFor uses the UTC date, whatever the time of day', () => {
  assert.equal(dueDateFor('I', new Date(Date.UTC(2026, 10, 14, 23, 59, 59))), '2026-11-16');
  assert.equal(dueDateFor('I', new Date(Date.UTC(2026, 10, 14, 0, 0, 0))), '2026-11-16');
});

test('dueDateFor does not change the date it was given', () => {
  const today = day(2026, 11, 14);
  dueDateFor('II', today);
  assert.equal(today.toISOString(), '2026-11-14T00:00:00.000Z');
});

// --- Identity ------------------------------------------------------------------------------------------

test('pairKey joins recall and device', () => {
  assert.equal(pairKey('Z-1-2026', 'demo-001'), 'Z-1-2026|demo-001');
});

test('the label encodes the recall and the device, and starts with the app label', () => {
  assert.equal(taskLabel('Z-2723-2026', 'demo-001'), 'recallradar-Z-2723-2026-demo-001');
  assert.ok(taskLabel('Z-1', 'a').startsWith(`${APP_LABEL}-`));
});

test('different recalls or devices give different labels (so each pair gets its own task)', () => {
  const labels = new Set([
    taskLabel('Z-1-2026', 'demo-001'),
    taskLabel('Z-2-2026', 'demo-001'),
    taskLabel('Z-1-2026', 'demo-002'),
  ]);
  assert.equal(labels.size, 3);
});

test('the same pair always gives the same label (so a repeat is recognised)', () => {
  assert.equal(taskLabel('Z-1-2026', 'demo-001'), taskLabel('Z-1-2026', 'demo-001'));
});

test('labels never contain spaces or characters Jira would reject', () => {
  const label = taskLabel('Z 1/2026', 'my device #4 (ICU)');
  assert.match(label, /^[A-Za-z0-9_.-]+$/);
});

test('labels are kept within Jira\'s 255 character limit', () => {
  assert.ok(taskLabel('Z-1', 'x'.repeat(1000)).length <= 255);
});

// --- Links -----------------------------------------------------------------------------------------------

test('the recall link is the openFDA record for exactly that recall number', () => {
  assert.equal(
    recallRecordUrl('Z-2723-2026'),
    'https://api.fda.gov/device/enforcement.json?search=recall_number:%22Z-2723-2026%22',
  );
});

test('the recall link encodes unusual characters', () => {
  assert.ok(recallRecordUrl('Z 1&x=2').includes('Z%201%26x%3D2'));
});

// --- Title -------------------------------------------------------------------------------------------------

test('the title has the recall number and the device', () => {
  assert.equal(buildTaskSummary(match), 'FDA recall Z-2723-2026: Plum Duo infusion pump (ICU Medical 400020401)');
});

test('a very long title is cut to Jira\'s limit', () => {
  const summary = buildTaskSummary({ ...match, deviceName: 'x'.repeat(600) });
  assert.ok(summary.length <= SUMMARY_MAX_LENGTH);
  assert.ok(summary.endsWith('…'));
  assert.ok(summary.startsWith('FDA recall Z-2723-2026'));
});

// --- Description ------------------------------------------------------------------------------------------

test('the description is a valid Atlassian document', () => {
  const doc = buildTaskDescription(match, '2026-11-21');
  assert.equal(doc.type, 'doc');
  assert.equal(doc.version, 1);
  assert.ok(doc.content.length > 0);
  assert.ok(doc.content.every((node) => node.type === 'paragraph' && Array.isArray(node.content)));
});

test('the description has the ward, the reason, the recall, the due rule and the link', () => {
  const doc = buildTaskDescription(match, '2026-11-21');
  const text = adfText(doc);
  assert.match(text, /Ward: ICU/);
  assert.match(text, /EXACT match/);
  assert.ok(text.includes(match.reason));
  assert.match(text, /Z-2723-2026, Class II, ICU Medical, Inc\., reported 2026-07-22/);
  assert.match(text, /serial\/lot 50003704/);
  assert.match(text, /2026-11-21 \(7 days after this task was created, because the recall is Class II\)/);
});

test('the description contains a real link to the recall record', () => {
  const doc = buildTaskDescription(match, '2026-11-21');
  const links = JSON.stringify(doc).match(/"href":"([^"]+)"/g);
  assert.ok(links.includes(`"href":"${recallRecordUrl('Z-2723-2026')}"`));
  assert.ok(links.includes(`"href":"${FDA_RECALL_DATABASE_URL}"`));
});

test('the description says LIKELY for a likely match', () => {
  assert.match(adfText(buildTaskDescription({ ...match, confidence: 'likely' }, '2026-11-21')), /LIKELY match/);
});

test('the description copes with missing ward, serial, class and date', () => {
  const text = adfText(
    buildTaskDescription({ ...match, ward: '', lotOrSerial: '', recallClass: '', date: '', product: '' }, '2026-11-16'),
  );
  assert.match(text, /Ward: not recorded/);
  assert.match(text, /serial\/lot not recorded/);
  assert.match(text, /class unknown/);
  assert.match(text, /date unknown/);
  assert.match(text, /2 days after this task was created/);
});

// --- Fields --------------------------------------------------------------------------------------------------

test('buildIssueFields gives every field Jira needs', () => {
  const fields = buildIssueFields({ match, projectKey: 'MOBL', issueTypeId: '10002', today: day(2026, 11, 14) });
  assert.deepEqual(fields.project, { key: 'MOBL' });
  assert.deepEqual(fields.issuetype, { id: '10002' });
  assert.equal(fields.summary, buildTaskSummary(match));
  assert.equal(fields.duedate, '2026-11-21');
  assert.deepEqual(fields.labels, ['recallradar', 'recallradar-Z-2723-2026-demo-001']);
  assert.equal(fields.description.type, 'doc');
});

test('buildIssueFields gives a Class I recall an earlier due date than Class II', () => {
  const today = day(2026, 11, 14);
  const one = buildIssueFields({ match: { ...match, recallClass: 'I' }, projectKey: 'P', issueTypeId: '1', today });
  const two = buildIssueFields({ match, projectKey: 'P', issueTypeId: '1', today });
  assert.ok(one.duedate < two.duedate);
  assert.match(JSON.stringify(one.description), /Class I,/);
});

test('buildIssueFields adds an assignee only when one was given', () => {
  const m = { confidence: 'exact', reason: 'r', deviceId: 'd1', deviceName: 'Pump', deviceManufacturer: 'X', deviceModel: 'M1', ward: 'ICU', recallNumber: 'Z-1-2026', recallClass: 'I', firm: 'X', product: 'p', date: '2026-01-01' };
  const base = { match: m, projectKey: 'MOBL', issueTypeId: '1', today: new Date(Date.UTC(2026, 10, 14)) };
  assert.equal('assignee' in buildIssueFields(base), false);
  assert.deepEqual(buildIssueFields({ ...base, assigneeAccountId: 'acc-1' }).assignee, { accountId: 'acc-1' });
});

test('the task description names the device\'s UDI-DI when it has one', () => {
  const match = { confidence: 'exact', reason: 'r', deviceId: 'd1', deviceName: 'Monitor', deviceManufacturer: 'Philips', deviceModel: '867232', lotOrSerial: 'US001A00AW', deviceUdiDi: '00884838102842', ward: 'ICU', recallNumber: 'Z-1-2026', recallClass: 'II', firm: 'Philips', product: 'Monitor', date: '2026-07-01' };
  assert.match(JSON.stringify(buildIssueFields({ match, projectKey: 'KAN', issueTypeId: '10001', today: new Date('2026-11-17T00:00:00Z') })), /UDI-DI 00884838102842/);
  assert.doesNotMatch(JSON.stringify(buildIssueFields({ match: { ...match, deviceUdiDi: '' }, projectKey: 'KAN', issueTypeId: '10001', today: new Date('2026-11-17T00:00:00Z') })), /UDI-DI/);
});
