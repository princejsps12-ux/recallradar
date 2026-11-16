# Strict review against the five Codegeist criteria

Written 15 November 2026 by the assistant, scored hard on purpose. Evidence is in the repository and the README.

| Criterion | Score | One line |
| --- | --- | --- |
| Technical implementation | 8 / 10 | Deep, tested, safe; a few things unproven live |
| Design | 7.5 / 10 | Polished dashboard, seen live on desktop and phone width; still hand-styled, no dark-mode or screen-reader pass |
| Potential impact | 7 / 10 | Real problem, honest scope, but data entry is thin |
| Innovation (quality of idea) | 8 / 10 | Explained matching and trust rules are the differentiator |
| Presentation | 5 / 10 | The weakest area: no video, no screenshots, install link and support contact still blank |

## Technical implementation: 8

**Strong:** matching with named rules and reasons; a background job (queue consumer, daily trigger, 6-hour saved result) that avoids Forge's 25 s limit; 496 unit tests including cases that must not match; tasks never duplicated (Jira search plus a guard) and rebuilt on the server, never trusted from the browser; preview-then-confirm with one-use tokens; assignees re-checked against the Teamwork Graph; read-only Teamwork Graph with the exact calls documented; Rovo agent, skill, MCP module, Confluence pages, dashboard and panel from one codebase; least-privilege scopes (unused Assets scopes removed).

**Weakest points**
1. The MCP path was never run by a real external client (needs an admin switch and consent). *Cannot fix alone; `docs/mcp-demo.md` is the plan.*
2. Not eligible for "Runs on Atlassian" because of the openFDA egress. *Inherent; documented.*
3. Each openFDA search reads only the newest 25 recalls, so older ones may be missing. *Documented in the panel and README; a pagination fix is possible later.*
4. The paste-in device import and the dashboard's import screen were verified by unit tests and a clean build, not clicked live (the browser tool was offline). *Verify once.*
5. One real assignment was verified; the "create all with assign" checkbox was not.

## Design: 7

**Strong:** the dashboard uses Atlassian design tokens (light and dark) with light fallbacks, summary cards, labelled badges (colour is never the only signal), filters with a live "Showing N of M" status, loading skeletons instead of a bare "Loading", a proper success state, first-run, error and import screens, a visible keyboard focus ring, hover and disabled states, a sticky table header with an accessible caption, reasons shown in the table, reduced-motion support, and a narrow-screen layout that hides secondary columns. The panel uses the same tokens. `npm run test:ui` clicks these flows in a simulated browser.

**Why not 8 yet (honest)**
1. **Seen live on desktop and at 430 px wide** (the phone layout hides the Team column and the table fits), but **not in dark mode**.
2. Built from plain HTML elements, not Atlaskit components, so it is close to but not exactly Atlassian's look. *The step that would most raise the score.*
3. The issue panel is still dense (several buttons per match row); the ward-to-team mapping is 14 native dropdowns in the panel and is not on the dashboard.
4. No screen-reader pass and no designer review.

**Found by looking at the live page, and fixed:** the shared stylesheet was not being applied at all, because Jira's iframe ignores a `<style>` element (only `style="..."` attributes and constructable stylesheets work). That made the hidden table caption visible and switched off the focus ring, hover, shimmer and responsive rules. The CSS is now installed through `adoptedStyleSheets` (`Root.js`). Lesson: judge looks on the real page, not only in a simulated browser.

## Potential impact: 7

**Strong:** a real, regulated, recurring hospital task; no patient data needed; value shown in minutes with the demo hospital; tasks go where teams already work.

**Weakest points**
1. Real data arrives by paste-in spreadsheet only; no JSM Assets or CMDB sync yet (the most natural source for a hospital). 
2. No evidence from a real clinical engineering team (no quote, no pilot). *Ask one for feedback and put it in the README.*
3. Matching depends on free-text names; serial ranges ("serial below 2224") and spelling variants are not handled.
4. Free openFDA anonymous limit (about 1,000 requests a day per IP) caps scale; an API key option is not built.

## Innovation: 8

**Strong:** every match says how sure it is and why; the agent can only quote recall numbers and device ids that a tool returned (citations), and asks before creating or assigning; ward-to-team from the Teamwork Graph with an explained suggestion rule; the same tools exposed to Rovo agents and to MCP clients.

**Weakest points**
1. Reading the Teamwork Graph is useful but shallow (a team list and members; the API has no owner or role).
2. Matching is rule-based, which is deliberate and explainable, but a judge may expect "AI". The README should say why (hospitals need auditable reasons).

## Presentation: 5

**Strong:** the README is honest about measurements, limits and what was not tested; a judge quick start now exists.

**Weakest points** (most of these need you)
1. **No demo video** and **no screenshots** in the README or listing. *You: record 2 to 3 minutes (dashboard, panel, Rovo, MCP) and take the 8 screenshots in `marketplace/LISTING.md`.*
2. **The install link is not generated** and is a placeholder in the README. *You: developer console, Distribution, Sharing.*
3. **No support contact** in the README, privacy policy or terms. *You.*
4. The README is long and still mixes internals (matching constants, job measurements) with the first-time path; the quick start helps, but an "Under the hood" split into `docs/` would help more.
5. Some numbers vary between sections because they came from different test runs (check times, task counts). *Label or unify.*
6. ~~Marketplace icon needs a 144 x 144 PNG~~ Done: `marketplace/icon-144.png`.

## Fixed during this review

- Dashboard added, with a first-run screen and a paste-in import for the hospital's own devices (the biggest impact gap).
- Unused Assets scopes removed (least privilege).
- README: judge quick start, prerequisites, expected results, safe-try and cleanup note, glossary, data-and-trust section, dashboard and import documented, first-person phrasing removed.
- Panel moved to design tokens (dark mode); dashboard polish (skeletons, focus, hover, responsive, accessible table, success state); a browser-free UI smoke test.
- Marketplace listing, privacy, terms and MCP demo guides written.

## Design review: method, scores and what is left

**Method.** Each round, three fresh reviewers (no context, screenshots only, same fixed rubric of eight items, 1 to 10, "10 = indistinguishable from Atlassian's best work") scored a full set of screenshots: light, dark and phone width, the dashboard, drawer, ward tab, issue panel, dialogs, loading and error states. The score is the average of the three. Earlier rounds used ONE reviewer: those scores (6.5, 7.2, 7.4, 7.5, 8.3, 8.0) swung by about 0.5 from reviewer to reviewer, so the 8.3 was luck. The honest level is about 7.1 to 7.2.

| Round (screenshots) | Reviewer averages | Mean |
| --- | --- | --- |
| A (`marketplace/screenshots/r8`) | 6.50, 6.81, 6.94 | 6.75 |
| B (`r9`) | 7.13, 7.38, 6.81 | 7.10 |
| C (`r10`) | 7.19, 7.19, 6.94 | 7.10 |
| Final (`r11`) | 7.00, 7.50, 7.06 | **7.19** |

Target was 9.5. Not reached. Per item, final round (mean of three, then who can move it):

| Item | Mean | Kind | Why |
| --- | --- | --- | --- |
| Visual hierarchy | 7.8 | (a) fixable, partly (c) | Stat cards repeat the hero; "Recent FDA recalls" table is as loud as the work list |
| Clarity of main action | 8.0 | (a), partly (c) | Several secondary buttons per row; drawer has a second primary |
| Consistency with Atlassian design | 7.2 | (b) and (a) | Lozenge look, dark primary colour and scrim are stock Atlaskit tokens; pagination, danger dialog title icon and button heights are ours to fix |
| States (loading, empty, error) | 6.7 | (a) | Only loading and one error shot exist; no empty, failed-check or stale shot; the two loading shots were taken at different moments |
| Dark mode | 8.0 | (b) and (c) | Lozenge saturation, primary button colour, blanket strength come from tokens |
| Responsiveness (phone) | 6.5 | (a), plus (b) for the panel | Phone drawer header; the issue panel frame has a fixed height (`viewportSize: large`), so it leaves empty space on desktop and clips on phone |
| Accessibility | 6.7 | (a), partly (b) | Targets under 32 px (pagination, chevrons, radios), 12 to 13 px grey meta text; lozenge text size is the library's |
| Polish | 6.7 | (a) | Date and time formats mixed, a firm-name casing regression ("B.v."), all-caps FDA product text, layout shift when the assign suggestion arrives |

Caveats about the measurement: the final set still contained a few stale shots (`light-phone-ward-teams` from before the select borders, `light-table` and `dark-table` from before the date format), the light and dark panel shots were taken in different data states, and the two loading shots were captured at different moments. Some deductions are therefore capture artefacts, not product defects. "Phone" shots are the Forge iframe forced to 360 to 390 px, not a real device.

### Done since (plan items 1 and 4), checked live on the demo site in light, dark and 360 px

- Item 1 (quick fixes): `niceFirm` keeps "B.V.", "USA", "GE" and company endings ("Abiomed, Inc."); `softCase` makes all-caps FDA product text readable and leaves part numbers alone ("Alphenix interventional angiography system REF: INFX-8000F"); both are unit tested in `src/textCase.test.mjs`. The remove dialog's title has the danger icon. Task buttons are one size (32 px) in rows, drawer and panel. Time reads the same everywhere ("Last checked 8 min ago", exact time in a tooltip). The panel no longer shows assignee suggestions, so nothing appears late and makes it grow.
- Item 4 (compact issue panel): headline with the Class I count, the three most urgent devices without a task (name, ward, recall, the two lozenges, no buttons), **Open dashboard** (primary) and **Create all N tasks...** (opens the same confirmation as a Jira pop-up). Measured: `viewportSize: medium` is a 262 px frame; the card is 254 px, so there is no empty space and no clipping at desktop or 360 px width. The panel also asks for less: no recent FDA list, no task counts, no ward teams, no Teamwork Graph calls (it is on every issue).

### Done since (plan items 2 and 3), checked live on the demo site in light, dark and 360 px

- Item 2 (pagination and targets): the affected-devices table sorts all rows, shows ten per page and has page numbers under it, with a live "Showing 11-20 of 35 device and recall matches" line (a filter or a new sort goes back to page 1). **Root cause found on the way:** `@atlaskit/pagination` and `DynamicTable`'s built-in pager draw their buttons with the legacy Atlaskit Button, which writes its styles at run time; the Forge iframe's CSP blocks that, so the pager showed as plain browser buttons (small, no clear current page). That matches what the reviewers marked down (small targets, a faint current page). `ui/Pager.js` now gives `Pagination` its own page and arrow buttons made from the new Button (32 px, filled blue current page), the Ward teams table uses the same pager above 20 wards. The remove dialog uses Atlaskit radios. The whole header row of a recall card is the toggle (one click target the full width of the card). Grey meta text is 14 px.
- Item 3 (dashboard hierarchy): the three stat cards are gone; the hero carries one summary line (devices monitored, open recalls by class, task counts, with its own loading, empty and error wording). "Recent FDA device recalls" is a collapsed disclosure and the list is requested from the FDA only when it is opened (fewer openFDA requests per page view). Each "Do this first" row and table row has one way in: the device name opens the details (accessible name "Details for NAME, recall NUMBER"), the "Details" buttons and column are gone. In the drawer, "Create task" becomes a split button when the Graph suggested someone, with "Create and assign to NAME" and the team as the reason in its menu; nobody is assigned unless that item is chosen.
- Not verifiable live right now: the split button. On the demo site the Teamwork Graph answers "User is not permitted to query this organization" (in the Forge logs), so there are no suggestions and the drawer shows the plain button (the designed fallback). The split button and what it sends are covered in `scripts/ui-smoke.cjs` (jsdom, stubbed suggestions), not yet seen on a live page.
- Checks added: `src/tablePaging.test.mjs` (sorting order, page clamping, ranges), the summary-line text in `src/dashboardData.test.mjs`, and jsdom checks for the summary line, no stat cards, the collapsed list and its on-demand request, the name opening the drawer, the whole-header toggle, paging, sorting over all rows, the filter going back to page 1, the split button and the remove dialog's radios (535 unit tests, all UI checks pass).
- Screenshots: `marketplace/screenshots/r13`.

Still to do: items 5 and 6 below, and the numbered Marketplace listing screenshots (`marketplace/screenshots/01` to `14`), which still show the old panel and stat cards.

Not re-scored: no new reviewer round was run after items 2 and 3 (the design loop was stopped on request). The last scored round was 7.19 (r11).

### Plan for the fixable (a) items, in order

1. **Quick fixes (small).** Repair `niceFirm` so "B.V.", "USA" and other short or dotted tokens keep their capitals; `ModalTitle appearance="danger"` on the remove dialog; one button size in rows, drawer and panel; show time the same way everywhere ("1 h ago", absolute time in a tooltip); sentence-case all-caps product text only for plain letter words of four or more letters, never tokens with digits or hyphens; load assign suggestions with the rows so the panel does not grow.
2. **Pagination and targets (medium).** Render the affected-devices table's pages ourselves and use the standalone `@atlaskit/pagination` (32 px targets, clear selected page) instead of the one built into `DynamicTable`; Atlaskit `Radio` in the remove dialog; make the whole drawer card header the toggle; 14 px for meta text.
3. **Dashboard hierarchy (medium).** Fold the stat cards into the hero as one summary line (devices, open recalls by class, tasks open); put "Recent FDA device recalls" behind a disclosure or its own tab; one action per row (the device name opens the drawer, the row keeps a single "Create task"); a split button for "Create and assign to ...".
4. **Issue panel as a compact summary card (medium to large).** Headline ("21 devices need action, 2 Class I"), three fixed-height rows with name, ward and the two lozenges (text truncates, no wrapping, no per-row buttons, no assign suggestion), and one footer: primary "Open dashboard", secondary "Create all N tasks..." (opens the same confirmation). Fixed content height means `viewportSize` can be set to fit, which removes the empty space and the clipping without needing auto-resize.
5. **Preview harness (medium).** A static page that mounts the dashboard and panel with a stubbed `@forge/bridge` and fixtures (webpack alias), driven by URL parameters (`view`, `state`, `theme`, `width`). It makes first-run, running check, empty, failed check, stale and all-done states capturable without touching demo data, gives identical light and dark shots, and lets us run axe-core in a real browser. It also regenerates the Marketplace screenshots.
6. **Bigger replacement, only if 2 does not settle it.** Replace `DynamicTable` with a plain semantic table (own sorting and paging, token styling). Do not replace `Lozenge`, `Select` or `Modal`: restyling them would make the app less Atlassian, not more.

Estimate (not measured): with 1 to 5 done, items (a) should reach about 8 to 8.5. Items (b) and (c) keep the average below 9.5 with this rubric and screenshot-only reviewers. Single-reviewer noise is about +/-0.5, so objective checks (axe, target sizes, contrast) are a better finish line than a score.
