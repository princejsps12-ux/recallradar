# Teamwork Graph (read-only), in detail

The summary is in the [README](../README.md#teamwork-graph-read-only). The two queries below are exactly the ones in [`src/teamGraph.js`](../src/teamGraph.js): if one changes, change this page.

RecallRadar **only reads** from the Atlassian Teamwork Graph. It never writes to it (no mutations, no connection, no ingestion). It is used for one job: finding out **which team handles a ward and who is in that team**, so a recall task can go to the right people.

## Exactly which Teamwork Graph API calls are made

Both go through `api.asUser().requestTeamworkGraph(query, variables, operationName)` from `@forge/api`, **as the signed-in person** (the API has no app-level version, so nothing in the graph is read by background jobs). Every value is passed as a GraphQL variable, never pasted into the query text. The code is in [`src/teamGraph.js`](../src/teamGraph.js); the two documents below are copied from it.

**Call 1: the teams the signed-in person belongs to** (operation `recallradar_myteams`)

```graphql
query recallradar_myteams($userId: ID!, $first: Int) {
  atlassianUserInTeams(userId: $userId, first: $first) {
    edges { node { __typename ... on AtlassianTeam { id displayName } } }
  }
}
```

Variables: `userId` = `ari:cloud:identity::user/<the signed-in person's account id>`, `first` = 25. Runs when you open the dashboard's **Ward teams** tab (to fill the team dropdown) and when a ward-to-team choice is saved (the server checks that the team really is in this list, and takes the team's **name from the graph**, not from the browser).

**Call 2: the members of one team** (operation `recallradar_teammembers`)

```graphql
query recallradar_teammembers($teamAri: ID!, $first: Int) {
  atlassianTeamMembers(teamAri: $teamAri, first: $first) {
    edges { node { __typename ... on AtlassianUser { accountId name } } }
  }
}
```

Variables: `teamAri` = a saved team's ARI (`ari:cloud:identity::team/<id>`), `first` = 25. Runs when the panel suggests an assignee, when a chosen assignee is checked before creating tasks, and when the agent or an MCP client asks `who_handles_ward`. A team is read once per request, however many tasks use it.

That is all: **two read queries**. Scopes: `read:graph:team:atlassian` and `read:graph:user:atlassian`.

What the API does **not** offer (found by probing it, see [`docs/teamwork-graph-findings.md`](teamwork-graph-findings.md)): there is no "list every team" query, so the dropdown shows the teams **you** belong to; and teams have **no owner, manager or role field**, only members. So RecallRadar cannot say "the team's owner" and uses a stated rule instead.

## What is stored, and where it shows

- **Ward-to-team mapping**: one record in Forge storage (`ward-teams`): ward name, team ARI and team name. Edited on the dashboard's **Ward teams** tab. Wards are compared ignoring case and punctuation ("med surg 3w" is "Med-Surg 3W").
- **In the panel**: every exact or likely match whose ward has a team shows **Team: <name> (from Teamwork Graph)**, so the graph's use is visible, plus the suggested assignee.
- **In the agent and MCP**: the `who_handles_ward` tool (below) returns the team, its members and the suggestion, marked `source: Teamwork Graph`.

## Suggesting an assignee, and asking first

The rule (written once, in `SUGGESTION_RULE` in [`src/teamService.js`](../src/teamService.js), and returned to the agent): **the team member with the fewest open RecallRadar tasks** (counted in Jira with `labels = "recallradar" AND statusCategory != Done`), **then the first name alphabetically**. That spreads work evenly and gives the same answer every time. In a batch, people already picked earlier in the same batch count too, so ten tasks for one ward are spread across the team instead of piled on one person.

**Nobody is assigned without being asked.**

- **Drawer, one task**: **Create task** (unassigned) or, in the small menu beside it, **Create and assign to <name>**.
- **Panel, all tasks**: a checkbox in the confirmation, off by default.
- **Agent**: assigning is only proposed when you ask for it (`assignSuggested`); the preview shows each **proposedAssignee**. The preview record stores **no person** (no account id, no name), only the flag: when you confirm, the people are **looked up again** from the ward's team with the same rule and the answer says who was assigned. The rule is deterministic, so you normally get the people you saw, unless the team or the open-task counts changed in between.
- **Checked on the server**: the panel names an account id only for the one click, and the server re-reads the ward's team and keeps the assignee only if that person is **in the team**. The agent's confirm step looks people up fresh, so it can only ever pick **current** members. A made-up request cannot assign anyone else. If the graph cannot be reached, tasks are created **unassigned** and the answer says so.
- A ward with no team, or a team with no members you can see, simply gets no suggestion.

## What was and was not verified

- **Verified against the live API** (earlier probe on the demo site): both queries return data in exactly the shape the code parses (20 teams for the demo user; members with account ids and names).
- **Verified in unit tests** with a fake graph: query text, variables, parsing, the suggestion rule, balancing across a team, refusing someone who is not in the team, and the agent's preview-then-confirm with assignees.
- **Verified live on the demo site** (panel and agent): the team list loads from the graph; ICU and Cath Lab were mapped to a team and the choice is saved ("1 of 14 wards mapped"); the Cath Lab row shows **Team: Team Atlas (from Teamwork Graph)**; the "create all" confirmation offers **Also assign the suggested team member (7 of 29)**, unchecked by default; the agent's `who_handles_ward` says "no team" for an unmapped ward without guessing. The live check found one real bug: the API refuses `first` above 25, so both calls now ask for 25.
- **Verified live, Confluence button**: choosing Mobile Development and recall Z-0208-2027 updated the existing page and returned its link.
- **Verified live, assignments**: on an ICU row the drawer showed *Team: Team Atlas (from Teamwork Graph) · Suggested assignee: the suggested person*; **Create and assign to …** made MOBL-99 assigned to that person. **Create all N tasks…** with **Also assign the suggested team member** ticked created 28 tasks and assigned the 8 whose ward has a team ("8 of 28" was shown before confirming); the rest were left unassigned, as intended.

## Limits

- Only people and teams the **signed-in person** can see in the graph are shown (the calls run as them).
- A person who is in the team but cannot be assigned in the Jira project makes Jira refuse that task; it is reported as failed with Jira's reason and can be retried unassigned.
- Only the first 25 teams and 25 members are read (the API refuses a larger page).
