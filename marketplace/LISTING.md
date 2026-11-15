# RecallRadar: Marketplace listing material

Everything the listing form asks for, ready to paste. Nothing here is invented: check each claim against the README before submitting.

## Basics

| Field | Value |
| --- | --- |
| App name | RecallRadar |
| Category | Specialized industries: healthcare (clinical engineering, device safety) |
| Products | Jira (and Confluence for recall pages) |
| Hosting | Atlassian Forge. **Not** "Runs on Atlassian" (it calls `api.fda.gov`). |
| App icon | `marketplace/icon.svg` (vector). Export it as a 144 x 144 PNG for the form (no PNG is committed: my automatic export was wrong). |

## Tagline (max 80 characters)

Match FDA device recalls to your hospital's devices, and say how sure and why.

## Short description (max 200 characters)

RecallRadar compares FDA medical device recalls with your hospital's devices in Jira, shows how sure each match is and why, and creates the follow-up tasks.

## Long description

**Know which of your devices an FDA recall actually affects, and get the work started.**

Hospitals track thousands of devices, and FDA publishes new device recalls every week. RecallRadar compares the recalls with your device list and tells you, for each match, **how sure it is and why**:

- **Exact**: manufacturer, model and serial/lot are all listed in the recall.
- **Likely**: the model matches, but the serial/lot is not listed or not recorded, so a person must check.
- **Possible**: weak signal, shown only for judgement and never turned into a task.

**In Jira**
- A **dashboard** with devices, open recalls by class, task progress, and a filterable table of affected devices by ward and class.
- A **panel on every issue**: check devices, see each match with its reason, create a Jira task (one or all) with the ward, the reason, a link to the FDA recall and a due date from the recall's class (Class I sooner than II and III). Never a duplicate task for the same recall and device.
- **Ward teams from the Teamwork Graph** (read-only): map each ward to a team, see "Team: <name> (from Teamwork Graph)", and get a suggested assignee. Nobody is assigned unless you say yes.
- **Confluence recall pages**: one page per recall (what is wrong, what to do, affected devices, live task cards).

**With Rovo and other agents**
- The **RecallRadar Assistant** answers "Which ICU devices have open Class I recalls?" from the saved check, with the FDA recall numbers and device ids cited, never invented, and creates tasks only after you confirm a preview.
- The same tools are available over **MCP** to other agents (an admin must enable them).

**Built to be trusted**
- It reads the saved check, never guesses a space, team or recall number, and tasks and pages are written as the person who clicked, so Jira and Confluence permissions apply.
- No patient data. It sends only manufacturer and model names to openFDA.

Try it in a minute: open the dashboard and click **Load demo hospital** (30 devices with real manufacturer and model names, so some really match recalls).

## Screenshots to take (1440 x 900, light theme, demo hospital loaded)

1. Dashboard: summary cards and the affected-devices table (Jira, Apps, RecallRadar).
2. Dashboard filtered to Class I in one ward.
3. Issue panel: a match with the reason, the **Team: ... (from Teamwork Graph)** line, and the two buttons **Create task** / **Create & assign**.
4. A created Jira task showing ward, reason, FDA link, due date.
5. Rovo chat: "Which ICU devices have open Class I recalls?" with the cited answer.
6. Rovo chat: task preview asking "Shall I create these N tasks?".
7. A Confluence recall page with device table and live task cards.
8. First-run screen with the big **Load demo hospital** button.

## Support and links (fill in before submitting)

| Field | Value |
| --- | --- |
| Support contact | **Your support email or issue tracker URL** (you must choose; not filled in on purpose) |
| Privacy policy URL | The public URL of `marketplace/PRIVACY.md` (for example the rendered file in your repository) |
| Terms URL | The public URL of `marketplace/TERMS.md` |
| Documentation | The public URL of `README.md` |

## Data and security notes (for the listing's security questionnaire)

- **What is stored** (Forge storage, `storage:app`, inside Atlassian's infrastructure): the device list (name, type, manufacturer, model, serial/lot, ward), the latest saved check result (deleted after at most 24 hours), the ward-to-team mapping (team id and name), and short-lived task and preview guards (deleted when they expire). **No patient data and no Atlassian account ids, names or emails are stored.**
- **What leaves Atlassian**: only searches to `api.fda.gov` containing manufacturer and model names from the device list. Nothing else is sent anywhere.
- **Teamwork Graph**: read-only; two queries (a user's teams, a team's members), run as the signed-in person. Nothing is written to the graph.
- **Permissions and why**: see the "Permissions" table in the README. Jira work and Confluence page scopes act as the signed-in person. No unused scopes are declared (the Assets scopes were removed until an Assets import exists).
- **No claim of HIPAA or other certification** is made here. Do not add one unless it is true for your organisation.
- Output written to Jira and Confluence is built on the server from saved data, and every piece of FDA or hospital text is escaped before it goes into a Confluence page.

## Known limits to state honestly

- Each search reads the newest 25 matching recalls; older ones in the last year may be missing (the panel says so).
- openFDA allows about 1,000 anonymous requests a day per IP; a full check uses about 24, which is why results are saved for 6 hours.
- External MCP clients were not tested end to end.
