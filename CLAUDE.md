# CLAUDE.md: RecallRadar

Forge app (Atlassian Codegeist 2026, Specialized Industries) for hospital teams: it matches FDA medical-device recalls (openFDA) to the hospital's devices and says how sure each match is and why. Shows as a panel on every Jira issue. User-facing docs are in [README.md](README.md); this file is what a new session needs to work safely.

`AGENTS.md` is generic Forge template guidance. **Where it conflicts with this file, this file wins.** In particular this app is **Custom UI (React) on purpose** (`static/hello-world/`), so AGENTS.md's "UI Kit only" rule does not apply here. Its security advice (minimal scopes, prefer `asUser`) still does.

## Commands

```bash
npm test                                   # all unit tests (Node built-in runner, no network)
node scripts/check-demo-matches.mjs        # live openFDA check of the demo hospital (needs network)

# after ANY change to static/hello-world/src, rebuild BEFORE deploying
(cd static/hello-world && npm run build)   # first time: npm install --legacy-peer-deps (template pins React 16)

forge lint
forge deploy -e development --non-interactive                 # add --approve MAJOR_VERSION_RULE when it asks (new scopes/egress/modules)
forge install --upgrade --demo-site -e development -p Jira --non-interactive --confirm-scopes   # only when scopes/egress changed
forge install list -e development
forge logs -e development -s 1h -n 40      # -s is "since", NOT site
```

Minor deploys (code only) reach the installed site by themselves; only scope/egress changes need `install --upgrade`.

## Testing rules

- **Test on the Forge demo site only** (`--demo-site`; it has Rovo, Assets and sample Jira issues). The user's personal dev site is old and outdated: do not deploy to or test on it. Ask the user for an issue URL if you need one for a browser check.
- Use Claude in Chrome (the user's real, signed-in browser) for the site, not the built-in browser. Jira may show a one-time "What kind of work do you do?" screen: that sets an account preference, so leave it to the user.
- The panel sits in an iframe with its own scroll area; scroll inside it to see long content. Browser waits are capped at 10 s per step.

## Architecture

Logic lives in **pure modules with no Forge imports**, each unit tested against injected fakes; only a few thin files touch Forge.

| File | Role |
| --- | --- |
| `src/matching.js` | The six match rules (exact / likely / possible), every threshold a named constant with its reason |
| `src/openfda.js`, `src/recallSearch.js`, `src/text.js` | openFDA URLs and parsing; which searches to run (per manufacturer + per model, 1-year window); tokenizing |
| `src/deviceStore.js` | Device list interface (Forge storage today; a read-only Assets import can plug in later) |
| `src/matchCache.js` | Saved result, 6-hour freshness, fingerprint of the device list; `peek()` also returns expired entries as stale |
| `src/checkJob.js` | The background job record (running / done / failed, progress, stale-job detection) |
| `src/matchService.js` | `requestCheck`, `performCheck`, `getCheckStatus`, `getSavedMatches` |
| `src/demoHospital.js` | 30 demo devices using real manufacturer/model names and serials from actual recalls |
| `src/runtime.js` | **Forge wiring**: storage adapter, `fetch`, `runCheck()` shared by the consumer and the daily trigger |
| `src/index.js`, `src/consumer.js`, `src/scheduled.js`, `src/kvAdapter.js` | **Forge entry points** (resolvers, queue consumer, daily trigger, storage adapter) |
| `static/hello-world/src/App.js` | The panel |

### The recall check is a background job

A Forge **UI function is cut off at 25 s and cannot be given a longer timeout** (`timeoutSeconds` is allowed only on queue consumers and scheduled triggers; the linter rejects it on a resolver). A cold check takes about 10 to 14 s on the site and could be slower, so:

1. The button calls resolver `startCheck`, which records a job and pushes `{ jobId, trigger }` onto the Forge queue `recall-check`, and **returns at once**.
2. `consumer.handler` (queue consumer, `timeoutSeconds: 300`) runs the check, writing progress to the job record after every search.
3. The panel polls `getCheckStatus` every 2 s and shows "Checked N of M FDA searches". A reload mid-check picks the job back up.
4. A finished check is saved (6-hour freshness). On open, the panel shows the saved result at once; if it has **expired** it is shown flagged "older than 6 hours" and a background refresh starts automatically.
5. A daily scheduled trigger (`scheduled.handler`) refreshes the saved result so it is usually ready before anyone clicks.

Rules that keep this correct: a result with failed lookups is shown but never saved; only the running job with the matching id may be updated (late or duplicate queue deliveries are skipped); a job with no update for 6 minutes counts as failed; the search has its own 240 s deadline inside the 300 s limit.

## Gotchas learned the hard way

- **`route` template**: only interpolate single path *segments* (ids). Interpolating a value that contains `/` throws "Disallowing path manipulation attempt".
- **`@forge/api` has no `storage`** in this version: use `@forge/kvs` (`kvs.get/set/delete/query`), scope `storage:app`.
- **Queue consumer events** carry data in `event.body` (not `payload`); `queue.push({ body })` wraps the data.
- **Scopes/egress changes make a major version** and need `--approve MAJOR_VERSION_RULE` plus `install --upgrade`. Adding the `api.fda.gov` egress made the app **ineligible for Runs on Atlassian** (a Codegeist bonus, if it applies: check the rules).
- **openFDA**: use `/device/enforcement.json` (it has recall number, firm, product, `code_info`, `classification`, `report_date`; the `/device/recall` endpoint has no class). Dates are `YYYYMMDD`. A search with no hits returns **404** (treat as empty). `code_info` can hold thousands of serials; one record (Z-1645-2026) is 8.7 MB because of an unused `openfda` sub-object, and openFDA cannot omit fields. Anonymous limit is about 1,000 requests a day per IP (a full check is about 24), which is why results are saved. Newest 100 recalls span only about a week, so match by manufacturer/model within a date window, never by "latest N".
- **Assets**: Forge can *read* Assets as the app (`read:cmdb-object:jira`, `read:cmdb-schema:jira`, workspace id from `/rest/servicedeskapi/assets/workspace`) but *creating* a schema returned 403 (Assets-administrator rights). Hence devices live in Forge storage; read-only scopes are kept for a planned import.
- **An invented serial can collide with a real one**: when adding demo devices, check them against the real recall (`scripts/check-demo-matches.mjs`).
- `forge webtrigger create` has no `--non-interactive` flag. `forge lint --fix` converts deprecated manifest forms.
- Rovo agent "RecallRadar Assistant" is only a hello-world test (`hello-action`); a free developer site has no Rovo chat, the demo site does.

## Conventions

- **Commit per finished part**, message in plain imperative English, ending with the `Co-Authored-By` trailer the harness gives. Never commit build output or `node_modules` (see `.gitignore`).
- Code comments explain *why*; no unexplained numbers (named constants with a reason). Every matching rule and every cache/job rule has unit tests, including cases that must **not** match.
- Keep the README honest: measurements, limits and "not built" lists are part of it. Update both README and this file when behavior changes.
- The user prefers short explanations before running each step, and a stop for decisions that are theirs (account preferences, new sites, anything that spends money or is outward-facing).

## Not built / ideas

Read-only Assets import; adding/editing devices in the UI; Rovo agent that answers recall questions; skipping the duplicate download of the 8.7 MB record; per-search caching; serial-range parsing ("serial number < 2224").
