import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUGGESTION_RULE,
  suggestAssignee,
  wardTeamInfo,
  setWardTeam,
  assigneesForMatches,
  checkExplicitAssignees,
  whoHandlesWard,
  wardOwnership,
  summarizeWork,
  MAX_PEOPLE_SHOWN,
} from './teamService.js';
import { createWardTeamStore } from './wardTeams.js';
import { pairKey } from './taskRules.js';
import { fakeKv } from './fakeKv.mjs';

const T_ICU = 'ari:cloud:identity::team/11111111-aaaa-4bbb-8ccc-111111111111';
const T_ER = 'ari:cloud:identity::team/22222222-aaaa-4bbb-8ccc-222222222222';

const people = {
  [T_ICU]: [
    { accountId: 'aaa111', name: 'Alex Rivera' },
    { accountId: 'bbb222', name: 'Priya Shah' },
    { accountId: 'ccc333', name: 'Sam Lee' },
  ],
  [T_ER]: [{ accountId: 'ddd444', name: 'Dana Cole' }],
};

// A fake graph: the teams the person is in, and each team's members. Counts calls so we can check how often it is read.
function fakeGraph({ teams = [{ ari: T_ICU, name: 'ICU Team' }, { ari: T_ER, name: 'ER Team' }], members = people } = {}) {
  const calls = { listTeams: 0, listMembers: [] };
  return {
    calls,
    async listTeams() {
      calls.listTeams += 1;
      return teams;
    },
    async listMembers(ari) {
      calls.listMembers.push(ari);
      return members[ari] || [];
    },
  };
}

const match = (deviceId, ward, recall = 'Z-1-2026') => ({ deviceId, ward, recallNumber: recall });

async function setup() {
  const store = createWardTeamStore(fakeKv());
  await store.set('ICU', { ari: T_ICU, name: 'ICU Team' });
  await store.set('ER', { ari: T_ER, name: 'ER Team' });
  return { store, graph: fakeGraph() };
}

// --- The suggestion rule -----------------------------------------------------------------------------------------

test('the rule is written down in one place and says why it exists', () => {
  assert.match(SUGGESTION_RULE, /fewest open RecallRadar tasks/);
  assert.match(SUGGESTION_RULE, /first name alphabetically/);
  assert.match(SUGGESTION_RULE, /no team-owner field/);
});

test('suggestAssignee picks the member with the fewest open tasks', () => {
  const counts = new Map([['aaa111', 3], ['bbb222', 1], ['ccc333', 2]]);
  assert.equal(suggestAssignee(people[T_ICU], counts).accountId, 'bbb222');
});

test('a member with no open tasks beats everyone with some', () => {
  assert.equal(suggestAssignee(people[T_ICU], new Map([['aaa111', 1], ['bbb222', 1]])).accountId, 'ccc333');
});

test('ties go to the first name alphabetically, so the answer is always the same', () => {
  assert.equal(suggestAssignee(people[T_ICU], new Map()).name, 'Alex Rivera');
  assert.equal(suggestAssignee([...people[T_ICU]].reverse(), new Map()).name, 'Alex Rivera');
});

test('tasks already planned in the same batch count too, so a batch is spread out', () => {
  const planned = new Map([['aaa111', 1]]);
  assert.equal(suggestAssignee(people[T_ICU], new Map(), planned).name, 'Priya Shah');
});

test('suggestAssignee of an empty team is null, and does not change its input', () => {
  assert.equal(suggestAssignee([], new Map()), null);
  assert.equal(suggestAssignee(undefined), null);
  const list = [...people[T_ICU]].reverse();
  const before = list.map((m) => m.name);
  suggestAssignee(list);
  assert.deepEqual(list.map((m) => m.name), before);
});

// --- Ward team info ------------------------------------------------------------------------------------------------

test('a ward with no team is reported as not mapped, without reading the graph', async () => {
  const { store, graph } = await setup();
  const out = await wardTeamInfo({ ward: 'Pediatrics', store, graph });
  assert.deepEqual(out, { ward: 'Pediatrics', mapped: false });
  assert.equal(graph.calls.listMembers.length, 0);
});

test('a mapped ward gives its team, its members and a suggested assignee', async () => {
  const { store, graph } = await setup();
  const out = await wardTeamInfo({ ward: 'icu', store, graph, openCounts: new Map([['aaa111', 2]]) });
  assert.equal(out.mapped, true);
  assert.deepEqual(out.team, { ari: T_ICU, name: 'ICU Team' });
  assert.equal(out.members.length, 3);
  assert.deepEqual(out.suggested, { accountId: 'bbb222', name: 'Priya Shah', openTasks: 0 });
  assert.equal(out.rule, SUGGESTION_RULE);
});

test('a team whose members cannot be seen has no suggestion', async () => {
  const store = createWardTeamStore(fakeKv());
  await store.set('ICU', { ari: T_ICU, name: 'ICU Team' });
  const out = await wardTeamInfo({ ward: 'ICU', store, graph: fakeGraph({ members: {} }) });
  assert.equal(out.mapped, true);
  assert.equal(out.suggested, null);
});

// --- Saving a mapping ---------------------------------------------------------------------------------------------

test('saving a mapping takes the team NAME from the graph, not from the browser', async () => {
  const store = createWardTeamStore(fakeKv());
  const out = await setWardTeam({ ward: 'ICU', teamAri: T_ICU, accountId: 'me123', graph: fakeGraph(), store });
  assert.deepEqual(out, { ok: true, ward: 'ICU', team: { ari: T_ICU, name: 'ICU Team' } });
  assert.equal((await store.get('ICU')).teamName, 'ICU Team');
});

test('a team that is not in the graph for this person cannot be saved', async () => {
  const store = createWardTeamStore(fakeKv());
  const forged = 'ari:cloud:identity::team/00000000-0000-0000-0000-000000000000';
  const out = await setWardTeam({ ward: 'ICU', teamAri: forged, accountId: 'me123', graph: fakeGraph(), store });
  assert.equal(out.ok, false);
  assert.match(out.error, /not found in the Teamwork Graph/);
  assert.deepEqual(await store.list(), []);
});

test('an empty team id removes the mapping', async () => {
  const { store } = await setup();
  assert.deepEqual(await setWardTeam({ ward: 'ICU', teamAri: null, accountId: 'x', graph: fakeGraph(), store }), { ok: true, ward: 'ICU', removed: true });
  assert.equal(await store.get('ICU'), null);
  assert.equal((await setWardTeam({ ward: 'ER', teamAri: '', accountId: 'x', graph: fakeGraph(), store })).removed, true);
});

// --- Suggested assignees for matches -------------------------------------------------------------------------------

test('each match gets a suggestion from its ward\'s team', async () => {
  const { store, graph } = await setup();
  const { assignees, skipped } = await assigneesForMatches({ matches: [match('d1', 'ICU'), match('d2', 'ER')], store, graph });
  assert.deepEqual(assignees.get(pairKey('Z-1-2026', 'd1')), { accountId: 'aaa111', name: 'Alex Rivera', teamName: 'ICU Team', ward: 'ICU' });
  assert.equal(assignees.get(pairKey('Z-1-2026', 'd2')).name, 'Dana Cole');
  assert.deepEqual(skipped, []);
});

test('a batch for one ward is spread across the team, not piled on one person', async () => {
  const { store, graph } = await setup();
  const matches = ['d1', 'd2', 'd3', 'd4'].map((d) => match(d, 'ICU'));
  const { assignees } = await assigneesForMatches({ matches, store, graph });
  assert.deepEqual([...assignees.values()].map((a) => a.name), ['Alex Rivera', 'Priya Shah', 'Sam Lee', 'Alex Rivera']);
});

test('existing open tasks shift the batch toward people with less work', async () => {
  const { store, graph } = await setup();
  const { assignees } = await assigneesForMatches({ matches: [match('d1', 'ICU')], store, graph, openCounts: new Map([['aaa111', 5], ['bbb222', 5]]) });
  assert.equal(assignees.get(pairKey('Z-1-2026', 'd1')).name, 'Sam Lee');
});

test('a team is read once even if many matches use it', async () => {
  const { store, graph } = await setup();
  await assigneesForMatches({ matches: ['d1', 'd2', 'd3'].map((d) => match(d, 'ICU')), store, graph });
  assert.equal(graph.calls.listMembers.length, 1);
});

test('a ward with no team, or no ward, is skipped with the reason', async () => {
  const { store, graph } = await setup();
  const { assignees, skipped } = await assigneesForMatches({ matches: [match('d1', 'Pediatrics'), match('d2', '')], store, graph });
  assert.equal(assignees.size, 0);
  assert.deepEqual(skipped.map((s) => s.reason), ['ward Pediatrics has no team yet', 'no ward recorded']);
});

test('a team with no visible members is skipped', async () => {
  const store = createWardTeamStore(fakeKv());
  await store.set('ICU', { ari: T_ICU, name: 'ICU Team' });
  const { skipped } = await assigneesForMatches({ matches: [match('d1', 'ICU')], store, graph: fakeGraph({ members: {} }) });
  assert.match(skipped[0].reason, /ICU Team has no members you can see/);
});

// --- Assignees the person chose ----------------------------------------------------------------------------------

test('a chosen assignee who is in the ward\'s team is accepted', async () => {
  const { store, graph } = await setup();
  const { assignees, refused } = await checkExplicitAssignees({ explicit: { [pairKey('Z-1-2026', 'd1')]: 'bbb222' }, matches: [match('d1', 'ICU')], store, graph });
  assert.equal(assignees.get(pairKey('Z-1-2026', 'd1')).name, 'Priya Shah');
  assert.deepEqual(refused, []);
});

test('someone who is NOT in the ward\'s team is refused (a forged request cannot assign anyone)', async () => {
  const { store, graph } = await setup();
  const out = await checkExplicitAssignees({ explicit: { [pairKey('Z-1-2026', 'd1')]: 'ddd444' }, matches: [match('d1', 'ICU')], store, graph });
  assert.equal(out.assignees.size, 0);
  assert.deepEqual(out.refused, [pairKey('Z-1-2026', 'd1')]);
});

test('a pair that is not among the matches, or has no team, is refused', async () => {
  const { store, graph } = await setup();
  const out = await checkExplicitAssignees({
    explicit: { [pairKey('Z-9-2026', 'dX')]: 'aaa111', [pairKey('Z-1-2026', 'd2')]: 'aaa111' },
    matches: [match('d2', 'Pediatrics')],
    store,
    graph,
  });
  assert.equal(out.assignees.size, 0);
  assert.equal(out.refused.length, 2);
});

test('no chosen assignees is fine', async () => {
  const { store, graph } = await setup();
  const out = await checkExplicitAssignees({ explicit: undefined, matches: [], store, graph });
  assert.equal(out.assignees.size, 0);
  assert.deepEqual(out.refused, []);
});

// --- who_handles_ward ----------------------------------------------------------------------------------------------

test('who handles a ward: needs a ward name', async () => {
  const { store, graph } = await setup();
  assert.match((await whoHandlesWard({ ward: '', store, graph })).error, /Give a ward name/);
  assert.match((await whoHandlesWard({ ward: undefined, store, graph })).error, /Give a ward name/);
});

test('who handles a mapped ward: the team, members and suggestion, with the source and the rule', async () => {
  const { store, graph } = await setup();
  const out = await whoHandlesWard({ ward: 'ICU', store, graph });
  assert.equal(out.mapped, true);
  assert.deepEqual(out.team, { ari: T_ICU, name: 'ICU Team' });
  assert.deepEqual(out.members.map((m) => m.name), ['Alex Rivera', 'Priya Shah', 'Sam Lee']);
  assert.equal(out.suggestedAssignee.name, 'Alex Rivera');
  assert.equal(out.suggestionRule, SUGGESTION_RULE);
  assert.match(out.source, /Teamwork Graph/);
  assert.match(out.note, /requires the user to say yes/);
});

test('who handles an unmapped ward: says so, never guesses, and lists the wards that do have a team', async () => {
  const { store, graph } = await setup();
  const out = await whoHandlesWard({ ward: 'Pediatrics', store, graph });
  assert.equal(out.mapped, false);
  assert.match(out.message, /Do not guess a team/);
  assert.deepEqual(out.mappedWards, ['ER', 'ICU']);
  assert.equal(out.team, undefined);
});

// --- who owns the ward: projects, leads and workload from the graph ---------------------------------------------------

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const item = (key, extra = {}) => ({ key, summary: `Work ${key}`, dueAt: '', status: 'To Do', category: 'new', ...extra });

// The fake graph plus the two new reads: each person's assigned work, and a team's projects.
function ownershipGraph({ work = {}, spaces = [{ key: 'BIOMED', name: 'Biomedical Engineering', lead: 'Hana Sato' }], spacesError = null, workErrors = [] } = {}) {
  const graph = fakeGraph();
  graph.calls.work = [];
  graph.listTeamSpaces = async () => { if (spacesError) throw spacesError; return spaces; };
  graph.listAssignedWork = async (accountId) => {
    graph.calls.work.push(accountId);
    if (workErrors.includes(accountId)) throw new Error('Teamwork Graph: User is not permitted to query this organization');
    return work[accountId] || { items: [], capped: false };
  };
  return graph;
}

test('summarizeWork counts what is not done, what is overdue, and picks the item to look at next', () => {
  const out = summarizeWork({ capped: false, items: [
    item('A-1', { category: 'done', dueAt: '2026-11-01T00:00:00.000Z' }),
    item('A-2', { dueAt: '2026-11-25T00:00:00.000Z' }),
    item('A-3', { dueAt: '2026-11-10T00:00:00.000Z', category: 'indeterminate', status: 'In Progress' }),
    item('A-4'),
  ] }, NOW);
  assert.deepEqual(out, { openWork: 3, overdue: 1, capped: false, next: { key: 'A-3', summary: 'Work A-3', dueAt: '2026-11-10T00:00:00.000Z', status: 'In Progress' } });
  assert.equal(summarizeWork({ items: [item('A-5'), item('A-6')], capped: true }, NOW).next.key, 'A-5', 'with no due dates the first open item');
  assert.deepEqual(summarizeWork({ items: [], capped: false }, NOW), { openWork: 0, overdue: 0, capped: false, next: null });
  assert.equal(summarizeWork({ items: [item('A-7', { category: 'done' })], capped: false }, NOW).next, null, 'done work is never "next"');
});

test('wardOwnership: the team, its projects with their lead, and each person\'s open work', async () => {
  const { store } = await setup();
  const graph = ownershipGraph({ work: { aaa111: { items: [item('A-1'), item('A-2', { category: 'done' })], capped: false }, bbb222: { items: [item('B-1', { dueAt: '2026-11-01T00:00:00.000Z' })], capped: true } } });
  const out = await wardOwnership({ ward: 'ICU', store, graph, now: () => new Date(NOW) });
  assert.equal(out.mapped, true);
  assert.deepEqual(out.team, { ari: T_ICU, name: 'ICU Team' });
  assert.deepEqual(out.spaces, [{ key: 'BIOMED', name: 'Biomedical Engineering', lead: 'Hana Sato' }]);
  assert.deepEqual(out.people.map((p) => [p.name, p.openWork, p.overdue, p.capped]), [['Alex Rivera', 1, 0, false], ['Priya Shah', 1, 1, true], ['Sam Lee', 0, 0, false]]);
  assert.deepEqual(out.partial, { spaces: false, work: false });
  assert.equal(out.moreMembers, 0);
});

test('wardOwnership: a ward with no team says so, and nothing is read from the graph', async () => {
  const { store } = await setup();
  const graph = ownershipGraph();
  assert.deepEqual(await wardOwnership({ ward: 'Cath Lab', store, graph }), { ward: 'Cath Lab', mapped: false });
  assert.deepEqual(graph.calls.listMembers, []);
  assert.deepEqual(graph.calls.work, []);
});

test('wardOwnership shows what it can: no projects (scope or hiccup) and one person whose work cannot be read are named in "partial"', async () => {
  const { store } = await setup();
  const graph = ownershipGraph({ spacesError: new Error('boom'), workErrors: ['bbb222'], work: { aaa111: { items: [item('A-1')], capped: false } } });
  const out = await wardOwnership({ ward: 'ICU', store, graph, now: () => new Date(NOW) });
  assert.equal(out.spaces, null);
  assert.deepEqual(out.partial, { spaces: true, work: true });
  assert.deepEqual(out.people.map((p) => [p.name, p.openWork]), [['Alex Rivera', 1], ['Priya Shah', null], ['Sam Lee', 0]]);
  assert.equal(out.mapped, true);
});

test('wardOwnership: an old graph without the new reads still answers with the people (no projects, no work)', async () => {
  const { store, graph } = await setup(); // the fake graph of the other tests has only listTeams and listMembers
  const out = await wardOwnership({ ward: 'ICU', store, graph });
  assert.equal(out.spaces, null);
  assert.ok(out.people.every((p) => p.openWork === null));
});

test('wardOwnership reads at most MAX_PEOPLE_SHOWN people, a few at a time, and counts the rest', async () => {
  const store = createWardTeamStore(fakeKv());
  await store.set('ICU', { ari: T_ICU, name: 'ICU Team' });
  const many = Array.from({ length: MAX_PEOPLE_SHOWN + 5 }, (_, i) => ({ accountId: `acc${String(i).padStart(3, '0')}`, name: `Person ${String(i).padStart(2, '0')}` }));
  const graph = ownershipGraph();
  graph.listMembers = async () => many;
  let inFlight = 0;
  let peak = 0;
  const original = graph.listAssignedWork;
  graph.listAssignedWork = async (id) => { inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return original(id); };
  const out = await wardOwnership({ ward: 'ICU', store, graph });
  assert.equal(out.people.length, MAX_PEOPLE_SHOWN);
  assert.equal(out.moreMembers, 5);
  assert.ok(peak <= 4 && peak > 1, `at most four graph calls at a time, saw ${peak}`);
});

test('whoHandlesWard adds where the team works and each person\'s open work when the graph can say, and is unchanged when it cannot', async () => {
  const { store } = await setup();
  const rich = await whoHandlesWard({ ward: 'ICU', store, graph: ownershipGraph({ work: { aaa111: { items: [item('A-1'), item('A-2')], capped: false } } }) });
  assert.deepEqual(rich.worksIn, [{ project: 'Biomedical Engineering', key: 'BIOMED', projectLead: 'Hana Sato' }]);
  assert.deepEqual(rich.openWorkPerPerson[0], { name: 'Alex Rivera', openJiraWorkItems: 2, overdue: 0, atLeast: false });
  assert.match(rich.note, /Name only the team, projects and people returned here/);
  const plain = await whoHandlesWard({ ward: 'ICU', store, graph: fakeGraph() });
  assert.equal(plain.ok, true);
  assert.equal(plain.worksIn, undefined);
  assert.equal(plain.openWorkPerPerson, undefined);
  assert.equal(plain.team.name, 'ICU Team');
});
