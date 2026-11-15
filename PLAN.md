# PLAN.md: RecallRadar work plan

Steps are done **in order, on their own**. After each step: run the tests, deploy to the demo site, test it there (MOBL-57 panel or Rovo chat), commit, update CLAUDE.md (and the README where behavior changed), tick the step off here, and go straight to the next one.

Stop only for: a password or token, a decision with real tradeoffs, or something broken that cannot be fixed.

Setup done first:

- [x] Notification hook: `.claude/settings.json` runs `.claude/hooks/notify.sh` (macOS notification "RecallRadar: Claude needs you" plus a sound) on **Stop** and **Notification**.

## Step A: Rovo agent that does real work

Turn "RecallRadar Assistant" into a real agent. Replace the hello-world action with four actions, each a reusable `action` module (Rovo action) and grouped in a `rovo:skill`.

- [ ] `list_open_recalls`: devices with EXACT or LIKELY matches; filter by ward and recall class.
- [ ] `check_device`: given a model and/or serial, say whether the device matches any recall.
- [ ] `create_remediation_tasks`: create Jira tasks for chosen matches with the existing task code (no duplicates). The agent must **show what it will create and ask for confirmation first**.
- [ ] `recall_details`: explain one recall in plain English (what is wrong, what to do), citing the FDA recall number.
- Every answer cites FDA recall numbers and device IDs from real data, never invented.
- Uses the **saved check results**; never refetches openFDA per question.
- Good conversation starters (for example "Which ICU devices have open Class I recalls?").
- Tests for each action; test in Rovo chat on the demo site.

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
