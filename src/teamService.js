// Teams and assignees, built on READ-ONLY Teamwork Graph data (see teamGraph.js).
//
//   setWardTeam          save "this ward is handled by this team"; the team is checked against the graph
//   wardTeamInfo         for a ward: its team, the team's members, and a suggested assignee
//   whoHandlesWard       the same, shaped as an answer for the Rovo agent / MCP tool
//   wardOwnership        for a ward: its team, the Jira projects the team works in (and their leads), and how much open
//                        Jira work each person has, all read from the graph for the recall drawer
//   assigneesForMatches  suggested assignees for a list of recall matches (balanced across the team)
//   checkExplicitAssignees  keep only assignees the ward's team really contains
//
// THE SUGGESTION RULE. The Teamwork Graph has no team-owner or role field, only a list of members, so
// "who should get this" needs a rule. We suggest the member with the FEWEST OPEN RECALLRADAR TASKS
// (counted in Jira), and break ties by the first name alphabetically. That spreads work evenly and gives
// the same answer every time. It is only ever a suggestion: nobody is assigned without being asked.
//
// `graph` is createTeamGraph(...), `store` is createWardTeamStore(...). No Forge imports.
import { pairKey } from './taskRules.js';
import { wardKey } from './wardTeams.js';

export const SUGGESTION_RULE =
  'the team member with the fewest open RecallRadar tasks, then the first name alphabetically (the Teamwork Graph has no team-owner field)';

// Pick one member. `openCounts` is a Map(accountId -> open task count) from Jira; `planned` is a Map of
// tasks already planned for the same people in this batch, so a batch is spread rather than piled on one person.
export function suggestAssignee(members, openCounts = new Map(), planned = new Map()) {
  if (!members || members.length === 0) return null;
  const load = (m) => (openCounts.get(m.accountId) || 0) + (planned.get(m.accountId) || 0);
  return [...members].sort((a, b) => load(a) - load(b) || a.name.localeCompare(b.name))[0];
}

// How many people of a team are shown with their workload, and how many graph calls run at the same time. A ward's team is
// a handful of people; a bigger one is cut here and says how many more there are.
export const MAX_PEOPLE_SHOWN = 8;
const WORKLOAD_CONCURRENCY = 4;

// map with at most `limit` calls in flight, results in order.
async function mapLimit(list, limit, fn) {
  const results = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await fn(list[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return results;
}

// One person's assigned work (from the graph) as the numbers the drawer shows: how many items are not done, how many of those
// are overdue, and the one to look at next (the earliest due date among those with one, else the first). `capped` means the
// person has more work than was read, so the numbers are "at least".
export function summarizeWork(work, nowMs) {
  const open = work.items.filter((item) => item.category !== 'done');
  const dated = open.filter((item) => item.dueAt).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const next = dated[0] || open[0] || null;
  return {
    openWork: open.length,
    overdue: open.filter((item) => item.dueAt && Date.parse(item.dueAt) < nowMs).length,
    capped: Boolean(work.capped),
    next: next ? { key: next.key, summary: next.summary, dueAt: next.dueAt, status: next.status } : null,
  };
}

// A ward's team, the Jira projects it works in and how busy each person is, read from the graph right now (nothing of it is
// saved). Whatever the graph cannot say is left out and named in `partial`, so the drawer can show the rest:
//   { ward, mapped: false }
//   { ward, mapped: true, team, spaces | null, people: [{ accountId, name, openWork | null, overdue, capped, next }],
//     moreMembers, partial: { spaces, work } }
export async function wardOwnership({ ward, store, graph, now = () => new Date() }) {
  const mapping = await store.get(ward);
  if (!mapping) return { ward, mapped: false };
  const [members, spaces] = await Promise.all([
    graph.listMembers(mapping.teamAri),
    Promise.resolve().then(() => graph.listTeamSpaces(mapping.teamAri)).catch(() => null),
  ]);
  const shown = members.slice(0, MAX_PEOPLE_SHOWN);
  const nowMs = now().getTime();
  const people = await mapLimit(shown, WORKLOAD_CONCURRENCY, async (member) => {
    try {
      return { accountId: member.accountId, name: member.name, ...summarizeWork(await graph.listAssignedWork(member.accountId), nowMs) };
    } catch (error) {
      return { accountId: member.accountId, name: member.name, openWork: null, overdue: 0, capped: false, next: null };
    }
  });
  return {
    ward: mapping.ward,
    mapped: true,
    team: { ari: mapping.teamAri, name: mapping.teamName },
    spaces,
    people,
    moreMembers: members.length - shown.length,
    partial: { spaces: spaces === null, work: people.some((p) => p.openWork === null) },
  };
}

// A ward's team and people, read fresh from the graph.
//   { ward, mapped: false }
//   { ward, mapped: true, team: { ari, name }, members, suggested, rule }
export async function wardTeamInfo({ ward, store, graph, openCounts = new Map() }) {
  const mapping = await store.get(ward);
  if (!mapping) return { ward, mapped: false };
  const members = await graph.listMembers(mapping.teamAri);
  const suggested = suggestAssignee(members, openCounts);
  return {
    ward: mapping.ward,
    mapped: true,
    team: { ari: mapping.teamAri, name: mapping.teamName },
    members,
    suggested: suggested ? { accountId: suggested.accountId, name: suggested.name, openTasks: openCounts.get(suggested.accountId) || 0 } : null,
    rule: SUGGESTION_RULE,
  };
}

// Save a ward-to-team mapping. The browser only sends the team's id: the NAME comes from the graph, and
// the id must be one of the teams the signed-in person can see there, so an invented id cannot be saved.
export async function setWardTeam({ ward, teamAri, accountId, graph, store }) {
  if (teamAri === null || teamAri === '') {
    await store.set(ward, null);
    return { ok: true, ward, removed: true };
  }
  const teams = await graph.listTeams(accountId);
  const team = teams.find((t) => t.ari === teamAri);
  if (!team) return { ok: false, error: 'That team was not found in the Teamwork Graph (it must be a team you belong to).' };
  const saved = await store.set(ward, team);
  return { ok: true, ward: saved.ward, team: { ari: saved.teamAri, name: saved.teamName } };
}

// Suggested assignees for recall matches: pair key -> { accountId, name, teamName, ward }.
// Members are read once per team. Matches whose ward has no team, or whose team has no visible members,
// are listed in `skipped` with the reason.
export async function assigneesForMatches({ matches, store, graph, openCounts = new Map() }) {
  const assignees = new Map();
  const skipped = [];
  const membersByTeam = new Map();
  const planned = new Map();
  for (const match of matches) {
    const pair = pairKey(match.recallNumber, match.deviceId);
    const mapping = match.ward ? await store.get(match.ward) : null;
    if (!mapping) {
      skipped.push({ pair, reason: match.ward ? `ward ${match.ward} has no team yet` : 'no ward recorded' });
      continue;
    }
    if (!membersByTeam.has(mapping.teamAri)) membersByTeam.set(mapping.teamAri, await graph.listMembers(mapping.teamAri));
    const chosen = suggestAssignee(membersByTeam.get(mapping.teamAri), openCounts, planned);
    if (!chosen) {
      skipped.push({ pair, reason: `team ${mapping.teamName} has no members you can see` });
      continue;
    }
    planned.set(chosen.accountId, (planned.get(chosen.accountId) || 0) + 1);
    assignees.set(pair, { accountId: chosen.accountId, name: chosen.name, teamName: mapping.teamName, ward: match.ward });
  }
  return { assignees, skipped };
}

// The person chose an assignee in the panel: keep it only if that person really is in the ward's team
// (checked now, in the graph). Returns Map(pair -> assignee) and the pairs that were refused.
export async function checkExplicitAssignees({ explicit, matches, store, graph }) {
  const assignees = new Map();
  const refused = [];
  const membersByTeam = new Map();
  const byPair = new Map(matches.map((m) => [pairKey(m.recallNumber, m.deviceId), m]));
  for (const [pair, accountId] of Object.entries(explicit || {})) {
    const match = byPair.get(pair);
    const mapping = match && match.ward ? await store.get(match.ward) : null;
    if (!mapping) {
      refused.push(pair);
      continue;
    }
    if (!membersByTeam.has(mapping.teamAri)) membersByTeam.set(mapping.teamAri, await graph.listMembers(mapping.teamAri));
    const member = membersByTeam.get(mapping.teamAri).find((m) => m.accountId === accountId);
    if (!member) {
      refused.push(pair);
      continue;
    }
    assignees.set(pair, { accountId: member.accountId, name: member.name, teamName: mapping.teamName, ward: match.ward });
  }
  return { assignees, refused };
}

// The answer to "who handles this ward?", for the Rovo agent and MCP clients. `mappedWards` is every ward
// that does have a team, so the agent can offer real alternatives instead of guessing.
export async function whoHandlesWard({ ward, store, graph, openCounts = new Map() }) {
  const wanted = typeof ward === 'string' ? ward.trim() : '';
  if (!wanted) return { ok: false, error: 'Give a ward name, for example ICU.' };
  const mappings = await store.list();
  const mappedWards = mappings.map((m) => m.ward);
  const info = await wardTeamInfo({ ward: wanted, store, graph, openCounts });
  const source = 'Teamwork Graph (read-only): team, members, linked Jira projects and open work read live; the ward-to-team mapping is saved in RecallRadar';
  if (!info.mapped) {
    return {
      ok: true,
      ward: wanted,
      mapped: false,
      message: `No team is mapped to ward ${wanted} yet. Ask the user to map it in the RecallRadar panel (Ward teams). Do not guess a team.`,
      mappedWards,
      source,
    };
  }
  // The richer picture (where the team works, who leads that project, how busy each person is). It is extra: when the graph
  // cannot give it (a scope not granted, a hiccup) the answer is the same as before, without it.
  let ownership = null;
  try {
    ownership = await wardOwnership({ ward: wanted, store, graph });
  } catch (error) {
    ownership = null;
  }
  const extra = {};
  if (ownership && ownership.mapped) {
    if (ownership.spaces && ownership.spaces.length) extra.worksIn = ownership.spaces.map((s) => ({ project: s.name, key: s.key, projectLead: s.lead || null }));
    const busy = ownership.people.filter((p) => p.openWork !== null);
    if (busy.length) extra.openWorkPerPerson = busy.map((p) => ({ name: p.name, openJiraWorkItems: p.openWork, overdue: p.overdue, atLeast: p.capped }));
  }
  return {
    ok: true,
    ward: info.ward,
    mapped: true,
    team: info.team,
    members: info.members,
    suggestedAssignee: info.suggested,
    suggestionRule: info.rule,
    ...extra,
    source,
    note: 'Name only the team, projects and people returned here. Assigning anyone requires the user to say yes.',
  };
}

export { wardKey };
