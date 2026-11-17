# The preview: the real app, without Jira

This folder runs the **production bundle** (`static/ui/build`, the same files `forge deploy` ships) in a plain
browser, with a small fake in place of the Forge host. Every screen and state of the dashboard, the issue panel and the
"Create all" pop-up can be opened, captured and checked without Jira, without a deploy and without touching any real data.

It exists because of one bug class that nothing else caught. The Forge iframe's content security policy blocks `<style>`
tags written at run time, so any component that styles itself that way (Atlaskit's legacy Button, and with it
`@atlaskit/pagination` and the pager inside `DynamicTable`) shows up **unstyled** in Jira while looking fine in jsdom tests
and in a normal browser. The preview serves the app under the same kind of policy, so that failure is visible (and
reported) here instead of on the live page. Forge's own docs describe the policy and the escape hatch
(`permissions.content.styles`, which we do not use): [Forge permissions reference](https://developer.atlassian.com/platform/forge/manifest-reference/permissions),
[content security and egress controls](https://developer.atlassian.com/platform/forge/add-content-security-and-egress-controls/).

## Use it

```bash
(cd static/ui && npm run build)    # the bundle (after any change to static/ui/src)
npm run preview                             # http://localhost:4173/   (node scripts/preview/server.cjs)
npm run test:preview                        # the checks below, in headless Chrome (a minute and a half)
npm run shots                               # regenerate the Marketplace screenshots
```

Chrome must be installed (`CHROME=/path/to/chrome` if it is somewhere unusual). Everything else is in
`static/ui/node_modules` (`puppeteer-core`, `axe-core`).

Open `http://localhost:4173/frame.html?view=dashboard&state=in-progress&theme=dark`. The page shows the app in an iframe of
an exact size, so a phone width is a phone-width layout.

| Parameter | Values | Meaning |
| --- | --- | --- |
| `view` | `dashboard` (default), `panel`, `create-all` | Which Forge module: the full page, the issue panel (680 x 262, its real frame), the pop-up the panel's "Create all" opens |
| `state` | see below (default `ready`) | The starting state |
| `theme` | `light` (default), `dark` | Colour mode (the design tokens, the way Forge switches them on) |
| `width`, `height` | pixels | Size of the iframe (dashboard 1440 x 900, panel 680 x 262, pop-up 600 x 460 by default) |
| `gutter` | pixels | Space either side of the app, like Jira's own page has |
| `axe` | `1` | Loads axe-core into the page (the check script uses this) |
| `duration` | ms | How long a started check takes (default 5000) |

`/csp-probe.html` shows which ways of styling survive the policy (the evidence behind the note in `CLAUDE.md`).

## The states

The app does not run against a real backend here: `backend.js` answers every resolver (`listDevices`, `startCheck`,
`createTasks`, ...) from a snapshot of the demo hospital and its **real** check result against openFDA
(`fixtures/demo.json`). It behaves, too: a started check advances with the clock and finishes, created tasks get keys
(`BIOMED-101` and up), a task is never created twice, assignee suggestions share the work in a ward's team, Confluence pages
and imports answer the way the dialogs read them. People, teams and projects are invented.

| `state` | What you see |
| --- | --- |
| `ready` | Saved result 8 minutes old, no tasks yet, three wards have a team, the Graph suggests people |
| `in-progress` | Like `ready` with eight tasks created, three done (the best state for screenshots) |
| `new-since` | Like `in-progress`, plus three devices that became affected in the last day: the **New since yesterday** card lists them (the daily alerts are off) |
| `alerts-on` | The daily alerts are on (tasks to BIOMED, a comment to BIOMED-1); two of the three new devices already have the tasks the last daily run made. Open **Daily alerts…** from the **...** menu |
| `alerts-refused` | The alerts are on but Jira refuses the app user in the project: the last run and the **Run now** answer say what to fix |
| `all-done` | Every device that needs action already has a task |
| `first-run` | No devices: the welcome screen with **Load demo hospital** (click it: the check runs and finishes) |
| `no-check` | Devices, but no check yet |
| `running` | The first check is running, 9 of 24 searches (it stays there) |
| `refreshing` | **Refresh** was clicked: the saved result stays on screen, a new check is at 14 of 24 |
| `stale` | The saved result is 9 hours old: shown flagged "older than 6 hours" |
| `failed-lookups` | Three FDA searches failed: "Result may be incomplete" |
| `none-affected` | Nothing matches an open recall |
| `no-graph` | The Teamwork Graph refuses (no suggestions, no team list): what the demo site did on 2026-11-16 |
| `no-confluence` | Like `ready`, but the app is installed in Jira only, not connected to Confluence: the Create Confluence pages dialog says how to connect it |
| `not-admin` | Like `ready`, but the person is not a Jira administrator: Import devices and Remove devices are shut in the menu |
| `project-admin` | A project administrator, not a Jira administrator: devices are shut, ward teams can be chosen |
| `first-run-not-admin` | The welcome screen for a person who is not a Jira administrator: it says who can add devices |
| `refresh-error` | **Refresh** cannot start a check |
| `error` | The device list cannot be read: the error screen |
| `loading` | Nothing ever answers: the loading skeleton |

`src/previewBackend.test.mjs` (part of `npm test`) fails when the app gets a resolver the fake does not answer, so the
preview cannot quietly fall behind the app.

## The scripts

- **`check.cjs`** (`npm run test:preview`, `--quick` for a short run, `--verbose` for warnings). Opens every view in every
  state, in light and dark, at desktop and phone widths, then walks an interaction tour (drawer, split-button menu, every
  dialog, both tabs, the pager, sorting, filters, selects) and fails on: a content security policy violation, a console
  error, an axe-core violation of impact serious or critical (WCAG 2.0 to 2.2 AA and best practice: contrast, names,
  roles, headings), issue-panel content taller than its 262 px frame, anything wider than the screen, or a phone run
  whose frame is not really that wide. Targets under 24 x 24 px are warnings. Last run: 110 screens, all clean.
  - One known, accepted violation: opening a dialog makes `@atlaskit/modal-dialog` (through `react-scrolllock`) write a
    `body { box-sizing ... }` style, which the policy blocks. The only effect is that the page behind a dialog can still
    scroll. Any other violation fails the run.
  - Judged on the dashboard only: "one main landmark" and "everything in a landmark" (the panel and the pop-up are
    fragments of Jira's page), and "a level-one heading" (Jira's page has it).
- **`shots.cjs`** (`npm run shots`, `--only=03,11`, `--out=dir`, `--system-font`). The Marketplace screenshots in
  `marketplace/screenshots/01-...` to `19-...` and `24-...` to `28-...` (20 to 23 are taken on the demo site), captured at 2x
  (desktop 1440 x 900, panel 680 x 262, phone 390 x 844). The steps for each one (open the drawer, open the menu, choose a
  space, paste a list) are in the file, so they can be regenerated after any UI change.
- **`shot.cjs`** one image of one state, for looking at it: `node scripts/preview/shot.cjs dashboard none-affected dark --out=/tmp/x.png`.
  Also `--tab=Progress`, `--menu="Daily alerts"` (opens a dialog from the "..." menu), `--run="Run now"`, `--drawer="Impella Controller" --people`
  and `--paste='csv text'` (types into the import dialog), so one command reaches any screen.
- **`font.cjs`** draws the pictures in **Atlassian Sans**, the typeface Jira uses (the design tokens name it first, and a plain browser
  does not have it, so the preview otherwise falls back to the system font). It fetches the Latin subset from the design-system CDN
  that Jira's own pages load it from and keeps it in `scripts/preview/.cache/` (git-ignored: the font is not ours and is never
  committed). Only `shots.cjs` and `shot.cjs` use it, never the checks; offline they say so and use the system font
  (`--system-font` forces that).
- **`make-fixtures.mjs`** regenerates `fixtures/demo.json` from the live openFDA API (about 25 requests, more with the three-year
  window and paging). The snapshot is committed; run it only when the demo data should move on. It (and `check-demo-matches.mjs`)
  uses `scripts/fetchJson.mjs`, which falls back to asking the DNS servers directly when the operating system's own lookup
  cannot resolve `api.fda.gov` (a quirk seen on one machine; nothing is changed on the machine).

## What it does and does not tell you

It runs the real code in a real browser under a policy that blocks run-time styles, so it catches unstyled components,
layout that breaks at a width, contrast and naming problems, panel overflow and crashes in any state, including states that
are hard to reach on the demo site (first run, errors, a result with nothing in it).

It is **not Jira**. The font is the system font, not Jira's; the policy copies the styling rules of the Forge iframe, not every
directive; the backend is a fake (the Teamwork Graph, Jira and Confluence are not called); the Forge `Modal` the panel opens is
only recorded (open `view=create-all` to see the pop-up's content); and there is no Jira page around the app. Check the
final look on the demo site before a release (`forge deploy -e development`), as before.
