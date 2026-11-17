# RecallRadar

A Forge app for hospital teams. It compares **FDA medical device recalls** ([openFDA](https://open.fda.gov/apis/device/enforcement/)) with the devices a hospital owns, and tells you which devices a recall may affect, **how sure it is, and why**.

**Why it matters.** An FDA recall of a device model or lot can mean serious harm or death (Class I). New recalls are published every week, and a clinical engineering team has to find, by hand, which of its own devices they cover (the right maker, the right model, the right serial or lot) and then chase the follow-up. A missed match is a patient-safety risk and a slow one is a compliance problem. RecallRadar does the matching, says how sure it is, and turns each match into a Jira task due by the recall's class.

![The RecallRadar dashboard: 25 devices need action, the most urgent first](marketplace/screenshots/01-dashboard-overview-light.jpg)

*The dashboard, generated from the app with invented demo data (the issue panel, the device drawer, dark mode, phone width and live Rovo, Jira and Confluence shots are in [`marketplace/screenshots`](marketplace/screenshots)).*

It runs as a panel on every Jira issue, as a Rovo agent, and as MCP tools other agents can call. It reads **teams and their members from the Teamwork Graph** (read-only) to say who should handle a device's ward.

## Judge quick start

**Install link:** [Install RecallRadar on your site](https://developer.atlassian.com/console/install/2e0464e9-8b4a-4388-b224-b4f05eae484f?signature=AYABeO4RTK5WoBjofwC5LLmbhsYAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBww%2B9LK1oIgu9liOwPhgsXAAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDHKMnOskwi5OXx%2FzLgIBEIA7zuERvhMx7ShEsGkCJm5Z8hk9ed%2Bt7tGaDRXY7BfQDQgmbBI9ZRnlrKpIjin2Om5ZKyqwiB1JHcdqFnsAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgGys7iVbyvKbXxP2R%2BERAnvAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQM%2FVNU%2BxfhXtpy4%2BeYAgEQgDsvKNiIJmQha%2FJR9MFVh%2BPee9MRb%2BS8yIpLzcQKBiEpJmV5m14bJnObCM285wbWwmXa80cIEai5oxRxNQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEATS%2Bkr01q3xokP63tO9y6hEAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAydBB73g1k8hMBXv2oCARCAO39zZoIuJS%2BmBrVEmrJ6IgA8F1fJ1zjpKdaHLgS0A2U1ATDnB8LEBbE99JXX4bf6vnTBM2yrpM%2BXFlGLAgAAAAAMAAAQAAAAAAAAAAAAAAAAACbRvGQFLeROV2zy2GClH%2F%2F%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADJywqnoXY3ILklDld%2FHhPDyQrscgOSY0SSFTsEKQ8eo%2B3drtTsSIsOcDlwi9SCsXCp%2FHu8jd30aniNvAEKK7u5gOqM%3D&product=jira&product=confluence)

Open it, pick your site and install it in **Jira**. That is all RecallRadar needs: it is one installation for the whole site, so the same devices and checks show up in the Jira dashboard, in a Rovo chat and in Rovo Home.

<a id="install-and-connect-confluence"></a>**Confluence is optional** and only the recall pages use it. Tick **Confluence** under "additional Atlassian apps" in the install dialog to connect it right away, or later, as a site admin: admin.atlassian.com, your organization, **Apps**, **Sites**, your site, **Connected apps**, `recallradar` (the name the admin pages use), **View app details**, **Connections**, **Connect** next to Confluence, and **Connect** again in the side panel ([the steps one by one](docs/INSTALLATION.md#connecting-confluence-step-by-step)). Without it everything else works, and the Confluence dialog says the same.

**Before you start**
- A Jira site where you can create issues, and a Jira issue to open (any issue works).
- Optional, each unlocks one feature: **Rovo** (the chat agent; a free developer site has none, so if Jira shows no **Ask Rovo** button, skip step 5 and look at `marketplace/screenshots/21-rovo-chat-answer.png` and `22-rovo-chat-task-preview.png`), **Confluence** (recall pages, once connected as above), and membership of at least one **team** in your Atlassian directory (the ward-to-team feature lists the teams you belong to; with none, that dropdown is empty and everything else still works).

**About ten minutes, in order**
1. Jira, **Apps**, **RecallRadar**: the dashboard. On a fresh site it shows a first-run screen. Click **Load demo hospital** (30 sample devices with real manufacturer and model names), or **Import your own devices** and paste rows from a spreadsheet. It then checks them against the last three years of FDA recalls in the background (about 15 seconds).
2. Expect the headline "N devices need action" with the Class I count and one summary line (devices monitored, open recalls by class, task counts), a **Do this first** list and a table of affected devices. With the demo hospital you should see roughly 20 to 30 open exact or likely recalls across Class I, II and III; the exact numbers drift as the FDA publishes new recalls.
3. Click a device name for its recalls, the reason each matched and what the FDA says is wrong, then **Create task** (or **Create and assign to ...** in the small menu beside it if you mapped a ward to a team).
4. Open any Jira issue, click **Apps** (beside the **+** under its title) and choose **RecallRadar**: the panel is a compact summary with **Open dashboard** and **Create all N tasks...**.
5. Ask **Rovo** (Ask Rovo in Jira, or Rovo Home; pick **RecallRadar Assistant**): "Which Cath Lab devices have open Class I recalls?"
6. Optional: open the **Ward teams** tab and pick the team that handles each ward (the list comes from the Teamwork Graph). Then **Create and assign to …** is offered in the drawer. Nobody is assigned unless you choose it.
7. Optional: open the **...** menu, **Create Confluence pages**, choose a space and a recall, **Create page** (needs the Confluence connection above; running it again updates the page).

**Try it safely.** Tasks and Confluence pages are real. All RecallRadar tasks carry the label `recallradar`: find them with the Jira search `labels = recallradar` and delete them when you are done. Creating a task for the same recall and device twice is blocked on purpose, so delete the tasks before re-running. Assigning someone sends them a Jira notification, and nobody is assigned unless you click the assign button.

**Words used here.** *Device recall*: the FDA tells hospitals a device model or lot has a problem. *Class I / II / III*: how dangerous (I most, III least). *Ward*: the hospital unit, such as ICU. *Rovo*: Atlassian's AI chat agent. *MCP*: a standard way for other AI tools to call an app's functions. *Teamwork Graph*: Atlassian's directory of teams and people.

**Scope today.** Your devices come from the demo hospital or a pasted spreadsheet (the import replaces your earlier paste). The device list is shared by the whole site, so loading, importing and removing devices is for **Jira administrators** (whoever installs the app is one); everyone else can read results and create tasks. A direct JSM Assets import is not built. Only manufacturer and model names ever leave Atlassian (to openFDA); there is no patient data.

## What it does today

| Part | What it does |
| --- | --- |
| **Dashboard** | A full-page app (Apps, RecallRadar): "N devices need action" with the Class I count and one summary line (devices monitored, open recalls by class, task counts), a **Do this first** list (top 5 devices; the device name opens its details, each row has one **Create task**, plus **Create all N tasks…**), a table of affected devices you can filter by ward and class, sort by any column and page through (10 per page), a side drawer (device facts, each recall collapsed to one line that opens on a click anywhere on it, the reason we matched it, what the FDA says, the task and **Jira's status of it**), a **New since yesterday** card (the devices a recall started to affect in the last 24 hours), a **Progress** tab (how much of the work is done: the overall share resolved, and each open recall and each ward with its tasks to do, in progress and done and the devices with no task yet), a **Ward teams** tab, a collapsed **Recent FDA device recalls** section, and a first-run screen with **Load demo hospital**. A **...** menu holds **Import devices** (paste from a spreadsheet: before anything is imported you see how each of your columns was understood and the first rows, with line-numbered problems), **Create Confluence pages**, **Daily alerts…** and **Remove devices…**. The issue panel is a compact card: the headline, the three most urgent devices, **Open dashboard** and **Create all N tasks…** (a pop-up that asks first). |
| **Latest recalls** | Lists the newest FDA device recalls: recall number, firm, product, class, date. On the dashboard it is the collapsed **Recent FDA device recalls** section, and the list is requested from the FDA only when you open it, not on every page view. |
| **Hospital devices** | Stores the hospital's devices in Forge storage. **Load demo hospital** adds 30 sample devices. |
| **Check devices for recalls** | Finds recent recalls for the hospital's manufacturers and models and matches them to devices with a confidence level and a reason. |
| **Create task** | For each exact or likely match, creates a Jira task (one, or all at once) with the ward, the reason, a link to the FDA recall and a due date based on the recall's class. Never twice for the same recall and device. |
| **Ward teams** | Map each hospital ward (ICU, ER, ...) to a **Teamwork Graph team**. The team list is read from the graph; the mapping is saved in Forge storage. Match rows and the device drawer then show the team name and a suggested assignee. See "Teamwork Graph (read-only)". |
| **Daily alerts** | Every day, after the check, RecallRadar finds the recalls that have **started to affect a device** since the last look, creates the Jira task for each (never twice) and posts **one comment** on an issue the team follows, so nobody has to open the dashboard to hear about it. A Jira administrator turns it on and chooses the project; saving tests that the app user may create issues there, and **Run now** tries it without waiting a day. Nothing is created for what is affected today: alerts start from the moment they are switched on. Details: [`docs/ALERTS.md`](docs/ALERTS.md). |
| **Create Confluence pages** | Pick a space and a recall (or all open ones): one Confluence page per recall with what is wrong, what to do, affected devices and live task cards. Running it again updates the page. Needs the optional Confluence connection (see the quick start); without it the dialog says how to connect it. |
| **RecallRadar Assistant** | A Rovo agent that answers questions about recalls from the saved check, explains them in plain English, and creates Jira tasks after you confirm. See "The Rovo agent". |

## How matching works

A match is built from facts, each checked on its own:

1. **UDI-DI**: the device's Unique Device Identifier (a GS1 GTIN) is written in the recall's code info, in any of the shapes the FDA uses (`(01)00884838085282(21)209`, `UDI-DI: 10889942499953(each)`, `GTIN: ...`, `MMT-1885CLW/00763000442187`). It names the exact product version whoever sold it, so no maker or model text is needed and a recall filed under a parent company is still found. Check digits are verified on the device list you import.
2. **Manufacturer**: the device's maker equals the recall's *recalling firm*.
3. **Model**: the device's model number is written in the recall's product description or code info.
4. **Lot/serial**: this unit's number is listed in the recall's code info, falls inside a **serial range** the recall states (`serial numbers 1000 through 1500`, `serial number < 2224`), or the recall says it covers *all* units.

Each (device, recall) pair gets **at most one result: the strongest rule that applies**. The code is in [`src/matching.js`](src/matching.js); each rule is explained next to the code that implements it.

| Confidence | Rule | Needs | Why we trust it this much |
| --- | --- | --- | --- |
| **Exact** | `exact-udi-unit` | UDI-DI listed + this unit's lot/serial listed or in a stated range | The product version and the unit both agree. |
| **Exact** | `exact-udi-all` | UDI-DI listed, and the recall covers all units | Every unit of that product version is affected. |
| **Exact** | `exact-manufacturer-model-lot` | Manufacturer + model + this unit's lot/serial all listed | All three identifiers agree. |
| **Exact** | `exact-manufacturer-model-range` | Manufacturer + model + this unit's serial inside a range the recall states | The recall describes the affected units as a range, and this unit is in it. |
| **Exact** | `exact-manufacturer-model-all` | Manufacturer + model, and the recall covers all serial/lot numbers | Every unit of that model is affected, so the unit's own number does not matter. |
| **Likely** | `likely-udi` | UDI-DI listed, but this unit's lot/serial is not | The product version is recalled; we cannot confirm this unit is in the affected batch. |
| **Likely** | `likely-manufacturer-model` | Manufacturer + model, but the unit's lot/serial is not listed (or not recorded) | The model is recalled, but we cannot confirm this unit is in the affected batch. A person should check. |
| **Likely** | `likely-manufacturer-lot` | Manufacturer + lot/serial, but the model is not mentioned | Some recalls only list serial numbers. The serial and maker agreeing is strong, but not conclusive. |
| **Possible** | `possible-model-other-maker` | A distinctive model number, but a *different* recalling firm | Parent companies, distributors and relabelled products are recalled under another name. Worth a look. |
| **Possible** | `possible-manufacturer-type` | Same manufacturer + same kind of device, model not mentioned | The weakest signal: the maker has a recall for this kind of device. |

If no rule applies, nothing is reported. The app looks back **three years** (recalls often stay open that long) and pages through busy searches (up to 100 recalls each); a search that is still capped is flagged on the dashboard.

Each check, every number and the reasons: [`docs/MATCHING.md`](docs/MATCHING.md).

### How accurate is it?

Measured against **2,354 labeled pairs** of a device and a real FDA recall (40 recalls frozen from openFDA, 410 devices built from what each recall says, plus 1,946 unrelated pairs): **exact** is right **100.0%** of the time and finds **98.6%** of the affected units, **likely** 99.3% / 100%, **possible** 100% / 100%; it never says *exact* for a unit that is not confirmed (0 of 2,354), and no unit that needs a task is missed or invented. The one miss is a 3-character serial without a UDI-DI, which the matcher refuses to trust on its own. The labels were written by the developer from the recall text, so this is a regression set and a check of how the rules read real recall wording, **not** a measure of how often the app is right in a hospital. Every pair, every limit and how to re-run it (`npm run eval`): [`docs/ACCURACY.md`](docs/ACCURACY.md).

## The check runs in the background

A Forge UI function is cut off at 25 seconds and a cold check takes 10 to 15 seconds (and could take longer), so the check is a background job: Refresh (or loading the demo hospital) queues it and returns at once, a queue consumer with a 300-second limit does the work, and the page shows "Checked N of 24 FDA searches". The result is saved for 6 hours, shown the moment you open the page, and refreshed once a day. The design, its rules and the measurements: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

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

The due-date rule, how duplicates are prevented and the limits: [`docs/TASKS.md`](docs/TASKS.md).

## Teamwork Graph (read-only)

RecallRadar reads from the Teamwork Graph as the signed-in person, and never writes to it. Four read-only queries: a person's **teams** and a team's **members** map each hospital ward to a team and suggest, never impose, an assignee (the team member with the fewest open RecallRadar tasks); the **Jira projects a team works in, with each project's lead**, and the **open Jira work assigned to each member** answer "who owns this ward, and how busy are they?" in the recall drawer's **Who handles this ward** card (read when you open it, shown to you, never saved). The Rovo agent's `who_handles_ward` gives the same picture. Nothing is assigned unless you choose **Create and assign to …**, and nothing about a person is stored. The exact queries, what is stored and what was verified live: [`docs/TEAMWORK_GRAPH.md`](docs/TEAMWORK_GRAPH.md).

## The Rovo agent

**RecallRadar Assistant** is a Rovo agent (open it with **Ask Rovo**, then pick it from the agent list). It answers only from the **saved recall check**, the same data as the panel: it never calls openFDA, so answers are fast and consistent.

| Action | What it does |
| --- | --- |
| `list_open_recalls` | Devices with an open recall that matches **exact** or **likely**, most serious first. Filter by `ward`, `recallClass`, `confidence`. |
| `check_device` | Given a model, serial/lot or device id, says whether the device matches any recall. Only devices in the hospital list can be checked. |
| `create_remediation_tasks` | Creates Jira tasks (the same code as the panel's buttons, so never a duplicate). **Preview first, then confirm** (see below). |
| `recall_details` | Explains one recall: what is wrong (the FDA's own reason text), how serious, which devices and wards, what to do, links, and any existing task. |
| `create_recall_page` | Writes a **Confluence page per open recall** (see below). The dashboard's **...** menu item **Create Confluence pages** runs the same code. |
| `who_handles_ward` | Which **Teamwork Graph** team handles a ward, who is in it, and who to suggest. Read-only; if the ward has no team it says so and never guesses. |

Each action is an `action` module (a reusable Rovo action other agents can call) and all six are grouped in one `rovo:skill`, `recall-triage` ([`skills/recall-triage/SKILL.md`](skills/recall-triage/SKILL.md)). The logic is in [`src/agentTools.js`](src/agentTools.js) (pure, unit tested); [`src/rovoActions.js`](src/rovoActions.js) is the thin Forge handler layer.

**Starter questions** on the agent: "Which Cath Lab devices have open Class I recalls?", "Do any of our devices match an FDA recall?", "Is the device with serial 50003704 affected by a recall?", "Explain the most urgent recall in plain English", "Create tasks for the Class I recalls in the Cath Lab". (The demo hospital's Class I recalls are in the Cath Lab and Respiratory; its ICU devices have none, so the first starter would answer "none" there.)

### Never invented

Every answer carries a `citations` list: the only recall numbers and device ids the agent may quote for that answer. The agent's prompt forbids inventing a recall number, device id, serial, Jira key or link, and tools say so plainly when nothing is found (an unknown device, a recall that matched nothing, no saved check yet). An exact match means manufacturer, model and serial/lot are all listed; a likely match is always described as needing a manual check.

### Creating tasks: preview, then confirm

Forge has no built-in "ask first" setting for an action, so the action itself enforces it:

1. Called **without** `confirmed`, `create_remediation_tasks` only **previews**: the task titles, wards, due dates, the project, anything that already has a task, and a one-time `confirmationToken`. Nothing is created.
2. The agent shows that preview and asks "Shall I create these N tasks?"
3. Only after you say yes does it call the action again with `confirmed=true` and the token. The server creates **exactly the previewed tasks**, whatever else the call asks for. The token works once and expires after 10 minutes.

Assigning is optional: with `assignSuggested` the preview also shows a **proposedAssignee** per task (from the ward's Teamwork Graph team) and the rule used; confirming looks the people up again from the ward's team (nothing about a person is stored in the preview) and checks that each is still in the team. See "Teamwork Graph (read-only)".

So the agent cannot create a task it has not previewed, and a made-up or reused token creates nothing. Whether the agent actually *asks you* is enforced by its prompt, and was checked in Rovo chat. Rovo also shows its own "Please review" card for any `CREATE` action, so you approve twice (in chat, then on the card). Tasks are created **as you** (the reporter is the person chatting), and at most 20 per confirmation; a larger selection says how many were left out.

### Confluence pages: one per recall

`create_recall_page` (ask the agent: "Create a Confluence page for recall Z-0208-2027", or "Make pages for all open recalls") writes **one Confluence page per open recall** that has an exact or likely match. Each page, titled `FDA recall <number>`, has:

- the recall's class and what that class means, the firm, product, dates and status;
- **What is wrong**: the FDA's own reason text from the saved check;
- **What to do**: the same steps as `recall_details` (find the device, the due date for the class, read the manufacturer's notice, record what was done);
- **Affected devices**: a table of device id, name, ward, serial/lot and match confidence, with a **live Jira card for each device's task** (status included) or "no task yet";
- **Sources**: the openFDA record for that recall and FDA's recall database.

How it behaves:

- **One page per recall.** The page is found again by its title inside the space, so running it again **updates** that page (a new version) and never makes a second one. Task links and the device table are refreshed from the latest saved check.
- **It never guesses the space.** Without a `spaceKey` it lists the spaces you can see and the agent asks which one. The agent also says which recalls and which space, and waits for a yes, before writing. Rovo adds its own "Please review" card, as with any `CREATE` action.
- **The pages contain device ids, wards and serial numbers**, so choose a space whose permissions suit that. Pages are written as the person chatting, so Confluence's own permissions decide where they may write.
- Up to 10 pages per call; the answer says how many were left. Every piece of FDA or hospital text is HTML-escaped before it goes in the page.
- Only open recalls with an exact or likely match get a page; possible matches and finished recalls do not.

Confluence is an optional connection of the app (see "One installation for Jira, Confluence and Rovo Home" below). The page tools need it, and the scopes `read:space:confluence`, `read:page:confluence` and `write:page:confluence`. On a site where it is not connected, the dashboard dialog and the agent both say so and give the admin steps; nothing else is affected.

Checked in Rovo chat on the demo site: the agent asked for a space (listing the real ones), asked to confirm, created the page in Mobile Development, and a second request updated the same page to version 2 (still one page) and returned a working link. The rendered page was inspected in Confluence. After the move to one shared installation (2026-11-16), the same request from **Rovo Home** updated that page again (still one page).

### One installation per site

RecallRadar is one Forge installation per site (Jira required, Confluence optional), so the Jira dashboard, a Rovo chat started anywhere and Rovo Home all read the same devices and show one agent. How and why, and what was checked live: [`docs/INSTALLATION.md`](docs/INSTALLATION.md).

### Limits

- **Answers are only as fresh as the saved check** (6 hours; the answer says how old it is, and the panel refreshes it). A check saved by an older version has no per-recall reason text, so refresh it once in the panel.
- **Per site.** Devices, saved checks and ward teams belong to one Atlassian site (Forge storage is per installation). A second site starts empty.
- **Only devices in the hospital list** can be checked, against recalls the check found for them.
- **Action inputs are plain text, numbers or true/false** (Rovo does not allow lists), so "which matches" is chosen with filters: recall number, device id, ward, class.

## Connect other agents (MCP)

The `recallradar-mcp` module (`rovo:mcp`, a Preview feature of Forge) exposes **four** of the actions to other agents:

| Tool | What it does |
| --- | --- |
| `list_open_recalls` | Devices with an open exact or likely recall match; filter by ward, class, confidence. |
| `check_device` | Does this model / serial / device id match any recall? |
| `who_handles_ward` | Which Teamwork Graph team handles this ward, who is in it, and who to suggest (read-only). |
| `create_remediation_task` | Creates **one** Jira task for **one** recall and **one** device (`recallNumber`, `deviceId`, `projectKey`, all required). |

They are the same tools as the in-Jira agent, so they read the **saved recall check** (never live openFDA) and answer with `citations`. Only four are exposed, on purpose: reading (including who handles a ward), and creating a single task. The single-task tool never assigns anyone. The agent's preview-then-confirm action (`create_remediation_tasks`, which can make up to 20) stays private to the RecallRadar Assistant. External clients show the user each tool call and ask before running it, and one recall plus one device fully defines the task, so the single-task action needs no preview step of its own. It never creates a duplicate; it only accepts exact or likely matches of open recalls; and it creates the task **as the person using the client**, so Jira's own permissions apply.

### Inside Atlassian: other Rovo agents

The tools can be added to agents you build in Rovo Studio, with no setup beyond installing the app.

Step by step for Claude Desktop, Claude Code, Cursor and others: [`docs/MCP.md`](docs/MCP.md).

### What was and was not verified

- Verified: the module and the single-task action deploy and pass Forge's linter, the three tools are unit tested, the same actions work in Rovo chat on the demo site, and the admin page (steps above) shows the app at the new version with the **Tools** switch, *Disabled* until an admin chooses to enable it.
- **Not verified:** a real external client connection (Claude Desktop, Claude Code). It needs a site admin to switch the tools on and an interactive OAuth sign-in, so it has not been run. Step-by-step instructions for a live demo are in [`docs/mcp-demo.md`](docs/mcp-demo.md). The Claude Desktop steps are the standard remote-MCP setup rather than something Atlassian documents for Forge apps, so treat them as untested.
- Rovo shows its own "Please review" card for `CREATE` actions in chat; whether external clients get an equivalent prompt is up to the client.

### The 17 Nov 2026 additions (UDI-DI and serial-range matching, task progress, daily alerts, ward ownership from the graph, import preview)

- **Verified live (demo site, development environment, version 16.0.0):** the upgrade with the two new graph scopes (`read:graph:issue:jira`, `read:graph:project:jira`) went through, and in Rovo chat the agent's `who_handles_ward` answered for the Cath Lab with the team (Team Atlas), each member's open Jira work read from the Teamwork Graph (0 and 0, which agrees with Jira: one person has two assigned issues, both done, the other none) and, correctly, no project (this team has none linked). The app's log shows the call and no error. The matching engine was run against the live openFDA API: 30 demo devices, 208 matches, no failed searches (`scripts/preview/fixtures/demo.json` is that result).
- **Not verified live, and why:** the dashboard itself (the Progress tab, New since yesterday, the Daily alerts dialog and its permission test, the "Who handles this ward" card, the import preview) could not be opened on a real site from the machine used to build this, because its DNS refuses Forge's CDN host (the known problem described in the developer notes; the app is not at fault and nothing on the machine was changed). They are verified in the preview (the real production bundle in headless Chrome under the Forge content policy: 148 screens, no policy violation, no console error, no accessibility violation) and in 737 unit tests with fakes. **The daily alert's real run, creating tasks as the app user and posting the comment, has not been run on a real site**: it needs a recall that is new since the last look, and importing devices deliberately does not count as news.
- **Production:** the new major version (new scopes) is deployed to development only; a production deploy and `forge install --upgrade` of existing production installs are still to do.

## Develop

Node 22+ and the Forge CLI. `npm install`, `npm test` (unit tests, no network), `npm run typecheck` (the JSDoc types, checked by `tsc`: the core matching code strictly), `npm run test:ui`, `npm run test:preview` (the real bundle in headless Chrome). The app is multi-app compatible (Jira required, Confluence optional): install it in Jira first, then connect Confluence. Everything else, including the project layout: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Permissions

| Scope / permission | Why |
| --- | --- |
| `read:jira-work` | Jira issue panel; finding existing RecallRadar tasks. |
| `write:jira-work` | Creating tasks (as the clicking user). |
| `read:space:confluence`, `read:page:confluence`, `write:page:confluence` | The Confluence recall pages: list spaces, find a page by title, create or update it (as the person chatting). |
| `read:graph:team:atlassian`, `read:graph:user:atlassian` | Teams a person is in, the members of a team, and (for the project lead) a person's name: read-only Teamwork Graph queries, run as the signed-in person. |
| `read:graph:project:jira`, `read:graph:issue:jira` | The Jira projects a team is linked to (and each project's lead) and the Jira work assigned to a person, for the recall drawer's "Who handles this ward" card. Read-only, as the signed-in person; the graph returns only what that person may see. |
| `storage:app` | The device list, the saved check, and the ward-to-team mapping in Forge storage. |
| External fetch: `api.fda.gov` | Recall data from openFDA. |

## Data and trust

- **No patient data.** The app stores equipment information only: device name, type, manufacturer, model, serial or lot, ward, the saved check, and the ward-to-team mapping. Do not enter patient data.
- **Where it lives.** Forge app storage, inside Atlassian's infrastructure and scoped to the site. Uninstalling removes it.
- **No personal data in storage.** The app never saves an Atlassian account id, name or email. Account ids and names are read from the Teamwork Graph only while you use the feature, and the Rovo task preview stores just ids of devices, recalls and the project, not people.
- **Retention.** The saved check result and the finished-job copy of it are deleted after **24 hours**; task previews are deleted when used or after 10 minutes; task duplicate-guards after 2 minutes; the daily-alert record (which recall and device pairs have been seen, ids and times only, and the last run's counts and Jira issue keys) after **7 days** without an update, and when the devices are removed. A daily clean-up job deletes anything left over. The device list, the ward-to-team mapping and the administrator's alert choices (project key, issue key) stay until you remove them or uninstall. Jira tasks and Confluence pages are your content and stay.
- **What leaves Atlassian.** Only searches to `api.fda.gov` that contain manufacturer and model names and the UDI-DIs (device identifiers) of your devices. For that reason the app is **not** eligible for "Runs on Atlassian".
- **Acts as the person.** Tasks, pages and Teamwork Graph reads run as the signed-in user, so their permissions apply. The one exception is the **daily alert**, which has no signed-in person and acts as the app itself in the project an administrator chose (checked when the choice is saved). The Teamwork Graph is only read, never written.
- **No certification claims.** This README does not claim HIPAA or any other certification.
- Draft [privacy policy](https://github.com/princejsps12-ux/recallradar/blob/main/marketplace/PRIVACY.md) and [terms](https://github.com/princejsps12-ux/recallradar/blob/main/marketplace/TERMS.md).

## Support

- Support contact: _to be filled in by the app owner before the Marketplace listing_ (see [`marketplace/SUBMIT.md`](marketplace/SUBMIT.md)).
- Tests: `npm test` runs the unit tests with no network or extra packages.
- For Forge platform help see [Get help](https://developer.atlassian.com/platform/forge/get-help/).

## More documentation

| Page | What is in it |
| --- | --- |
| [`docs/MATCHING.md`](docs/MATCHING.md) | Each fact check, every threshold and why, ordering, known limits |
| [`docs/ACCURACY.md`](docs/ACCURACY.md) | Precision and recall per match level on 2,354 labeled pairs from real recalls, every wrong pair, the limits of the measurement |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The background check job, its rules and measurements |
| [`docs/TASKS.md`](docs/TASKS.md) | The due-date rule, how duplicates are prevented, tracking tasks to closure, limits |
| [`docs/ALERTS.md`](docs/ALERTS.md) | What "new" means, what the daily run does, who it acts as, what it stores, limits |
| [`docs/TEAMWORK_GRAPH.md`](docs/TEAMWORK_GRAPH.md) | The four Teamwork Graph queries verbatim, what is stored, what was verified |
| [`docs/MCP.md`](docs/MCP.md) | Connecting Claude Desktop, Claude Code, Cursor and others |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Demo hospital, project layout, build, deploy, tests |
| [`docs/INSTALLATION.md`](docs/INSTALLATION.md) | One installation for Jira, Confluence and Rovo Home, and connecting Confluence |

