# PLAN.md: RecallRadar work plan

Steps are done **in order, on their own**. After each step: run the tests, deploy to the demo site, test it there (MOBL-57 panel or Rovo chat), commit, update CLAUDE.md (and the README where behavior changed), tick the step off here, and go straight to the next one.

Stop only for: a password or token, a decision with real tradeoffs, or something broken that cannot be fixed.

Setup done first:

- [x] Notification hook: `.claude/settings.json` runs `.claude/hooks/notify.sh` (macOS notification "RecallRadar: Claude needs you" plus a sound) on **Stop** and **Notification**.

## Step A: Rovo agent that does real work

Turned "RecallRadar Assistant" into a real agent: four reusable `action` modules grouped in a `rovo:skill`.

- [x] `list_open_recalls`: devices with EXACT or LIKELY matches; filter by ward and recall class. (Checked in Rovo chat; the "no ICU Class I" answer was verified against the data.)
- [x] `check_device`: by model, serial or device id. (Chat: serial 50003704 gave demo-001 with exact match Z-2723-2026.)
- [x] `create_remediation_tasks`: preview, then confirm, no duplicates. (Chat: previewed 6 tasks and asked; creating needed the preview token; MOBL-93 to MOBL-98 verified in Jira; asking again created nothing.)
- [x] `recall_details`: plain-English explanation with the real FDA reason text, what to do, links.
- [x] Every answer cites real recall numbers and device ids (`citations`), never invented; uses the saved check only; five conversation starters; unit tests for each action (73 new).

## Step B: Expose the actions to other agents with `rovo:mcp`

- [x] `rovo:mcp` module (`recallradar-mcp`) exposing `check_device`, `list_open_recalls` and a new single-task `create_remediation_task`. Deploys and lints; unit tested (12 new tests).
- [x] A skill file for third-party agents: `integrations/claude/recallradar/SKILL.md`.
- [x] README steps to connect from Claude Desktop (custom connector, or `mcp-remote`), Claude Code, and the admin switch. **A real external client was not connected**: it needs a site admin to enable the tools and an interactive OAuth sign-in.

## Step C: Teamwork Graph

- [x] **Probed first.** Full findings: [`docs/teamwork-graph-findings.md`](docs/teamwork-graph-findings.md). The probe and every temporary artifact (connector, web triggers, action, graph scopes) were removed; the app is back to the Step B state (10.0.0).
- [x] **Reading works, but there is no team owner.** Teams (20 on the demo site) and members are readable as a user via `requestTeamworkGraph` (needs a `company_operation` operation name; `asApp` does not have it). The team and user types have no owner, manager or role field.
- [x] **Decision (15 Nov 2026): skip graph writes.** Writing recalls to the graph was blocked on a consent only the user can give, and was not wanted. Step D's Confluence pages cover the same visibility. Original blocker: Creating the connection shows a legal dialog (data ingested, shared with MCP clients, visible to every workspace user). I did not accept it. Also, the object types are a fixed list (a recall can only be an `atlassian:document`), links to Jira tasks are documented, and links to devices or teams are not.
- Decisions needed from you are listed at the end of the findings document (accept the consent and what to ingest, how to choose an assignee without an owner, or skip graph writes).

## Step C2: Teamwork Graph, read-only (decided 15 Nov 2026)

Skip writes; build what only **reads** the graph (the bonus also counts read-only apps).

- [x] Pure modules with tests: `src/teamGraph.js` (the two read calls), `src/wardTeams.js` (ward-to-team mapping in Forge storage), `src/teamService.js` (the assignee rule, ward lookups, checks before assigning). 63 new tests.
- [x] Tasks can carry an assignee (`taskRules`, `taskService`); `jiraClient.openTaskCounts()` feeds the "fewest open tasks" rule.
- [x] Panel: **Ward teams** mapping (team list read from the graph), **Team: <name> (from Teamwork Graph)** on match rows, suggested assignee with **Create & assign** (asks first), and an off-by-default checkbox for "create all".
- [x] Agent and MCP: `who_handles_ward` (read-only); the agent's task preview can propose assignees (`assignSuggested`) and confirming assigns exactly those people.
- [x] README lists **exactly the two Teamwork Graph calls** made.
- [x] Deployed (14.x); installs upgraded in Jira and Confluence. Rovo chat: `who_handles_ward` answered "no team mapped" without guessing.
- [ ] **Live panel check pending**: the test machine's DNS refuses `*.cdn.prod.atlassian-dev.net` (Forge's CDN), so the panel iframe cannot load there. Needs: switch the Mac's DNS (for example to 1.1.1.1 / 8.8.8.8) or another network, then map ICU to a team, create a task with "Create & assign", and ask the agent "Who handles the ICU?".

## Step E: Panel button for the Confluence page

- [x] **Create Confluence recall page** in the panel: space chooser (read from Confluence, never guessed), recall chooser (all open or one), result links. Resolvers `listSpaces` and `createRecallPage` reuse the agent action's service. Checked in a simulated panel; the live click is pending for the same DNS reason as above.

## Step D: Confluence page per recall

- [x] A Confluence page for each recall: what is wrong, what to do, affected devices, links to the tasks (live Jira cards). Built as the agent action `create_recall_page`, with a pure page builder, a Confluence client and a service (42 new tests).
- [x] Tested on the demo site: the agent listed the real spaces, asked to confirm, created the page in Mobile Development; asking again **updated** it (version 2, still one page) and returned a working link; the rendered page was checked in Confluence.
- [x] Needed: the app installed in Confluence as well as Jira, and the Confluence page scopes.
- [x] Panel button: see Step E (the agent action covers "one recall" or "all open recalls", up to 10 per call).

## Standing rules

- Test on the Forge demo site only (`--demo-site`).
- A change that adds scopes or egress needs `--approve MAJOR_VERSION_RULE` and `forge install --upgrade`.
- Never leave temporary test settings behind (for example a 5-minute scheduled trigger).
- Real data only: never invent recall numbers, device IDs or links.
