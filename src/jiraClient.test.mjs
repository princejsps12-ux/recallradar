import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JQL_LABELS_PER_QUERY,
  buildLabelsJql,
  chooseTaskIssueType,
  parseBulkResponse,
  createJiraClient,
  countByAssignee,
  countByStatusCategory,
  ALL_TASKS_JQL,
  OPEN_TASKS_JQL,
} from './jiraClient.js';

// A stand-in for Forge's route`...` tag: just glue the pieces together.
const route = (strings, ...values) => strings.reduce((out, s, i) => out + s + (values[i] ?? ''), '');

// A fake requestJira that records calls and answers from a list.
function fakeRequest(answers) {
  const calls = [];
  const request = async (path, options = {}) => {
    calls.push({ path, options, body: options.body ? JSON.parse(options.body) : undefined });
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.json,
      text: async () => answer.text ?? JSON.stringify(answer.json ?? ''),
    };
  };
  return { request, calls };
}

// --- JQL ------------------------------------------------------------------------------------------------

test('buildLabelsJql lists the labels in quotes', () => {
  assert.equal(buildLabelsJql(['a-1', 'b.2']), 'labels in ("a-1", "b.2")');
});

// --- Issue type -------------------------------------------------------------------------------------------

test('chooseTaskIssueType prefers the type named Task, in any case', () => {
  assert.equal(chooseTaskIssueType([{ id: 1, name: 'Bug' }, { id: 2, name: 'task' }]), '2');
});

test('chooseTaskIssueType falls back to the first type that is not a sub-task', () => {
  assert.equal(chooseTaskIssueType([{ id: 5, name: 'Sub', subtask: true }, { id: 6, name: 'Story' }]), '6');
});

test('chooseTaskIssueType never picks a sub-task, even one named Task', () => {
  assert.equal(chooseTaskIssueType([{ id: 5, name: 'Task', subtask: true }]), null);
});

test('chooseTaskIssueType returns null when there is nothing usable', () => {
  assert.equal(chooseTaskIssueType([]), null);
  assert.equal(chooseTaskIssueType(undefined), null);
  assert.equal(chooseTaskIssueType([null]), null);
});

// --- Reading Jira's bulk answer ---------------------------------------------------------------------------

test('parseBulkResponse maps every created issue to its position', () => {
  const body = { issues: [{ key: 'P-1' }, { key: 'P-2' }, { key: 'P-3' }], errors: [] };
  assert.deepEqual(parseBulkResponse(body, 3), {
    created: [{ index: 0, key: 'P-1' }, { index: 1, key: 'P-2' }, { index: 2, key: 'P-3' }],
    errors: [],
  });
});

test('parseBulkResponse skips failed positions when matching created issues', () => {
  const body = {
    issues: [{ key: 'P-1' }, { key: 'P-2' }],
    errors: [{ status: 400, failedElementNumber: 1, elementErrors: { errorMessages: [], errors: { duedate: 'Bad date' } } }],
  };
  const out = parseBulkResponse(body, 3);
  assert.deepEqual(out.created, [{ index: 0, key: 'P-1' }, { index: 2, key: 'P-2' }]);
  assert.deepEqual(out.errors, [{ index: 1, message: 'Bad date' }]);
});

test('parseBulkResponse joins several error messages', () => {
  const body = {
    issues: [],
    errors: [{ failedElementNumber: 0, elementErrors: { errorMessages: ['First.'], errors: { a: 'Second.' } } }],
  };
  assert.equal(parseBulkResponse(body, 1).errors[0].message, 'First. Second.');
});

test('parseBulkResponse gives a plain message when Jira says nothing', () => {
  const out = parseBulkResponse({ issues: [], errors: [{ failedElementNumber: 0 }] }, 1);
  assert.match(out.errors[0].message, /could not create/);
});

test('parseBulkResponse reports positions Jira did not account for, instead of losing them', () => {
  const out = parseBulkResponse({ issues: [{ key: 'P-1' }], errors: [] }, 2);
  assert.deepEqual(out.created, [{ index: 0, key: 'P-1' }]);
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].index, 1);
});

test('parseBulkResponse tolerates empty or damaged answers', () => {
  assert.deepEqual(parseBulkResponse(undefined, 0), { created: [], errors: [] });
  assert.equal(parseBulkResponse({}, 2).errors.length, 2);
  assert.equal(parseBulkResponse({ errors: [{ failedElementNumber: 99 }] }, 1).errors.length, 1);
});

// --- The client ---------------------------------------------------------------------------------------------

test('findByLabels maps each existing label to its issue', async () => {
  const { request, calls } = fakeRequest([
    { status: 200, json: { issues: [{ key: 'P-7', fields: { labels: ['recallradar', 'recallradar-Z-1-a'] } }] } },
  ]);
  const found = await createJiraClient({ request, route }).findByLabels(['recallradar-Z-1-a', 'recallradar-Z-2-a']);
  assert.deepEqual([...found], [['recallradar-Z-1-a', 'P-7']]);
  assert.equal(calls[0].path, '/rest/api/3/search/jql');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].body.jql, 'labels in ("recallradar-Z-1-a", "recallradar-Z-2-a")');
});

test('findByLabels ignores labels it did not ask about', async () => {
  const { request } = fakeRequest([{ status: 200, json: { issues: [{ key: 'P-1', fields: { labels: ['other', 'recallradar'] } }] } }]);
  const found = await createJiraClient({ request, route }).findByLabels(['recallradar-Z-1-a']);
  assert.equal(found.size, 0);
});

test('findByLabels searches in groups and combines the answers', async () => {
  const labels = Array.from({ length: JQL_LABELS_PER_QUERY + 5 }, (_, i) => `l-${i}`);
  const { request, calls } = fakeRequest([
    { status: 200, json: { issues: [{ key: 'P-1', fields: { labels: ['l-0'] } }] } },
    { status: 200, json: { issues: [{ key: 'P-2', fields: { labels: [`l-${JQL_LABELS_PER_QUERY}`] } }] } },
  ]);
  const found = await createJiraClient({ request, route }).findByLabels(labels);
  assert.equal(calls.length, 2);
  assert.equal(found.get('l-0'), 'P-1');
  assert.equal(found.get(`l-${JQL_LABELS_PER_QUERY}`), 'P-2');
});

test('findByLabels with no labels makes no request', async () => {
  const { request, calls } = fakeRequest([]);
  assert.equal((await createJiraClient({ request, route }).findByLabels([])).size, 0);
  assert.equal(calls.length, 0);
});

test('findByLabels turns a Jira error into an Error carrying the status', async () => {
  const { request } = fakeRequest([{ status: 403, text: 'no permission' }]);
  await assert.rejects(createJiraClient({ request, route }).findByLabels(['x-1']), /403.*no permission/);
});

test('taskIssueTypeId asks the project for its issue types and picks Task', async () => {
  const { request, calls } = fakeRequest([{ status: 200, json: { issueTypes: [{ id: '10', name: 'Epic' }, { id: '11', name: 'Task' }] } }]);
  assert.equal(await createJiraClient({ request, route }).taskIssueTypeId('MOBL'), '11');
  assert.equal(calls[0].path, '/rest/api/3/issue/createmeta/MOBL/issuetypes');
});

test('taskIssueTypeId also understands the "values" form of the answer', async () => {
  const { request } = fakeRequest([{ status: 200, json: { values: [{ id: '12', name: 'Task' }] } }]);
  assert.equal(await createJiraClient({ request, route }).taskIssueTypeId('P'), '12');
});

test('bulkCreate posts every task and returns the parsed outcome', async () => {
  const { request, calls } = fakeRequest([{ status: 201, json: { issues: [{ key: 'P-1' }, { key: 'P-2' }], errors: [] } }]);
  const out = await createJiraClient({ request, route }).bulkCreate([{ summary: 'a' }, { summary: 'b' }]);
  assert.deepEqual(out.created, [{ index: 0, key: 'P-1' }, { index: 1, key: 'P-2' }]);
  assert.equal(calls[0].path, '/rest/api/3/issue/bulk');
  assert.deepEqual(calls[0].body, { issueUpdates: [{ fields: { summary: 'a' } }, { fields: { summary: 'b' } }] });
});

test('bulkCreate keeps partial success: some created, some failed', async () => {
  const { request } = fakeRequest([
    { status: 201, json: { issues: [{ key: 'P-1' }], errors: [{ failedElementNumber: 1, elementErrors: { errorMessages: ['No.'] } }] } },
  ]);
  const out = await createJiraClient({ request, route }).bulkCreate([{}, {}]);
  assert.deepEqual(out.created, [{ index: 0, key: 'P-1' }]);
  assert.deepEqual(out.errors, [{ index: 1, message: 'No.' }]);
});

test('bulkCreate throws when Jira refuses the whole request', async () => {
  const { request } = fakeRequest([{ status: 401, text: 'not logged in' }]);
  await assert.rejects(createJiraClient({ request, route }).bulkCreate([{}]), /401/);
});

// --- Open task counts (for the assignee suggestion) -----------------------------------------------------

test('open tasks are RecallRadar-labelled issues that are not done', () => {
  assert.equal(OPEN_TASKS_JQL, 'labels = "recallradar" AND statusCategory != Done');
});

test('countByAssignee counts per person and ignores unassigned and odd issues', () => {
  const issues = [
    { fields: { assignee: { accountId: 'a1' } } },
    { fields: { assignee: { accountId: 'a1' } } },
    { fields: { assignee: { accountId: 'b2' } } },
    { fields: { assignee: null } },
    { fields: {} },
    null,
  ];
  assert.deepEqual([...countByAssignee(issues)], [['a1', 2], ['b2', 1]]);
  assert.equal(countByAssignee(undefined).size, 0);
});

test('openTaskCounts searches once, asking only for the assignee', async () => {
  const { request, calls } = fakeRequest([{ status: 200, json: { issues: [{ key: 'P-1', fields: { assignee: { accountId: 'a1' } } }] } }]);
  const counts = await createJiraClient({ request, route }).openTaskCounts();
  assert.equal(counts.get('a1'), 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.jql, OPEN_TASKS_JQL);
  assert.deepEqual(calls[0].body.fields, ['assignee']);
});

test('openTaskCounts throws when Jira refuses', async () => {
  const { request } = fakeRequest([{ status: 403, json: {} }]);
  await assert.rejects(createJiraClient({ request, route }).openTaskCounts(), /403/);
});

// --- Task counts for the dashboard ---------------------------------------------------------------------

test('countByStatusCategory counts done by Jira\'s status category, everything else as open', () => {
  const issue = (key) => ({ fields: { status: { statusCategory: { key } } } });
  assert.deepEqual(countByStatusCategory([issue('done'), issue('new'), issue('indeterminate'), issue('done'), { fields: {} }, null]), { open: 3, done: 2 });
  assert.deepEqual(countByStatusCategory(undefined), { open: 0, done: 0 });
});

test('taskStatusCounts searches all RecallRadar tasks once and reports open and done', async () => {
  const { request, calls } = fakeRequest([{ status: 200, json: { issues: [{ fields: { status: { statusCategory: { key: 'done' } } } }, { fields: { status: { statusCategory: { key: 'new' } } } }] } }]);
  const counts = await createJiraClient({ request, route }).taskStatusCounts();
  assert.deepEqual(counts, { open: 1, done: 1, capped: false });
  assert.equal(calls[0].body.jql, ALL_TASKS_JQL);
  assert.deepEqual(calls[0].body.fields, ['status']);
});

test('taskStatusCounts says when the search was full (there may be more tasks)', async () => {
  const issues = Array.from({ length: 100 }, () => ({ fields: { status: { statusCategory: { key: 'new' } } } }));
  const { request } = fakeRequest([{ status: 200, json: { issues } }]);
  assert.equal((await createJiraClient({ request, route }).taskStatusCounts()).capped, true);
});

test('taskStatusCounts throws when Jira refuses', async () => {
  const { request } = fakeRequest([{ status: 403, json: {} }]);
  await assert.rejects(createJiraClient({ request, route }).taskStatusCounts(), /403/);
});
