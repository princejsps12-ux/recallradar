// READ-ONLY access to the Atlassian Teamwork Graph: which teams a person is in, who is in a team, which Jira projects
// a team works in (and who leads them), and what Jira work is assigned to a person. RecallRadar never writes to the graph.
//
// These are the ONLY four Teamwork Graph calls the app makes (the README lists them too):
//
//   1. atlassianUserInTeams(userId, first)             the teams the signed-in person belongs to
//   2. atlassianTeamMembers(teamAri, first)            the people in one team
//   3. spacesByAtlassianTeam(teamAri, first)           the Jira projects linked to a team, with each project's lead
//   4. atlassianUserAssignedJiraWorkItems(userId, ...) the Jira work assigned to one person (key, title, due date, status)
//
// Facts learned by probing the live API (docs/teamwork-graph-findings.md):
//   * they work only AS A USER (api.asUser().requestTeamworkGraph); there is no app-level version, so
//     nothing here can run in background code (the daily trigger, the queue consumer);
//   * every request needs an operation name shaped company_operation, in the query text and as the
//     third argument;
//   * the team and member nodes are GraphQL unions, so each needs an inline fragment;
//   * there is no "list every team" query and no owner or role field on a team, so "the team list" is the
//     teams the current person is in, and a team member is picked by a rule (see teamService.js). What the graph
//     does have is the Jira project a team is linked to, and that project's lead (call 3);
//   * calls 3 and 4 need the scopes read:graph:project:jira and read:graph:issue:jira. A missing scope is NOT an
//     error: the rows are simply left out, so an empty answer can mean "nothing there" or "scope not granted".
//
// `request(query, variables, operationName)` is requestTeamworkGraph as the user, injected so the
// parsing here is unit tested without Forge. No Forge imports.

// How many teams / members to ask for per call. The API REJECTS anything above 25 ("The 'first' argument
// must not exceed 25", found on the live site), so 25 is its maximum page size. A hospital's wards are
// few, so one page is enough; the README states this limit.
export const TEAM_PAGE_SIZE = 25;
export const MEMBER_PAGE_SIZE = 25;

// Projects linked to one team: a team works in a handful, so one small page is plenty.
export const TEAM_SPACES_PAGE_SIZE = 10;

// A person's assigned work is read 25 items at a time (the maximum), at most this many pages: 50 items settle "how busy is
// this person" for a person who is not buried, and a person who is gets "at least N" instead of more calls.
export const ASSIGNED_WORK_PAGE_SIZE = 25;
export const MAX_ASSIGNED_WORK_PAGES = 2;

export const OPERATIONS = Object.freeze({
  MY_TEAMS: 'recallradar_myteams',
  TEAM_MEMBERS: 'recallradar_teammembers',
  TEAM_SPACES: 'recallradar_teamspaces',
  ASSIGNED_WORK: 'recallradar_assignedwork',
});

// The two GraphQL documents, exactly as sent. Variables are used for every value, so nothing a user
// types is ever pasted into the query text.
export const MY_TEAMS_QUERY = `query ${OPERATIONS.MY_TEAMS}($userId: ID!, $first: Int) {
  atlassianUserInTeams(userId: $userId, first: $first) {
    edges { node { __typename ... on AtlassianTeam { id displayName } } }
  }
}`;

export const TEAM_MEMBERS_QUERY = `query ${OPERATIONS.TEAM_MEMBERS}($teamAri: ID!, $first: Int) {
  atlassianTeamMembers(teamAri: $teamAri, first: $first) {
    edges { node { __typename ... on AtlassianUser { accountId name } } }
  }
}`;

export const TEAM_SPACES_QUERY = `query ${OPERATIONS.TEAM_SPACES}($teamAri: ID!, $first: Int) {
  spacesByAtlassianTeam(teamAri: $teamAri, first: $first) {
    edges { node { __typename ... on JiraSpace { key name lead { name } } } }
  }
}`;

export const ASSIGNED_WORK_QUERY = `query ${OPERATIONS.ASSIGNED_WORK}($userId: ID!, $first: Int, $after: String) {
  atlassianUserAssignedJiraWorkItems(userId: $userId, first: $first, after: $after) {
    edges { node { __typename ... on JiraWorkItem { key summary dueAt status { name statusCategory { key } } } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

// Atlassian account ids: letters, digits, colon, dash, underscore (for example 712020:11111111-...).
export function isAccountId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{3,128}$/.test(value);
}

export const userAri = (accountId) => `ari:cloud:identity::user/${accountId}`;

// ari:cloud:identity::team/<uuid>
export function isTeamAri(value) {
  return typeof value === 'string' && /^ari:cloud:identity::team\/[0-9A-Za-z-]{8,64}$/.test(value);
}

// The Teamwork Graph answers HTTP 200 even for errors, which arrive in an `errors` list.
function dataOrThrow(body) {
  if (body && Array.isArray(body.errors) && body.errors.length > 0) {
    throw new Error(`Teamwork Graph: ${String(body.errors[0].message || 'error').slice(0, 160)}`);
  }
  if (!body || !body.data) throw new Error('Teamwork Graph returned no data.');
  return body.data;
}

// Teams as { ari, name }, sorted by name, no duplicates.
export function parseTeams(body) {
  const data = dataOrThrow(body);
  const edges = (data.atlassianUserInTeams && data.atlassianUserInTeams.edges) || [];
  const byAri = new Map();
  for (const edge of edges) {
    const node = edge && edge.node;
    if (node && node.__typename === 'AtlassianTeam' && isTeamAri(node.id) && node.displayName) {
      byAri.set(node.id, { ari: node.id, name: String(node.displayName) });
    }
  }
  return [...byAri.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Members as { accountId, name }, sorted by name, no duplicates.
export function parseMembers(body) {
  const data = dataOrThrow(body);
  const edges = (data.atlassianTeamMembers && data.atlassianTeamMembers.edges) || [];
  const byId = new Map();
  for (const edge of edges) {
    const node = edge && edge.node;
    if (node && node.__typename === 'AtlassianUser' && isAccountId(node.accountId)) {
      byId.set(node.accountId, { accountId: node.accountId, name: String(node.name || node.accountId) });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Jira issue and project keys: capital letters, digits and underscores, and for an issue a dash and a number. A key from the
// graph is only used to build a link inside Jira, so anything else is dropped.
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,9}-[1-9][0-9]{0,8}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,9}$/;
const clip = (text, length) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, length);

// The Jira projects linked to a team, as { key, name, lead } (lead is a name or ''), by name. Confluence spaces are not read
// (the selection names only JiraSpace), so their scope is not needed.
export function parseTeamSpaces(body) {
  const data = dataOrThrow(body);
  const edges = (data.spacesByAtlassianTeam && data.spacesByAtlassianTeam.edges) || [];
  const byKey = new Map();
  for (const edge of edges) {
    const node = edge && edge.node;
    if (node && node.__typename === 'JiraSpace' && PROJECT_KEY.test(String(node.key))) {
      if (!byKey.has(node.key)) byKey.set(node.key, { key: node.key, name: clip(node.name, 80) || node.key, lead: clip(node.lead && node.lead.name, 80) });
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// One page of a person's assigned work: { items, hasNextPage, endCursor }. Each item is { key, summary, dueAt (ISO or ''),
// status, category } where category is Jira's own status category ('new', 'indeterminate', 'done'); one that is not
// known counts as 'new', never as done.
export function parseAssignedWork(body) {
  const data = dataOrThrow(body);
  const connection = data.atlassianUserAssignedJiraWorkItems || {};
  const items = [];
  for (const edge of connection.edges || []) {
    const node = edge && edge.node;
    if (!node || node.__typename !== 'JiraWorkItem' || !ISSUE_KEY.test(String(node.key))) continue;
    const category = node.status && node.status.statusCategory && node.status.statusCategory.key;
    items.push({
      key: node.key,
      summary: clip(node.summary, 120),
      dueAt: typeof node.dueAt === 'string' && !Number.isNaN(Date.parse(node.dueAt)) ? node.dueAt : '',
      status: clip(node.status && node.status.name, 40),
      category: ['new', 'indeterminate', 'done'].includes(category) ? category : 'new',
    });
  }
  const info = connection.pageInfo || {};
  return { items, hasNextPage: info.hasNextPage === true, endCursor: typeof info.endCursor === 'string' ? info.endCursor : '' };
}

export function createTeamGraph({ request }) {
  async function call(query, variables, operationName) {
    const response = await request(query, variables, operationName);
    if (!response.ok) throw new Error(`Teamwork Graph answered ${response.status}`);
    return response.json();
  }

  // Call 1: the teams this person is in.
  async function listTeams(accountId) {
    if (!isAccountId(accountId)) throw new Error('Teamwork Graph needs the signed-in person\'s account id.');
    return parseTeams(await call(MY_TEAMS_QUERY, { userId: userAri(accountId), first: TEAM_PAGE_SIZE }, OPERATIONS.MY_TEAMS));
  }

  // Call 2: the people in one team.
  async function listMembers(teamAri) {
    if (!isTeamAri(teamAri)) throw new Error('That is not a team id.');
    return parseMembers(await call(TEAM_MEMBERS_QUERY, { teamAri, first: MEMBER_PAGE_SIZE }, OPERATIONS.TEAM_MEMBERS));
  }

  // Call 3: the Jira projects linked to one team (with each project's lead).
  async function listTeamSpaces(teamAri) {
    if (!isTeamAri(teamAri)) throw new Error('That is not a team id.');
    return parseTeamSpaces(await call(TEAM_SPACES_QUERY, { teamAri, first: TEAM_SPACES_PAGE_SIZE }, OPERATIONS.TEAM_SPACES));
  }

  // Call 4: the Jira work assigned to one person, as { items, capped }. `capped` means there is more than was read.
  async function listAssignedWork(accountId) {
    if (!isAccountId(accountId)) throw new Error('That is not an account id.');
    const items = [];
    let after = null;
    for (let page = 0; page < MAX_ASSIGNED_WORK_PAGES; page += 1) {
      const body = await call(ASSIGNED_WORK_QUERY, { userId: userAri(accountId), first: ASSIGNED_WORK_PAGE_SIZE, after }, OPERATIONS.ASSIGNED_WORK);
      const parsed = parseAssignedWork(body);
      items.push(...parsed.items);
      if (!parsed.hasNextPage || !parsed.endCursor) return { items, capped: false };
      after = parsed.endCursor;
    }
    return { items, capped: true };
  }

  return { listTeams, listMembers, listTeamSpaces, listAssignedWork };
}
