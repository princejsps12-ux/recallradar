// The three Jira calls task creation needs, behind a small interface (see taskService.js).
//
//   findByLabels(labels)        -> Map(label -> issueKey) for tasks that already exist
//   taskIssueTypeId(projectKey) -> id of the project's "Task" issue type (or null)
//   bulkCreate(fieldsList)      -> { created: [{ index, key }], errors: [{ index, message }] }
//
// `request(path, options)` is Jira's requestJira as the CLICKING USER (asUser), so Jira applies
// that user's permissions: someone who may not create issues simply gets an error back.
// `route` is Forge's route template tag. Both are injected so the response handling here is unit
// tested without Forge. Only values that are single path segments (a project key) are put into
// route`...`; Forge rejects any other kind of interpolation.

// How many labels to look up in one JQL search. Keeps the query short, and the answer well
// below the 100 issues one search returns, since each label belongs to at most one task.
export const JQL_LABELS_PER_QUERY = 20;
const SEARCH_RESULT_LIMIT = 100;

function chunk(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
}

// `labels in ("a", "b")`. Labels come from taskLabel(), which only emits letters, digits and
// _ . - so quoting them is enough.
export function buildLabelsJql(labels) {
  return `labels in (${labels.map((label) => `"${label}"`).join(', ')})`;
}

// Every RecallRadar task carries the label "recallradar" (APP_LABEL); "not done" is Jira's own status category.
export const ALL_TASKS_JQL = 'labels = "recallradar"';
export const OPEN_TASKS_JQL = 'labels = "recallradar" AND statusCategory != Done';

// Issues from a search -> Map(accountId -> how many are assigned to that person).
export function countByAssignee(issues) {
  const counts = new Map();
  for (const issue of issues || []) {
    const assignee = issue && issue.fields && issue.fields.assignee;
    if (assignee && assignee.accountId) counts.set(assignee.accountId, (counts.get(assignee.accountId) || 0) + 1);
  }
  return counts;
}

// Issues from a search -> { open, done }, by Jira's own status category ("done" is the green category,
// whatever the project calls its statuses).
export function countByStatusCategory(issues) {
  const counts = { open: 0, done: 0 };
  for (const issue of issues || []) {
    if (!issue) continue;
    const category = issue.fields && issue.fields.status && issue.fields.status.statusCategory;
    if (category && category.key === 'done') counts.done += 1;
    else counts.open += 1;
  }
  return counts;
}

// Choose the issue type for a task: one named "Task", otherwise the first that is not a sub-task.
export function chooseTaskIssueType(types) {
  const usable = (types || []).filter((type) => type && !type.subtask);
  const named = usable.find((type) => String(type.name).toLowerCase() === 'task');
  const chosen = named || usable[0];
  return chosen ? String(chosen.id) : null;
}

// Turn Jira's bulk-create answer into per-item results.
// Jira lists the created issues in order (skipping the failed ones) and lists each failure with
// the position of the item it belongs to (failedElementNumber).
export function parseBulkResponse(body, count) {
  const issues = Array.isArray(body && body.issues) ? body.issues : [];
  const errors = [];
  const failed = new Set();
  for (const error of Array.isArray(body && body.errors) ? body.errors : []) {
    const index = error.failedElementNumber;
    const element = error.elementErrors || {};
    const messages = [
      ...(element.errorMessages || []),
      ...Object.values(element.errors || {}),
    ];
    const message = messages.join(' ') || 'Jira could not create this task.';
    if (Number.isInteger(index) && index >= 0 && index < count) {
      failed.add(index);
      errors.push({ index, message });
    }
  }
  const created = [];
  let next = 0;
  for (let index = 0; index < count; index += 1) {
    if (failed.has(index)) continue;
    const issue = issues[next];
    next += 1;
    if (issue && issue.key) created.push({ index, key: issue.key });
    else errors.push({ index, message: 'Jira did not report this task as created.' });
  }
  return { created, errors };
}

async function readError(response) {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 200);
  } catch (error) {
    // no body is fine
  }
  return new Error(`Jira answered ${response.status}${detail ? `: ${detail}` : ''}`);
}

export function createJiraClient({ request, route }) {
  async function findByLabels(labels) {
    const found = new Map();
    const wanted = new Set(labels);
    for (const group of chunk(labels, JQL_LABELS_PER_QUERY)) {
      const response = await request(route`/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jql: buildLabelsJql(group), fields: ['labels'], maxResults: SEARCH_RESULT_LIMIT }),
      });
      if (!response.ok) throw await readError(response);
      const body = await response.json();
      for (const issue of body.issues || []) {
        for (const label of (issue.fields && issue.fields.labels) || []) {
          if (wanted.has(label) && !found.has(label)) found.set(label, issue.key);
        }
      }
    }
    return found;
  }

  async function taskIssueTypeId(projectKey) {
    const response = await request(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw await readError(response);
    const body = await response.json();
    return chooseTaskIssueType(body.issueTypes || body.values);
  }

  async function bulkCreate(fieldsList) {
    const response = await request(route`/rest/api/3/issue/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ issueUpdates: fieldsList.map((fields) => ({ fields })) }),
    });
    // Jira answers 201 with a list of created issues and a list of errors; both can be present.
    if (!response.ok && response.status !== 201) throw await readError(response);
    return parseBulkResponse(await response.json(), fieldsList.length);
  }

  // How many NOT-done RecallRadar tasks each person has: Map(accountId -> count). Feeds the
  // "fewest open tasks" assignee suggestion. Unassigned tasks are not counted. One search of at most
  // SEARCH_RESULT_LIMIT issues is enough for a suggestion, and a failure only means "no load data".
  async function openTaskCounts() {
    const response = await request(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jql: OPEN_TASKS_JQL, fields: ['assignee'], maxResults: SEARCH_RESULT_LIMIT }),
    });
    if (!response.ok) throw await readError(response);
    return countByAssignee((await response.json()).issues);
  }

  // How many RecallRadar tasks are open and how many are done, for the dashboard. One search of at most
  // SEARCH_RESULT_LIMIT issues; `capped` says there may be more than were counted.
  async function taskStatusCounts() {
    const response = await request(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jql: ALL_TASKS_JQL, fields: ['status'], maxResults: SEARCH_RESULT_LIMIT }),
    });
    if (!response.ok) throw await readError(response);
    const issues = (await response.json()).issues || [];
    return { ...countByStatusCategory(issues), capped: issues.length >= SEARCH_RESULT_LIMIT };
  }

  // The Jira projects the signed-in person can see, for the dashboard's "create tasks in project" choice (a global
  // page has no issue to take the project from), plus the keys of the ones they viewed most recently, newest
  // first, so the dashboard can start on a project they are actually working in. At most 50 projects, by name.
  async function listProjects() {
    const response = await request(route`/rest/api/3/project/search?maxResults=50&orderBy=name`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw await readError(response);
    const body = await response.json();
    const projects = (body.values || []).filter((p) => p && p.key && p.name).map((p) => ({ key: p.key, name: p.name }));
    let recent = [];
    try {
      const recentResponse = await request(route`/rest/api/3/project/recent`, { headers: { Accept: 'application/json' } });
      if (recentResponse.ok) recent = (await recentResponse.json()).filter((p) => p && p.key).map((p) => p.key);
    } catch (error) {
      // no "recent" list is fine: nothing is preselected then
    }
    return { projects, recent };
  }

  // Whether the signed-in person holds Jira's global "Administer Jira" permission. Jira answers
  // { permissions: { ADMINISTER: { havePermission: true | false } } }; anything else counts as "no".
  // ADMINISTER_PROJECTS is a project permission; asked without a project, Jira answers whether the person holds it in at
  // least one project (that is what "project administrator" means here). One call answers both questions.
  async function adminRoles() {
    const response = await request(route`/rest/api/3/mypermissions?permissions=ADMINISTER,ADMINISTER_PROJECTS`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Jira answered ${response.status} when asked for the permissions`);
    const body = await response.json();
    const has = (key) => Boolean(body && body.permissions && body.permissions[key] && body.permissions[key].havePermission === true);
    return { administrator: has('ADMINISTER'), projectAdministrator: has('ADMINISTER_PROJECTS') };
  }

  async function isAdministrator() {
    return (await adminRoles()).administrator;
  }

  return { findByLabels, taskIssueTypeId, bulkCreate, openTaskCounts, taskStatusCounts, listProjects, isAdministrator, adminRoles };
}
