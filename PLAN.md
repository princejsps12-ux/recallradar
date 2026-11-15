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
- [x] Agent and MCP: `who_handles_ward` (read-only); the agent's task preview can propose assignees (`assignSuggested`) and confirming looks the people up again (the preview stores no person).
- [x] README lists **exactly the two Teamwork Graph calls** made.
- [x] Deployed (14.x); installs upgraded in Jira and Confluence. Rovo chat: `who_handles_ward` answered "no team mapped" without guessing.
- [x] Live panel check (after the user fixed DNS): team list, mapping, team line, suggestion count and the off-by-default checkbox all work. Found and fixed: the graph API caps `first` at 25. One real assignment verified live (MOBL-99 assigned to the suggested team member); the "create all" checkbox was not clicked.

## Step D2: Panel button for the Confluence page

- [x] **Create Confluence recall page** in the panel: space chooser (read from Confluence, never guessed), recall chooser (all open or one), result links. Resolvers `listSpaces` and `createRecallPage` reuse the agent action's service. Verified live: updated the Z-0208-2027 page in Mobile Development and showed its link.

## Step D: Confluence page per recall

- [x] A Confluence page for each recall: what is wrong, what to do, affected devices, links to the tasks (live Jira cards). Built as the agent action `create_recall_page`, with a pure page builder, a Confluence client and a service (42 new tests).
- [x] Tested on the demo site: the agent listed the real spaces, asked to confirm, created the page in Mobile Development; asking again **updated** it (version 2, still one page) and returned a working link; the rendered page was checked in Confluence.
- [x] Needed: the app installed in Confluence as well as Jira, and the Confluence page scopes.
- [x] Panel button: see Step E (the agent action covers "one recall" or "all open recalls", up to 10 per call).

## Step E: Dashboard (full-page app)

- [x] Done and checked live on the demo site (cards, filters, team column, task links, panel link opens it). A global page "RecallRadar" (same Custom UI bundle, chosen by module type): summary cards (devices, open recalls by class, tasks open/done), table of affected devices filterable by ward and class, recent recalls, first-run screen with one big "Load demo hospital" button. Atlassian design tokens; empty, loading and error states. The issue panel stays and links to it.

## Step F: Production and Marketplace prep

- [x] Deployed to production (2.0.0). Listing material is in `marketplace/` (LISTING.md, PRIVACY.md, TERMS.md, icon.svg, SUBMIT.md with the steps you do yourself). [ ] **Not done, yours:** the install/share link (developer console, Distribution, Sharing, Generate link: the browser tool was unreachable and it is your account), support email, 144 px icon PNG export, screenshots, Marketplace form.

## Step G: MCP demo

- [x] Written in `docs/mcp-demo.md` (not run end to end: needs the admin switch and your consent). Exact step-by-step instructions to enable the MCP tools on the demo site, connect Claude Desktop, and ask "Are any of our infusion pumps recalled?". The user does the clicking.

## Step H: Judge simulation

- [x] Production installed on the personal dev site (Jira and Confluence) by CLI. The browser tool was offline, so the fresh subagent reviewed the README only (it could not click through). Its 19 findings are fixed where possible: quick start, prerequisites, expected results, safe-try note, glossary, data and trust, dashboard documented, first-person wording removed, unused scopes removed, and a paste-in device import added (its biggest point). Not fixed: screenshots/video, README split into docs, install link (yours).

## Step I: Strict review against the five Codegeist criteria

- [x] See `docs/REVIEW.md`: 8 / 6.5 / 7 / 8 / 5 with the weakest points and what remains yours.

## Standing rules

- Test on the Forge demo site only (`--demo-site`).
- A change that adds scopes or egress needs `--approve MAJOR_VERSION_RULE` and `forge install --upgrade`.
- Never leave temporary test settings behind (for example a 5-minute scheduled trigger).
- Real data only: never invent recall numbers, device IDs or links.

## Step J: Privacy hardening (done)

- [x] Previews store no accountId or name (flag only; people are looked up again at confirm time).
- [x] Expired previews and task guards are deleted (on read, on write, and by the daily cleanup).
- [x] Saved check result and finished-job copy never kept longer than 24 hours.
- [x] `.claude/` kept out of the repository; repository published on GitHub (main only).

## Step K: Follow-ups from the user (partly done)

- [x] Install link in the README quick start; local backup branch deleted; 144 px icon PNG (`scripts/make-icon.mjs`).
- [x] Design polish (see `docs/REVIEW.md`, Design 7). Not yet seen on a real screen.
- [x] **Live check of the import screen**: a bad paste is refused ("Nothing was imported. Line 2: model is empty."); a good row imported, the device count went 30 to 31 and the check re-ran.
- [x] **Live check of "Create tasks for all" with assign**: 28 tasks created, 8 assigned (delete them with the Jira search `labels = recallradar` when done).
- Done after Chrome was reconnected. The live look found one visual bug (a screen-reader-only caption was visible), now fixed.
