# RecallRadar: Devpost submission text

Atlassian Codegeist 2026, category **Specialized Industries** (healthcare). Copy each block into the matching Devpost field.
Numbers marked with the file they come from are checked by tests in this repository; re-read them before submitting.

## Project name

RecallRadar

## Tagline (under 60 characters)

FDA device recalls, matched to your devices, with proof, in Jira

## Elevator pitch (about 200 characters)

RecallRadar compares FDA medical device recalls with the devices a hospital owns, says how sure each match is and why, and turns every match into a Jira task due by the recall's class.

## Inspiration

A device recall can mean serious harm or death. When the FDA recalls an infusion pump, a ventilator or a heart pump, the hospital that owns one has to find it: the right maker, the right model, and often the right serial number or lot, among thousands of devices. Clinical engineering teams do that by hand, from spreadsheets, against a feed that changes every week. A missed match is a patient-safety risk; a slow one is a compliance problem.

Those same clinical engineering and IT teams already run their work in Jira and Jira Service Management. The recall, the proof that a device is affected, and the follow-up task should live where the work is tracked, not in a spreadsheet next to it.

## What it does

RecallRadar is a Forge app that works in four places on one installation:

- **A dashboard and an issue panel in Jira.** "about 25 of the 30 demo devices need action" (the exact number follows the day's FDA data), the most serious first. Every match says how sure it is and why: *exact* (maker, model and the unit's serial or lot are all in the recall, or its UDI-DI is), *likely* (the product matches, check the unit) or *possible* (a related product, no task). A drawer shows each recall, what the FDA says is wrong, and the reason for the match.
- **Tasks that close the loop.** One click creates a Jira task per affected device and recall, in the project you choose, due 2 days out for Class I and 7 for Class II and III, with the ward, the reason and a link to the FDA record. Never twice for the same pair (it checks Jira itself). A **Progress** tab shows how much is resolved, by recall and by ward, from Jira's own status.
- **Daily alerts.** Every day it checks again. When a recall *starts* to affect a device, it creates the task (as the app) and posts one comment. The first look is a baseline, so switching it on never floods a project.
- **A Rovo agent and MCP tools.** The *RecallRadar Assistant* answers from the saved check, with a list of the only recall numbers and device ids it may quote, and creates tasks only after a preview and a confirmation. The same tools are exposed over MCP, so Claude Desktop can ask "Are any of our infusion pumps recalled?" and get real recall numbers.

It also reads teams and people from the **Teamwork Graph** (read-only) to say who handles a ward and how busy each person is, writes one **Confluence** page per recall on request, and imports a pasted spreadsheet of up to 1,000 devices with a preview of how each column was read. A 1,030-device list was imported and checked live on the demo site (894 devices needed action, 2,342 matches).

## How we built it

- **Forge, Custom UI (React)** with Atlaskit components and design tokens only, so the dashboard follows Jira's light and dark themes. Resolvers for the page, a **queue consumer** (300 s) for the check because a UI function is cut off at 25 s, a **scheduled trigger** for the daily refresh and alerts, a **Rovo agent with six actions and a skill**, a **`rovo:mcp` module**, Forge storage (`@forge/kvs`) and the Jira, Confluence and Teamwork Graph APIs. Tasks are created as the signed-in person; only the daily alert acts as the app.
- **Pure logic, thin Forge shells.** Matching, UDI parsing, serial ranges, alert state, task rules and the rest are plain modules with injected storage and fetch, unit tested without Forge (800+ tests), type-checked from JSDoc (the core strictly), linted, and run in CI. A headless-Chrome preview harness serves the real production bundle under Forge's content policy and checks every screen in light, dark and phone width for policy violations, console errors and accessibility.
- **A matcher built on facts, not scores.** Ten rules, UDI-DI first (a GS1 GTIN names the product version exactly, whoever sold it), then maker plus model plus the unit's serial, lot or range. It understands recalls that list several products (a lot of one never confirms another), recalls that leave units out ("except", "not affected"), umlauts, and companies that go by two names (BD and Becton Dickinson, Hill-Rom and Baxter).
- **Measured, not claimed.** `docs/ACCURACY.md` is generated from 48 real openFDA recalls and about 3,400 labeled pairs, with the right answer decided before the matcher is asked. It never called a device *exact* when it was not, and no pair that needs a task was missed; every miss is named. The page says what it does not measure.
- **Private by construction.** No patient data. The only thing that leaves Atlassian is searches to openFDA with manufacturer names, model names and UDI-DIs. Nothing about a person is stored (ids of devices and recalls only); the saved check is deleted after 24 hours.

## Challenges we ran into

- **A check that works on a laptop and dies on the platform.** Opened for the first time on a real site, the background check was killed for memory: one real recall has 8.9 million characters of serial numbers and the check held 50 MB of answers and split them into millions of words per device. We found it by running the app live, fixed it (each answer is used and released at once; texts are searched as text; matching went from 21 s to 2 s) and documented it.
- **Recalls are written for people.** One text names several products, each with its own lots, in sentences with no pattern; another says "all units except those with software 1.05.06.00". Our first rule for several products cut the text at every full stop and judged real recalls against the wrong lots. Adding real recalls to the evaluation found it, and it is fixed and guarded.
- **Concurrency without transactions.** Forge storage has no compare-and-set, so a lease lock and an atomic claim keep two writers from losing each other's updates; a record that cannot be read is never treated as empty.
- **A platform that is smaller than a laptop.** A Forge function is killed near 250 MB and runs 20 to 40 times slower than a laptop. Making the check fit took parsing each answer as it arrives, a cap on very long serial lists, a 45-second limit per request, and a matcher that compares each group of identical devices once (1,000 devices: 43 s to under 1 s locally).
- **A Teamwork Graph that suddenly refused everything.** Forge sent the installation's Jira site address as the query context; the graph wants the platform site address. Calling the same query from the browser console with each address found it, and the fix is one header.
- **Honest limits.** The Teamwork Graph is a preview API, a Forge UI function cannot run longer than 25 seconds, and the anonymous openFDA allowance is small; the README says what was not verified live.

## Accomplishments that we are proud of

- A matcher whose answer comes with a reason, whose "exact" has never been wrong on the evaluation set, and whose weaknesses are published instead of hidden.
- One installation that serves a Jira dashboard, an issue panel, a Rovo agent and an MCP server from the same data and the same code, with the same "never twice" and "never invented" rules in all four.
- A review loop that found real defects (memory, mixed saved results, a crashed lock holder, wordings that read "not affected" as "affected") and fixed them with tests.

## What we learned

Run it for real, early. Fakes have no memory limit, no slow network and no real error codes. And a measured "we do not know" beats a confident number: the accuracy page lists its own limits, and that is what made the matcher better.

## What's next

A read-only import from Jira Service Management Assets, so the device list is the CMDB; a maker alias list that hospitals can extend; a history of progress over time; ruling a unit *out* when a recall's range excludes it, once that can be done without hiding a real recall.

## Built with

Atlassian Forge, Forge Custom UI, React, Atlaskit, Rovo agents and actions, Forge MCP (`rovo:mcp`), Jira Cloud REST API, Confluence REST API, Teamwork Graph, Forge storage (`@forge/kvs`), Forge queues and scheduled triggers, openFDA device enforcement API, Node.js, JSDoc with TypeScript checking, Puppeteer (preview harness), axe-core.

## Try it out

- Code: https://github.com/princejsps12-ux/recallradar
- Install link and a ten-minute walkthrough: the README, section "Judge quick start". The link opens the **production** distribution of the app ("Get app", then pick the site).
- Demo hospital: open **Apps**, **RecallRadar**, **Load demo hospital**. No account elsewhere is needed; Rovo and Confluence are optional.
- Test data: the 30 demo devices use real manufacturer and model names from actual recalls.

## Notes for the judges

- **Not eligible for "Runs on Atlassian".** The app calls api.fda.gov, so it declares that egress.
- **What a judge must do:** install as a **Jira administrator** (the app asks for Teamwork Graph scopes, which an organization admin must approve); the first person to open **Apps, RecallRadar** loads the demo hospital; **Ward teams** needs the signed-in person to be in a team; **Rovo** needs a site with Rovo; **Confluence pages** need the optional Confluence connection; **MCP** needs the site admin to switch on the app's tools.
- **What was verified live and what was not:** see the README sections "What was and was not verified" and "Live run on the demo site". In short: the dashboard (light and dark), the background check (also on the production site), the daily alert (it created a task and a comment on its own), the 1,000-row import, the Teamwork Graph and the Rovo agent were run on a real site; an external MCP client (Claude Desktop) needs a site admin to switch the app's tools on and has not been run end to end by the author.
- **Team and ownership:** Prince Pandey, princejsps12@gmail.com.
