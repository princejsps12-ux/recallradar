# Developing RecallRadar

The demo hospital, where devices live, the project layout, how to build, deploy and test.

# How the demo hospital is built

[`src/demoHospital.js`](../src/demoHospital.js) holds 30 devices with **real manufacturer and model names taken from actual openFDA recalls**. Devices meant to match have serial/lot numbers that the real recall lists. Wards and the serial numbers of unaffected devices are invented. The file's header explains the groups (exact, likely, possible, none) and how it was checked.

Check what the demo matches against the live API at any time:

```bash
node scripts/check-demo-matches.mjs
```

Results can drift as the FDA publishes new recalls, and recalls fall out of the one-year window.

# Where devices live

Devices sit behind one small interface in [`src/deviceStore.js`](../src/deviceStore.js) (`listDevices`, `saveDevices`, `clear`, `removeBySource`, `replaceAll`). Today they are stored in **Forge storage** ([`src/kvAdapter.js`](../src/kvAdapter.js)), one key per device, so the app works on any site with no setup.

**Your own devices** come from **Import your own devices** on the dashboard (paste rows from a spreadsheet; [`src/deviceCsv.js`](../src/deviceCsv.js)). **JSM Assets** is a possible extra source, but it is not built: in testing, Forge could not *create* an Assets schema as the app (403: Assets administrator rights are required), and the app does not declare any Assets scopes. A read-only import that maps Assets objects to the device shape and calls `saveDevices` is the planned route.

# Project layout

```
manifest.yml              Forge modules, scopes, external fetch permission
src/index.js              Resolvers: recalls, devices, demo hospital, check start/status; Rovo action
src/openfda.js            openFDA URLs and parsing (display and full-text)
src/recallSearch.js       Which recalls to fetch for a device list (firm + model queries)
src/matchCache.js         Saved check results in Forge storage (6-hour freshness)
src/checkJob.js           The background job record: status, progress, stale detection
src/matchService.js       Start / run / status of the background check, saved result
src/runtime.js            Forge wiring shared by the consumer and the daily trigger
src/consumer.js           Queue consumer: runs the check in the background (300 s)
src/scheduled.js          Daily trigger: refreshes the saved result
src/matching.js           The matching rules
src/text.js               Shared text helpers (tokenize, whole-word phrase search)
src/deviceStore.js        Device list interface
src/kvAdapter.js          Forge storage behind that interface
src/agentTools.js         The Rovo agent tools (pure) and the preview/confirm store
src/recallPage.js         The Confluence page for one recall (pure, escaped)
src/recallPageService.js  One page per open recall: choose space, create or update
src/confluenceClient.js   The Confluence calls: spaces, find page by title, upsert
src/rovoActions.js        Forge handlers for the agent's actions
src/teamGraph.js          The two read-only Teamwork Graph calls (documents + parsing)
src/wardTeams.js          Ward-to-team mapping in Forge storage
src/teamService.js        Assignee suggestion rule, ward lookups, checks before assigning
skills/recall-triage/     The Rovo skill that groups the actions (SKILL.md)
integrations/claude/      Skill file for third-party agents (Claude) using the MCP tools
src/taskRules.js          What a task looks like: due date rule, title, labels, description
src/taskService.js        Creating tasks without duplicates (Jira search + short guard)
src/jiraClient.js         The Jira calls: find by label, issue type, bulk create
src/demoHospital.js       The 30 demo devices and "Load demo hospital"
src/*.test.mjs            Unit tests (Node's built-in runner)
scripts/                  Developer checks that use the network; ui-smoke.cjs (jsdom UI test)
scripts/preview/          The real app in a browser without Jira: every state, checks, screenshots
static/ui/       Custom UI (React): the issue panel, the dashboard and the "Create all" pop-up
```

# Develop

Requirements: Node 22+ and the Forge CLI (`npm install -g @forge/cli`, then `forge login`).

```bash
npm install
npm test                                   # unit tests, no network needed

cd static/ui
npm install --legacy-peer-deps             # the template pins React 16
npm run build                              # rebuild after any front-end change
cd ../..

forge lint
forge deploy -e development
forge install --upgrade -e development     # only when scopes or permissions change
```

`forge deploy` prints an approval prompt when a change makes a major version (new scopes or external domains); re-run with `--approve MAJOR_VERSION_RULE` if that is what you intended.

The app is multi-app compatible (Jira required, Confluence optional): install it in Jira first (`forge install -e development -p Jira`), then connect Confluence with `forge install -e development -p Confluence`. `forge deploy` refuses an environment that still has an installation in a non-required product (an old separate Confluence installation), so run `forge uninstall -p Confluence` first in that case.

## Tests

`npm test` runs every `src/*.test.mjs` file with Node's built-in test runner: no extra packages. The matching tests cover each rule, each fact check, the boundaries of every threshold, ordering, and cases that must **not** match.

`npm run test:ui` renders the real panel and dashboard in jsdom with a stubbed Forge bridge and clicks the main flows (it cannot judge looks).

`npm run preview` and `npm run test:preview` run the **production bundle in a real browser**, without Jira, under a content security policy like the Forge iframe's, over every screen and state (first run, errors, a running check, nothing affected, and so on) in light and dark, on desktop and phone widths, plus a tour of the drawer, menus and dialogs. They fail on a policy violation, a console error, an accessibility violation (axe-core, WCAG 2.2 AA) or a panel that outgrows its frame. `npm run shots` regenerates the Marketplace screenshots from the same page. See [`scripts/preview/README.md`](../scripts/preview/README.md).
