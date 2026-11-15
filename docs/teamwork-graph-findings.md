# Teamwork Graph: what was probed (15 Nov 2026)

Step C asked for recalls written into the Teamwork Graph, linked to devices, tasks and teams, and for team
owners read from the graph to assign tasks. It was **probed first**, on the demo site, with a throwaway
connector, a throwaway web trigger and a temporary action. All of that has been removed from the app
(version 10.0.0, no graph scopes). Result: **reading works but has no "owner"; writing is blocked on a
consent only a person can give, and the data model cannot express the links that were asked for.**

## Summary

| Capability | Result | Detail |
| --- | --- | --- |
| Forge connector module and SDK | Accepted | `graph:connector` lints, deploys and appears under Connected apps, Connections, Teamwork Graph connectors ("RecallRadar recalls", NOT CONNECTED). |
| Installing the graph scopes | Worked | `write:object:jira`, `read:object:jira`, `delete:object:jira`, `read:graph:team:atlassian`, `read:graph:user:atlassian`: the upgrade went through. |
| **Creating the connection** | **Blocked: needs your consent** | Clicking Connect opens a legal dialog. I did not accept it (see below). Without a connection there is no `connectionId`, so nothing could be written. |
| Writing a recall as a graph object | Not tested (blocked above) | The documented object types are a **fixed list**; there is no custom "recall" type. A recall would have to be an `atlassian:document`. |
| Linking to **Jira tasks** | Documented, not tested | `associations` with `associationType: issueIdOrKeys` and the task keys. |
| Linking to **devices** | Not possible as asked | Devices are not graph entities; the documented relationship types do not include them. |
| Linking to **teams** | Not documented | No relationship type for team appears in the connector docs. |
| **Reading teams** | **Works** | As a **user** only (see below). 20 teams on the demo site. |
| Reading team members | Works | `accountId` and `name`. |
| **Reading a team's owner** | **Not available** | `AtlassianTeam` has only `id`, `organizationId`, `displayName`, `description`, image URLs and `profileUrl`. `AtlassianUser` has `id`, `accountId`, `name`, `email`. Membership edges carry only a cursor and the node. There is no owner, manager or role field. |

## The consent that stopped the write path

Connecting the connector shows: *"By clicking 'Install', you: allow Atlassian to access or ingest sensitive data...; agree that Atlassian will collect data from the third-party app and process it across your Atlassian apps...; agree that Atlassian may share data from the third-party product with MCP clients or apps that users connect to Teamwork Graph; confirm that you have obtained the rights, consents and authorizations necessary..."* and, above it, *"The connector does not replicate source data permissions. Ingested data is visible to every user in your workspace."*

That is a legal agreement and a data-sharing decision for a hospital, so it is yours to accept, not mine. I closed the dialog; the status stayed NOT CONNECTED.

## Reading teams: what works

- `api.asUser().requestTeamworkGraph(query, variables, operationName)` exists. **`asApp()` does not have it**, so reading teams must happen inside a user's request (the panel or a Rovo action), never in background code (the daily trigger, the queue consumer).
- The API **requires a named operation** shaped `company_operation` (company at least 3 characters, operation at least 4), passed both in the query text and as the third argument, for example `query recallradar_teams { ... }`.
- The caller's account id is `context.principal.accountId` in an action handler; no extra Jira scope is needed.
- Working queries (the node is a **union**, so fragments are required):

```graphql
query recallradar_myteams {
  atlassianUserInTeams(userId: "ari:cloud:identity::user/<accountId>", first: 20) {
    edges { node { __typename ... on AtlassianTeam { id displayName } } }
  }
}

query recallradar_members {
  atlassianTeamMembers(teamAri: "<team ARI>", first: 20) {
    edges { node { __typename ... on AtlassianUser { accountId name } } }
  }
}
```

- There is no "list every team" query among the curated ones: teams are found per user. (`cypherQuery` and `customQuery` appear in the schema; the docs say raw Cypher is not available to new apps, and persisted queries need registering. Not tried.)
- Scope for reading: `read:graph:team:atlassian` (and `read:graph:user:atlassian`). The upgrade accepted them; a missing org-admin grant would return empty results rather than an error.

## What could be built, and the decisions it needs

1. **Write recalls to the graph (needs your consent).** Ingest each matched recall as an `atlassian:document` associated with its Jira task(s), so recalls show up beside the tasks and in Rovo search. Because the dialog says the data is visible to every workspace user and may be shared with MCP clients, ingest **only public recall facts** (recall number, class, firm, reason, FDA link) and the task key, **never** device ids, wards or serial numbers. Devices and teams cannot be linked in the graph.
2. **Assign tasks by team (needs a rule from you).** Teams and members are readable, but there is no owner. A rule has to be chosen, for example a ward-to-team mapping plus a default assignee per team stored in RecallRadar, or "assign to the person who clicked". Reading must happen in a user context.
3. **Or skip graph writes.** Step D (a Confluence page per recall, linking devices, tasks and teams in plain text) gives most of the same visibility without the consent or the data-sharing.

A throwaway probe is easy to repeat: it needs the connector module and the five scopes added back, and a connection created by an admin.
