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

- [ ] `rovo:mcp` module exposing `check_device`, `list_open_recalls` and `create_remediation_task`.
- [ ] A skill file (`SKILL.md`) for third-party agents.
- [ ] README steps to connect it from Claude Desktop.

## Step C: Teamwork Graph

- [ ] **Probe first.** Write recalls into the graph, linked to devices, tasks and teams; read team owners to assign tasks.
- [ ] If blocked, report what was found (what the API allows, what it needs) instead of forcing it.

## Step D: Confluence page per recall

- [ ] A Confluence page for each recall: what is wrong, what to do, affected devices, links to the tasks.

## Standing rules

- Test on the Forge demo site only (`--demo-site`).
- A change that adds scopes or egress needs `--approve MAJOR_VERSION_RULE` and `forge install --upgrade`.
- Never leave temporary test settings behind (for example a 5-minute scheduled trigger).
- Real data only: never invent recall numbers, device IDs or links.
