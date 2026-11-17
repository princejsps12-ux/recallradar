# Teamwork Graph (read-only), in detail

The summary is in the [README](../README.md#teamwork-graph-read-only). The four queries below are exactly the ones in [`src/teamGraph.js`](../src/teamGraph.js): if one changes, change this page.

RecallRadar **only reads** from the Atlassian Teamwork Graph. It never writes to it (no mutations, no connection, no ingestion). It is used for two jobs: finding out **which team handles a ward and who is in that team** (so a recall task can go to the right people), and showing **who owns the ward and how busy they are** (where the team works, who leads that project, each person's open Jira work) in the recall drawer and in the Rovo agent's answer.

## Exactly which Teamwork Graph API calls are made

All four go through `api.asUser().requestTeamworkGraph(query, variables, operationName)` from `@forge/api`, **as the signed-in person** (the API has no app-level version, so nothing in the graph is read by background jobs). Every value is passed as a GraphQL variable, never pasted into the query text. The code is in [`src/teamGraph.js`](../src/teamGraph.js); the two documents below are copied from it.

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

**Call 3: the Jira projects linked to one team** (operation `recallradar_teamspaces`)

```graphql
query recallradar_teamspaces($teamAri: ID!, $first: Int) {
  spacesByAtlassianTeam(teamAri: $teamAri, first: $first) {
    edges { node { __typename ... on JiraSpace { key name lead { name } } } }
  }
}
```

Variables: `teamAri` as above, `first` = 10. Only **Jira** projects are selected (`... on JiraSpace`), so no Confluence scope is needed. A Jira project has a **lead**, which is the one "owner" signal the graph offers for a ward: the team itself has none. Runs when someone opens the drawer's **Who handles this ward** card, and when the agent or an MCP client asks `who_handles_ward`.

**Call 4: the Jira work assigned to one person** (operation `recallradar_assignedwork`)

```graphql
query recallradar_assignedwork($userId: ID!, $first: Int, $after: String) {
  atlassianUserAssignedJiraWorkItems(userId: $userId, first: $first, after: $after) {
    edges { node { __typename ... on JiraWorkItem { key summary dueAt status { name statusCategory { key } } } } }
    pageInfo { hasNextPage endCursor }
  }
}
```

Variables: `userId` = `ari:cloud:identity::user/<account id of a team member>`, `first` = 25, `after` = the previous page's cursor. At most **two pages** (50 items) are read per person; a person with more shows "12+ open" instead of an exact count. "Open" means Jira's own status category is not *done* (a status with no known category counts as open). One call per shown member (at most 8 members, four at a time), when the card is opened.

That is all: **four read queries**. Scopes: `read:graph:team:atlassian` and `read:graph:user:atlassian` (calls 1 and 2, and the lead's name), plus `read:graph:project:jira` (call 3) and `read:graph:issue:jira` (call 4). The graph does **not** report a missing scope as an error: the rows are simply left out, so an empty answer can mean "nothing there" or "scope not granted", and the card says what it could not read instead of showing zero.

What the API does **not** offer (found by probing it, see [`docs/teamwork-graph-findings.md`](teamwork-graph-findings.md)): there is no "list every team" query, so the dropdown shows the teams **you** belong to; and teams have **no owner, manager or role field**, only members. So RecallRadar cannot say "the team's owner" and uses the linked project's lead and a stated suggestion rule instead. There is also no team-to-work query for new apps (raw Cypher is closed to them), which is why the work is read per person.

## Who handles this ward (the drawer card)

The recall drawer has a collapsed card, **Who handles this ward**. Opened, it asks the graph (calls 2, 3 and 4) and shows the team, **Works in <project> · led by <name>**, and each person with their open work: "3 open, 1 overdue", and the next item to look at (the earliest due date among their open work, with its key as a link). Rules:

- **Read when opened, shown, never saved.** The card keeps the answer in the page's memory while it is open so closing and reopening does not ask again; a reload asks again. Nothing about a person or their work is written to storage, in line with "no personal data in storage".
- **It says what it could not read.** No project linked, a project the graph would not return, or one person whose work could not be read are each named; a missing number is never shown as zero.
- **The person the "Create and assign" button would name is marked** *Suggested for new tasks*, so the suggestion and the picture agree. The suggestion rule itself did not change (see below): it stays cheap and deterministic because it runs for every task on every dashboard load, while the card reads the work on demand.
- **Permissions are the person's own.** The graph returns only what the signed-in person may see, so someone who cannot browse a project sees fewer items for a colleague. The card shows what *you* can see.

## What is stored, and where it shows

- **Ward-to-team mapping**: one record in Forge storage (`ward-teams`): ward name, team ARI and team name. Edited on the dashboard's **Ward teams** tab. Wards are compared ignoring case and punctuation ("med surg 3w" is "Med-Surg 3W").
- **In the panel**: every exact or likely match whose ward has a team shows **Team: <name> (from Teamwork Graph)**, so the graph's use is visible, plus the suggested assignee.
- **In the agent and MCP**: the `who_handles_ward` tool (below) returns the team, its members, where the team works (`worksIn`: project, key, lead), each person's open work (`openWorkPerPerson`) and the suggestion, marked `source: Teamwork Graph`. The two new parts are left out when the graph cannot give them.

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

- **The four calls were not all verified live at the time of writing**: the first two were (above). Calls 3 and 4 were checked against the live GraphQL schema of the demo site (the fields, their types and the scopes the docs name for them) and in unit tests with a fake graph; the live result is recorded in the [README](../README.md#connect-other-agents-mcp) under "What was and was not verified" once it was run, and where that says nothing it was not.

## Limits

- Only people and teams the **signed-in person** can see in the graph are shown (the calls run as them).
- A person who is in the team but cannot be assigned in the Jira project makes Jira refuse that task; it is reported as failed with Jira's reason and can be retried unassigned.
- Only the first 25 teams and 25 members are read (the API refuses a larger page). The card shows at most 8 members and says how many more there are.
- A person's work is read for at most 50 items; more shows as "N+". Done items are part of those 50, so a person with a long history can show fewer open items than they have.
- The Teamwork Graph API is in Forge's **Preview** phase: its schema may change before general availability (Atlassian promises a month's notice for breaking changes), and its scopes are the per-object ones (`read:graph:<object>:<product>`), not the product-wide `read:graph:jira` that is being retired.
