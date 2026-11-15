// READ-ONLY access to the Atlassian Teamwork Graph: which teams a person is in, and who is in a team.
// RecallRadar never writes to the graph.
//
// These are the ONLY two Teamwork Graph calls the app makes (the README lists them too):
//
//   1. atlassianUserInTeams(userId, first)   the teams the signed-in person belongs to
//   2. atlassianTeamMembers(teamAri, first)  the people in one team
//
// Facts learned by probing the live API (docs/teamwork-graph-findings.md):
//   * they work only AS A USER (api.asUser().requestTeamworkGraph); there is no app-level version, so
//     nothing here can run in background code (the daily trigger, the queue consumer);
//   * every request needs an operation name shaped company_operation, in the query text and as the
//     third argument;
//   * the team and member nodes are GraphQL unions, so each needs an inline fragment;
//   * there is no "list every team" query and no team owner or role field, so "the team list" is the
//     teams the current person is in, and a team member is picked by a rule (see teamService.js).
//
// `request(query, variables, operationName)` is requestTeamworkGraph as the user, injected so the
// parsing here is unit tested without Forge. No Forge imports.

// How many teams / members to ask for per call. A hospital's wards are few; this is the API's page size
// and a generous ceiling for one person's teams or one team's members.
export const TEAM_PAGE_SIZE = 50;
export const MEMBER_PAGE_SIZE = 50;

export const OPERATIONS = Object.freeze({
  MY_TEAMS: 'recallradar_myteams',
  TEAM_MEMBERS: 'recallradar_teammembers',
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

  return { listTeams, listMembers };
}
