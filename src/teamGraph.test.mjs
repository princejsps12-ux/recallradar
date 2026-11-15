import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEAM_PAGE_SIZE,
  MEMBER_PAGE_SIZE,
  OPERATIONS,
  MY_TEAMS_QUERY,
  TEAM_MEMBERS_QUERY,
  isAccountId,
  isTeamAri,
  userAri,
  parseTeams,
  parseMembers,
  createTeamGraph,
} from './teamGraph.js';

const T1 = 'ari:cloud:identity::team/11111111-aaaa-4bbb-8ccc-111111111111';
const T2 = 'ari:cloud:identity::team/22222222-aaaa-4bbb-8ccc-222222222222';

const teamsBody = (nodes) => ({ data: { atlassianUserInTeams: { edges: nodes.map((node) => ({ node })) } } });
const membersBody = (nodes) => ({ data: { atlassianTeamMembers: { edges: nodes.map((node) => ({ node })) } } });

test('the two operation names have the company_operation shape the API demands', () => {
  for (const name of Object.values(OPERATIONS)) assert.match(name, /^[a-z]{3,}_[a-z]{4,}$/);
});

test('each query text carries its own operation name and uses variables, never pasted values', () => {
  assert.ok(MY_TEAMS_QUERY.startsWith(`query ${OPERATIONS.MY_TEAMS}(`));
  assert.ok(TEAM_MEMBERS_QUERY.startsWith(`query ${OPERATIONS.TEAM_MEMBERS}(`));
  assert.match(MY_TEAMS_QUERY, /\$userId: ID!/);
  assert.match(TEAM_MEMBERS_QUERY, /\$teamAri: ID!/);
  assert.ok(!MY_TEAMS_QUERY.includes('ari:cloud'));
});

test('the queries use fragments because the nodes are unions', () => {
  assert.match(MY_TEAMS_QUERY, /\.\.\. on AtlassianTeam/);
  assert.match(TEAM_MEMBERS_QUERY, /\.\.\. on AtlassianUser/);
});

test('account id and team id checks', () => {
  assert.equal(isAccountId('712020:11111111-2222-4333-8444-555555555555'), true);
  assert.equal(isAccountId('5b10ac8d82e05b22cc7d4ef5'), true);
  for (const bad of ['', 'a', 'x y', '"; drop', undefined, 5]) assert.equal(isAccountId(bad), false, String(bad));
  assert.equal(isTeamAri(T1), true);
  for (const bad of ['team', 'ari:cloud:identity::user/abc', `${T1}"`, '', undefined]) assert.equal(isTeamAri(bad), false, String(bad));
  assert.equal(userAri('abc123'), 'ari:cloud:identity::user/abc123');
});

test('parseTeams returns teams sorted by name, without duplicates', () => {
  const teams = parseTeams(
    teamsBody([
      { __typename: 'AtlassianTeam', id: T2, displayName: 'Team Echo' },
      { __typename: 'AtlassianTeam', id: T1, displayName: 'ICU Team' },
      { __typename: 'AtlassianTeam', id: T1, displayName: 'ICU Team' },
    ]),
  );
  assert.deepEqual(teams, [{ ari: T1, name: 'ICU Team' }, { ari: T2, name: 'Team Echo' }]);
});

test('parseTeams skips nodes that are not teams or have no usable id or name', () => {
  assert.deepEqual(
    parseTeams(teamsBody([{ __typename: 'QueryError' }, { __typename: 'AtlassianTeam', id: 'nope', displayName: 'X' }, { __typename: 'AtlassianTeam', id: T1, displayName: '' }, null])),
    [],
  );
});

test('parseTeams of nothing is an empty list', () => {
  assert.deepEqual(parseTeams({ data: { atlassianUserInTeams: null } }), []);
  assert.deepEqual(parseTeams(teamsBody([])), []);
});

test('a GraphQL error (the API still answers HTTP 200) is thrown as an Error', () => {
  assert.throws(() => parseTeams({ errors: [{ message: 'You must set an operation name' }] }), /You must set an operation name/);
  assert.throws(() => parseMembers({ errors: [{ message: 'bad' }] }), /Teamwork Graph: bad/);
  assert.throws(() => parseTeams(undefined), /no data/);
  assert.throws(() => parseTeams({}), /no data/);
});

test('parseMembers returns people sorted by name with their account ids', () => {
  const members = parseMembers(
    membersBody([
      { __typename: 'AtlassianUser', accountId: 'bbb222', name: 'Priya Shah' },
      { __typename: 'AtlassianUser', accountId: 'aaa111', name: 'Alex Rivera' },
      { __typename: 'AtlassianUser', accountId: 'aaa111', name: 'Alex Rivera' },
    ]),
  );
  assert.deepEqual(members, [{ accountId: 'aaa111', name: 'Alex Rivera' }, { accountId: 'bbb222', name: 'Priya Shah' }]);
});

test('parseMembers skips non-users and falls back to the account id when a name is missing', () => {
  const members = parseMembers(membersBody([{ __typename: 'Other' }, { __typename: 'AtlassianUser', accountId: 'ccc333' }, { __typename: 'AtlassianUser', accountId: 'bad id' }]));
  assert.deepEqual(members, [{ accountId: 'ccc333', name: 'ccc333' }]);
});

// --- the client ---------------------------------------------------------------------------------------------------

function fakeRequest(answers) {
  const calls = [];
  const request = async (query, variables, operationName) => {
    calls.push({ query, variables, operationName });
    const a = answers.shift();
    return { ok: a.status === undefined || a.status < 300, status: a.status ?? 200, json: async () => a.json };
  };
  return { request, calls };
}

test('listTeams makes call 1 with the user ARI as a variable and the operation name', async () => {
  const { request, calls } = fakeRequest([{ json: teamsBody([{ __typename: 'AtlassianTeam', id: T1, displayName: 'ICU Team' }]) }]);
  const teams = await createTeamGraph({ request }).listTeams('712020:abc');
  assert.deepEqual(teams, [{ ari: T1, name: 'ICU Team' }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, MY_TEAMS_QUERY);
  assert.deepEqual(calls[0].variables, { userId: 'ari:cloud:identity::user/712020:abc', first: TEAM_PAGE_SIZE });
  assert.equal(calls[0].operationName, OPERATIONS.MY_TEAMS);
});

test('listMembers makes call 2 with the team ARI as a variable and the operation name', async () => {
  const { request, calls } = fakeRequest([{ json: membersBody([{ __typename: 'AtlassianUser', accountId: 'aaa111', name: 'Alex Rivera' }]) }]);
  const members = await createTeamGraph({ request }).listMembers(T1);
  assert.deepEqual(members, [{ accountId: 'aaa111', name: 'Alex Rivera' }]);
  assert.equal(calls[0].query, TEAM_MEMBERS_QUERY);
  assert.deepEqual(calls[0].variables, { teamAri: T1, first: MEMBER_PAGE_SIZE });
  assert.equal(calls[0].operationName, OPERATIONS.TEAM_MEMBERS);
});

test('bad inputs are refused before any request is made', async () => {
  const { request, calls } = fakeRequest([]);
  const graph = createTeamGraph({ request });
  await assert.rejects(graph.listTeams('"; bad'), /account id/);
  await assert.rejects(graph.listTeams(undefined), /account id/);
  await assert.rejects(graph.listMembers('not-an-ari'), /not a team id/);
  assert.equal(calls.length, 0);
});

test('an HTTP error status is thrown', async () => {
  const { request } = fakeRequest([{ status: 503, json: {} }]);
  await assert.rejects(createTeamGraph({ request }).listTeams('abc123'), /answered 503/);
});

test('a GraphQL error in an HTTP 200 answer is thrown too', async () => {
  const { request } = fakeRequest([{ json: { errors: [{ message: 'Field undefined' }] } }]);
  await assert.rejects(createTeamGraph({ request }).listMembers(T1), /Field undefined/);
});
