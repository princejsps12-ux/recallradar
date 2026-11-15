# RecallRadar

A Forge app for hospital teams. It compares **FDA medical device recalls** ([openFDA](https://open.fda.gov/apis/device/enforcement/)) with the devices a hospital owns, and tells you which devices a recall may affect, **how sure it is, and why**.

It runs as a panel on every Jira issue, and as a Rovo agent (currently a small test agent).

## What it does today

| Part | What it does |
| --- | --- |
| **Latest recalls** | Lists the 20 newest FDA device recalls: recall number, firm, product, model/lot info, class, date. |
| **Hospital devices** | Stores the hospital's devices in Forge storage. **Load demo hospital** adds 30 sample devices. |
| **Check devices for recalls** | Finds recent recalls for the hospital's manufacturers and models and matches them to devices with a confidence level and a reason. |
| **Create task** | For each exact or likely match, creates a Jira task (one, or all at once) with the ward, the reason, a link to the FDA recall and a due date based on the recall's class. Never twice for the same recall and device. |
| **Create task** | For each exact or likely match, creates a Jira task (one, or all at once) with the ward, the reason, a link to the FDA recall and a due date based on the recall's class. Never twice for the same recall and device. |
| **RecallRadar Assistant** | A Rovo agent that answers questions about recalls from the saved check, explains them in plain English, and creates Jira tasks after you confirm. See "The Rovo agent". |

## Try it

1. Open any Jira issue on a site where the app is installed and find the **RecallRadar** panel.
2. Click **Load demo hospital**. It adds 30 devices. Running it again replaces only the demo devices and leaves any other devices in storage alone.
3. Click **Check devices for recalls**. Results are grouped by device, strongest match first.
4. Click **Create task** under an exact or likely match, or **Create tasks for all** (it asks you to confirm). Tasks are created in the project of the issue the panel is open on, as you, so Jira applies your permissions.
4. Click **Create task** under an exact or likely match, or **Create tasks for all** (it asks you to confirm). Tasks are created in the project of the issue the panel is open on, as you, so Jira applies your permissions.

## How matching works

A match is built from three facts, each checked on its own:

1. **Manufacturer**: the device's maker equals the recall's *recalling firm*.
2. **Model**: the device's model number is written in the recall's product description or code info.
3. **Lot/serial**: this unit's lot or serial number is listed in the recall's code info, or the recall says it covers *all* units.

Each (device, recall) pair gets **at most one result: the strongest rule that applies**. The code is in [`src/matching.js`](src/matching.js); each rule is explained next to the code that implements it.

| Confidence | Rule | Needs | Why we trust it this much |
| --- | --- | --- | --- |
| **Exact** | `exact-manufacturer-model-lot` | Manufacturer + model + this unit's lot/serial all listed | All three identifiers agree. |
| **Exact** | `exact-manufacturer-model-all` | Manufacturer + model, and the recall covers all serial/lot numbers | Every unit of that model is affected, so the unit's own number does not matter. |
| **Likely** | `likely-manufacturer-model` | Manufacturer + model, but the unit's lot/serial is not listed (or not recorded) | The model is recalled, but we cannot confirm this unit is in the affected batch. A person should check. |
| **Likely** | `likely-manufacturer-lot` | Manufacturer + lot/serial, but the model is not mentioned | Some recalls only list serial numbers. The serial and maker agreeing is strong, but not conclusive. |
| **Possible** | `possible-model-other-maker` | A distinctive model number, but a *different* recalling firm | Parent companies, distributors and relabelled products are recalled under another name. Worth a look. |
| **Possible** | `possible-manufacturer-type` | Same manufacturer + same kind of device, model not mentioned | The weakest signal: the maker has a recall for this kind of device. |

If no rule applies, nothing is reported.

### How each fact is checked

- **Normalising text.** Everything is lower-cased and split into words at any character that is not a letter or digit. `MMT-1885CLW/00763` and `mmt 1885clw 00763` are the same. Phrases must match **as whole words, in order**, so model `N15` matches `N12/N15/N17` but never `N150`.
- **Manufacturer.** Legal words (`Inc`, `Corporation`, `Ltd`, `GmbH`, `AB`...) are ignored. Two makers match when **all** words of the shorter name appear in the longer one (`Philips` matches `Philips North America Llc`), and at least one shared word is specific. Generic words (`Medical`, `Healthcare`, `Systems`...) alone never match: `Medical Systems` does not match `GE Medical Systems Information Technologies`.
- **Model.** Looked for in both the product description and the code info.
- **Lot/serial.** Looked for in the code info only, since that is where FDA lists them.
- **All units.** The recall's code info contains `all serial`, `all lot`, `all unexpired` or `all units`.
- **Device type** (weakest rule only). Every word of the device's type (`infusion pump`) appears in the recall's product text.

### The numbers, and why

There are no unexplained constants. All are named exports in [`src/matching.js`](src/matching.js) or [`src/recallSearch.js`](src/recallSearch.js):

| Constant | Value | Reason |
| --- | --- | --- |
| `MIN_MODEL_LENGTH` | 3 characters | A model like `A1` or `10` would "appear" in almost every recall by chance. |
| `MIN_LOT_LENGTH` | 4 characters | Same reason for lot/serial numbers. |
| `MIN_MODEL_LENGTH_OTHER_MAKER` | 5 characters | The `possible-model-other-maker` rule ignores the manufacturer, so the model alone must be distinctive. |
| `LOOKBACK_DAYS` | 365 | Looks at the last year of recalls: recent enough to matter, without old closed-out recalls. |
| `MODELS_PER_QUERY` | 5 | Keeps search URLs short and stops one very common model crowding out others. |
| `MAX_RECALLS_PER_QUERY` | 100 | openFDA's per-request maximum without paging. |
| `SEARCH_LIMIT_PER_QUERY` | 25 | Newest recalls requested per search. Smaller is faster; 25 kept every match in the demo (see "Speed" below). |
| `CACHE_TTL_HOURS` | 6 | How long a saved check stays fresh. FDA publishes about weekly, so a few hours old is fine, and it spares openFDA's request limit. |
| `SEARCH_DEADLINE_MS` | 240 s | Gives up on slow searches 60 s before the 300 s limit of the background function. |
| `STALE_JOB_MS` | 6 min | A background job with no progress update for this long counts as failed. |
| `MAX_CACHE_BYTES` | 200 KiB | Forge storage rejects values over 240 KiB; larger results are skipped (recomputed) instead of failing. |

### Ordering

Results are sorted by confidence (exact, likely, possible), then recall class (I is the most serious), then newest recall first, then device id, so the order is always the same.

### Known limits

- **Serial ranges are not understood.** A recall that says `serial number < 2224` lists no individual numbers, so a device inside the range shows as **likely** and needs a person to check.
- **No spelling variants.** `monitor` and `monitors` are different words, and `MMT1885CLW` does not match `MMT-1885CLW`.
- **Newest 25 recalls per search.** A manufacturer or model group with more than 25 recalls in the window may have older ones missed. The panel says so when any search hit this cap (openFDA reports the real total, so it is exact, not a guess). The model searches still catch recalls that mention a hospital model.
- **openFDA rate limit.** Anonymous use is limited (about 1,000 requests a day per IP address, 240 a minute). One check makes about two dozen requests, which is why it runs on a button click, and why results are saved (see below).
- **The FDA is not the only source.** Recalls from other regulators are not included.

## The check runs in the background

A check makes about two dozen openFDA requests and a cold one takes 10 to 14 seconds on the demo site. A Forge UI function is cut off after 25 seconds and that limit cannot be raised (custom timeouts exist only for queue consumers and scheduled triggers), so a slow day could make a click fail. Instead:

1. **Clicking "Check devices" starts a background job and returns at once.** The resolver records a job and puts a message on a Forge queue (async events). A queue consumer ([`src/consumer.js`](src/consumer.js), allowed to run for up to 300 seconds) does the work.
2. **The panel shows progress.** It asks for the job's status every 2 seconds and shows "Checked 14 of 24 FDA searches". If you reload the page mid-check, it picks the running job back up.
3. **Results are saved for 6 hours** in Forge storage, with a "last checked" time and a **Refresh** button. A saved result is used only while it is under 6 hours old and the device list is unchanged (a fingerprint of the devices). When the panel opens on an **expired** result, it shows that result flagged "older than 6 hours" and refreshes it in the background, so the panel is never empty.
4. **A daily trigger refreshes the saved result** ([`src/scheduled.js`](src/scheduled.js)), so it is usually already there before anyone clicks.

The rules that keep it correct (each has unit tests): a check with failed lookups is shown but **not** saved; only the running job with the right id may be updated, so late or duplicate queue deliveries are skipped; a job that stops reporting for 6 minutes counts as failed; a result too large for storage is reported as a failure, not lost; the search has its own 240-second deadline inside the 300-second limit. The pieces are [`src/checkJob.js`](src/checkJob.js) (job record), [`src/matchService.js`](src/matchService.js) (start / run / status) and [`src/matchCache.js`](src/matchCache.js) (saved result).

Searches are also kept small: each asks for the newest 25 recalls (`SEARCH_LIMIT_PER_QUERY`), not 100.

### Measurements (demo hospital: 30 devices, 24 searches)

| | Before | After |
| --- | --- | --- |
| Search size | 100 recalls | 25 recalls |
| Cold check, on a laptop | 5 to 15 s (about 10 s on average, 4 runs) | 5 to 12 s (about 7 s on average, 6 runs) |
| Cold check, on the demo Jira site | about 30 s (read off the screen, so rough) | 13.4 s and 10.7 s (reported by the app, 2 runs) |
| Downloaded | 21.4 MB | 19.5 MB |
| Recalls fetched / matches found | 280 / 101 | 200 / 101 |
| Best match per device | 12 exact, 9 likely, 4 possible | unchanged |
| **Repeat check (saved result)** | same as a cold check | **0 ms, 0 MB** |

The honest picture: smaller searches help a little and cold timings are noisy (openFDA's response time varies a lot), but they do not fix the real cost. **One recall record (Z-1645-2026, BD Alaris) is 8.7 MB**, almost all of it a sub-object we never use, and openFDA cannot leave fields out. It is downloaded twice (by a manufacturer search and by a model search), which is about 17 of the 19.5 MB. Saving the result is what makes the panel feel instant: the cost is paid once per 6 hours instead of on every click.

Ideas not built: skip the duplicate download, or fetch per-device in the background.

## Creating tasks

Every **exact** or **likely** match can become a Jira task. **Possible** matches never do: they are weak (same maker and kind of device, or a model number from a different firm), and a task for each would bury the team in noise. The code is in [`src/taskRules.js`](src/taskRules.js) (what a task looks like), [`src/taskService.js`](src/taskService.js) (creating without duplicates) and [`src/jiraClient.js`](src/jiraClient.js) (the three Jira calls).

**What a task contains**

| Field | Value |
| --- | --- |
| Title | `FDA recall Z-2723-2026: Plum Duo infusion pump (ICU Medical 400020401)` |
| Description | The ward; the device (name, maker, model, serial/lot); **why it matched** (the match reason); the recall (number, class, firm, date, product); links; and the due date with its rule |
| Links | The openFDA record for exactly that recall (verified to return it), and FDA's recall database. FDA has no stable per-recall web page that could be verified, so the openFDA record is the dependable link to the recall itself |
| Due date | See the rule below |
| Labels | `recallradar`, and one label per recall and device (see "No duplicates") |
| Type / project | `Task` (else the project's first non-sub-task type), in the project of the issue the panel is open on |

### Due-date rule

FDA classes a recall by how dangerous the problem is ([21 CFR 7.3](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-7/subpart-A/section-7.3)): **Class I** a reasonable chance of serious harm or death; **Class II** temporary or medically reversible harm, or a remote chance of serious harm; **Class III** not likely to cause harm. The due date is a number of **calendar days from the day the task is created** (the UTC date), so it never depends on weekends or holidays.

| Recall class | Days | Why |
| --- | --- | --- |
| **Class I** | **2** | Serious harm is possible, so the device should be found and quarantined within a couple of days, not left for a weekly review. |
| **Class II** and **III** | **7** | Harm is unlikely or reversible, so the team's normal weekly review is soon enough. |
| Unknown or missing class | **2** | Serious harm cannot be ruled out. In a hospital a task that is due too early costs far less than a missed recall, so it is treated like Class I. |

The numbers are the constants `DUE_DAYS_CLASS_I`, `DUE_DAYS_CLASS_II_III` and `UNKNOWN_CLASS_DUE_DAYS` in [`src/taskRules.js`](src/taskRules.js), and each task's description states the rule that set its date. They are a starting point for a hospital to tune, not a regulatory requirement.

### No duplicates

Each task carries a label that encodes its recall and device (`recallradar-Z-2723-2026-demo-001`). Two layers stop a second task for the same pair:

1. **Jira is the source of truth.** Before creating anything, the app searches Jira for those labels, so an existing task is found even if the app's own storage was cleared, or the task was made from another browser or tab.
2. **A 2-minute guard in Forge storage** (`GUARD_TTL_MS`). Jira's search index can lag a few seconds behind a new issue, so a fast double click could slip past layer 1. For two minutes the app remembers what it just created or is creating. After that Jira's own search knows, and a task that was deleted in Jira can be created again.

Also: the same pair listed twice in one request makes one task; a "possible" match is refused by the server; and the browser sends only the recall number and device id, while everything else in a task is rebuilt **on the server** from the saved check result, so a forged request cannot set a task's text or due date.

Checked on the demo site: after creating all 35 tasks, a second tab that still thought none existed asked for all 35 again, and the server created none ("34 already had a task"). Jira held 35 tasks with 35 distinct labels.

### Limits

- **Request size.** Creating a task takes about 0.6 s, and a UI function is cut off at 25 s: creating 34 in one request took about 20 s on the demo site. So one request may ask for at most 25 tasks (`MAX_PAIRS_PER_REQUEST`) and the panel sends batches of 10, with a running count.
- **Looking up existing tasks** only searches Jira, so it may cover up to 200 pairs per request (`MAX_STATE_PAIRS_PER_REQUEST`); this is how the panel shows "Task: MOBL-12" for matches that already have one.
- **Jira bulk limit.** Jira creates at most 50 issues per bulk call (`BULK_CREATE_LIMIT`).
- **Permissions.** Tasks are created *as the person who clicked* (`asUser`), so someone who may not create issues gets Jira's error, and the app needs the `write:jira-work` scope.
- **Project.** Tasks go to the project of the current issue; choosing a different project is not built.
- **Task state is not tracked.** The panel shows the task's key as a link, not whether it is done.

## The Rovo agent

**RecallRadar Assistant** is a Rovo agent (open it with **Ask Rovo**, then pick it from the agent list). It answers only from the **saved recall check**, the same data as the panel: it never calls openFDA, so answers are fast and consistent.

| Action | What it does |
| --- | --- |
| `list_open_recalls` | Devices with an open recall that matches **exact** or **likely**, most serious first. Filter by `ward`, `recallClass`, `confidence`. |
| `check_device` | Given a model, serial/lot or device id, says whether the device matches any recall. Only devices in the hospital list can be checked. |
| `create_remediation_tasks` | Creates Jira tasks (the same code as the panel's buttons, so never a duplicate). **Preview first, then confirm** (see below). |
| `recall_details` | Explains one recall: what is wrong (the FDA's own reason text), how serious, which devices and wards, what to do, links, and any existing task. |

Each action is an `action` module (a reusable Rovo action other agents can call) and all four are grouped in one `rovo:skill`, `recall-triage` ([`skills/recall-triage/SKILL.md`](skills/recall-triage/SKILL.md)). The logic is in [`src/agentTools.js`](src/agentTools.js) (pure, unit tested); [`src/rovoActions.js`](src/rovoActions.js) is the thin Forge handler layer.

**Starter questions** on the agent: "Which ICU devices have open Class I recalls?", "Do any of our devices match an FDA recall?", "Is the device with serial 50003704 affected by a recall?", "Explain the most urgent recall in plain English", "Create tasks for the Class I recalls in the ER".

### Never invented

Every answer carries a `citations` list: the only recall numbers and device ids the agent may quote for that answer. The agent's prompt forbids inventing a recall number, device id, serial, Jira key or link, and tools say so plainly when nothing is found (an unknown device, a recall that matched nothing, no saved check yet). An exact match means manufacturer, model and serial/lot are all listed; a likely match is always described as needing a manual check.

### Creating tasks: preview, then confirm

Forge has no built-in "ask first" setting for an action, so the action itself enforces it:

1. Called **without** `confirmed`, `create_remediation_tasks` only **previews**: the task titles, wards, due dates, the project, anything that already has a task, and a one-time `confirmationToken`. Nothing is created.
2. The agent shows that preview and asks "Shall I create these N tasks?"
3. Only after you say yes does it call the action again with `confirmed=true` and the token. The server creates **exactly the previewed tasks**, whatever else the call asks for. The token works once and expires after 10 minutes.

So the agent cannot create a task it has not previewed, and a made-up or reused token creates nothing. Whether the agent actually *asks you* is enforced by its prompt, and was checked in Rovo chat. Rovo also shows its own "Please review" card for any `CREATE` action, so you approve twice (in chat, then on the card). Tasks are created **as you** (the reporter is the person chatting), and at most 20 per confirmation; a larger selection says how many were left out.

### Limits

- **Answers are only as fresh as the saved check** (6 hours; the answer says how old it is, and the panel refreshes it). A check saved before this feature has no per-recall reason text, so refresh it once in the panel.
- **Only devices in the hospital list** can be checked, against recalls the check found for them.
- **Action inputs are plain text, numbers or true/false** (Rovo does not allow lists), so "which matches" is chosen with filters: recall number, device id, ward, class.

## How the demo hospital is built

[`src/demoHospital.js`](src/demoHospital.js) holds 30 devices with **real manufacturer and model names taken from actual openFDA recalls**. Devices meant to match have serial/lot numbers that the real recall lists. Wards and the serial numbers of unaffected devices are invented. The file's header explains the groups (exact, likely, possible, none) and how it was checked.

Check what the demo matches against the live API at any time:

```bash
node scripts/check-demo-matches.mjs
```

Results can drift as the FDA publishes new recalls, and recalls fall out of the one-year window.

## Where devices live

Devices sit behind one small interface in [`src/deviceStore.js`](src/deviceStore.js) (`listDevices`, `saveDevices`, `clear`, `removeBySource`, `replaceAll`). Today they are stored in **Forge storage** ([`src/kvAdapter.js`](src/kvAdapter.js)), one key per device, so the app works on any site with no setup.

**JSM Assets** is a possible extra source. Forge can *read* Assets objects (`read:cmdb-object:jira`, `read:cmdb-schema:jira` are already declared), but in testing it could not *create* a schema as the app (403: Assets administrator rights are required). A read-only import that maps Assets objects to the device shape and calls `saveDevices` is the planned route. It is not built yet.

## Project layout

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
src/agentTools.js         The four Rovo agent tools (pure) and the preview/confirm store
src/rovoActions.js        Forge handlers for the agent's actions
skills/recall-triage/     The skill that groups the actions (SKILL.md)
src/taskRules.js          What a task looks like: due date rule, title, labels, description
src/taskService.js        Creating tasks without duplicates (Jira search + short guard)
src/jiraClient.js         The Jira calls: find by label, issue type, bulk create
src/demoHospital.js       The 30 demo devices and "Load demo hospital"
src/*.test.mjs            Unit tests (Node's built-in runner)
scripts/                  Developer checks that use the network
static/hello-world/       Custom UI (React) for the issue panel
```

## Develop

Requirements: Node 22+ and the Forge CLI (`npm install -g @forge/cli`, then `forge login`).

```bash
npm install
npm test                                   # unit tests, no network needed

cd static/hello-world
npm install --legacy-peer-deps             # the template pins React 16
npm run build                              # rebuild after any front-end change
cd ../..

forge lint
forge deploy -e development
forge install --upgrade -e development     # only when scopes or permissions change
```

`forge deploy` prints an approval prompt when a change makes a major version (new scopes or external domains); re-run with `--approve MAJOR_VERSION_RULE` if that is what you intended.

### Tests

`npm test` runs every `src/*.test.mjs` file with Node's built-in test runner: no extra packages. The matching tests cover each rule, each fact check, the boundaries of every threshold, ordering, and cases that must **not** match.

### Permissions

| Scope / permission | Why |
| --- | --- |
| `read:jira-work` | Jira issue panel; finding existing RecallRadar tasks. |
| `write:jira-work` | Creating tasks (as the clicking user). |
| `storage:app` | The device list in Forge storage. |
| `read:servicedesk-request`, `read:cmdb-object:jira`, `read:cmdb-schema:jira` | Reserved for the read-only Assets import. Not used yet. |
| External fetch: `api.fda.gov` | Recall data from openFDA. |

## Support

See [Get help](https://developer.atlassian.com/platform/forge/get-help/) for Forge help and feedback.
