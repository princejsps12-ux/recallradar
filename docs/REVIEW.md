# Strict review against the five Codegeist criteria

Written 15 November 2026 by the assistant, scored hard on purpose. Evidence is in the repository and the README.

| Criterion | Score | One line |
| --- | --- | --- |
| Technical implementation | 8 / 10 | Deep, tested, safe; a few things unproven live |
| Design | 6.5 / 10 | Good dashboard, dense panel, never reviewed by a designer |
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

## Design: 6.5

**Strong:** the dashboard uses Atlassian design tokens (light and dark), cards, labelled badges (colour is never the only signal), filters, and real empty, loading, error and first-run states; the panel now uses the same tokens (done in this review).

**Weakest points**
1. Built with plain HTML elements styled by hand, not Atlaskit components, so spacing and controls are close to but not exactly Atlassian's. *Fixable with Atlaskit packages; costs bundle size and time.*
2. The issue panel is dense (several buttons per match row). *A "details" view per device would help.*
3. Native dropdowns for 14 wards are tedious; a combined mapping table would be better.
4. No accessibility audit beyond labels, roles and text-not-colour; not tested with a screen reader. *Do before submission.*
5. Never checked on a phone-width viewport.

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
6. Marketplace icon needs a 144 x 144 PNG export from `marketplace/icon.svg`.

## Fixed during this review

- Dashboard added, with a first-run screen and a paste-in import for the hospital's own devices (the biggest impact gap).
- Unused Assets scopes removed (least privilege).
- README: judge quick start, prerequisites, expected results, safe-try and cleanup note, glossary, data-and-trust section, dashboard and import documented, first-person phrasing removed.
- Panel moved to design tokens (dark mode).
- Marketplace listing, privacy, terms and MCP demo guides written.
