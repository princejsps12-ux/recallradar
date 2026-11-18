# RecallRadar: 4:30 demo video script

Target length **4:30**. About 620 spoken words at a calm pace (140 words a minute). Every scene says what is on screen, the exact
clicks, and the words to say. Record the screen at 1440 x 900, light theme, browser zoom 100 %, notifications off.

The story in one line: **a missed device recall can hurt a patient, hospital clinical engineering already works in Jira, so the
matching, the proof and the follow-up tasks belong in Jira.**

## Before you press record (10 minutes, do it once)

Demo site `one-atlas-gykz.atlassian.net`, the **development** app (it has the demo hospital, Rovo and the Teamwork Graph team).

1. **Fresh state.** Delete the old test tasks first, so "Create all" has something to create: Jira search `labels = recallradar`,
   select all, **Delete** (deleting is yours to approve; creating a task twice for the same recall and device is blocked on
   purpose). Then open the dashboard: Jira, **Apps**, **RecallRadar**. If it shows devices, **...** menu, **Remove devices**,
   **all devices**, so the first scene starts from the first-run screen.
2. **MCP tools on.** admin.atlassian.com, your organization, **Apps**, **Sites**, the site, **Connected apps**, RecallRadar,
   **View app details**, **Tools**, **Enable tools**. (It is Disabled until an admin switches it on; the page warns that it covers
   the whole app.) In Claude Desktop add the connector (`docs/mcp-demo.md`, section C), sign in, and run the question once so the
   consent screen is behind you. **This part has not been run end to end by the author: rehearse it.**
3. **Teamwork Graph.** Open **Ward teams** once: it lists the site's teams (verified live on the demo site on 18 Nov). The
   signed-in person must be a **member of at least one team** (Jira, **Teams** in the left sidebar), otherwise the tab says
   "You are not in any team": that is the case on `prince-recallradar`, so record on the demo site. Map **Cath Lab** to **Team
   Atlas** before recording (the demo site already has it).
4. **Rovo.** Ask Rovo must be on the site and **RecallRadar Assistant** must appear in the agent list.
5. **Daily alerts.** **...**, **Daily alerts...**: leave them **off** for the recording; scene 8 switches them on. (Verified live: the daily run created a task and a comment on its own. To show "1 new" on camera you would need a real new recall, so scene 8 only shows the setup.)
6. Close every other tab, hide the bookmarks bar, set the Jira theme to **Light** (profile menu, Theme).

## The script

| Time | On screen and exact clicks | Say |
| --- | --- | --- |
| **0:00-0:20** | **Title card, then a slow zoom on the FDA's recall list** (open.fda.gov/apis/device/enforcement, any Class I row). No clicking. | "Every week the FDA recalls medical devices. If a hospital misses one, a patient can be harmed, and today clinical engineering matches recalls by hand. These teams already work in Jira, so the answer and the follow-up belong there. This is RecallRadar." |
| **0:20-0:50** | Jira, left sidebar **Apps**, **RecallRadar**. The first-run screen shows three steps. Click **Load demo hospital**. A bar appears: "Checked N of M FDA searches". | "RecallRadar is a Forge app. I load a demo hospital: thirty devices with real manufacturer and model names. It now checks them against three years of FDA recalls, in the background, so I can keep working." |
| **0:50-1:30** | The check takes about 35 seconds on the live site; start it before the take and record the saved result. The dashboard appears. Point at the red headline "N devices need action", then the line under it, then the **Do this first** list. Hover the badges **Class I** and **Exact match**. | "About twenty-five devices need action, eleven with a Class I recall (read the real numbers off the screen), the most serious. Every match says how sure it is. Exact: the maker, the model and the serial number are all in the recall. Likely: the product matches, check the unit. Possible: only a related product, so no task. The most urgent are listed first." |
| **1:30-2:15** | Click **Impella Controller** in Do this first. The drawer opens. Click the first recall row (**Z-0208-2027**) to open it. Scroll to the reason text. Close the drawer (**X**). | "Why? Here is the recall, what the FDA says is wrong, and the reason we matched it: this serial number is listed. We measured the matcher on about 3,400 real labeled pairs: it never called a device exact when it was not, and nothing that needs a task was missed. It also copes with a thousand-device list: I pasted one and it checked in under a minute. The numbers and the misses are published." |
| **2:15-2:50** | In **Do this first** the project box reads **Mobile Dev (MOBL)**. Click **Create all N tasks...** (60 in the screenshots; it follows today's data). The window asks "Create N tasks?": read it, click **Create N tasks**. A bar counts "n of N tasks created"; the window cannot be closed until it ends. When the green note says the tasks were created, open the MOBL board (Jira search `labels = recallradar`) and open one issue. | "One click creates a Jira task for each affected device and recall, in the project I chose, due by the recall's class: two days for Class I. Never twice for the same pair. The window cannot be closed halfway. Each task carries the reason and a link to the FDA record." |
| **2:50-3:20** | Top bar **Ask Rovo**. Pick **RecallRadar Assistant**. Type: **Which Cath Lab devices have open Class I recalls?** Wait for the answer. Then type: **Explain the most urgent one in plain English**. | "The same data is a Rovo agent. It answers only from the saved check, so it never invents a recall number, and every answer lists the numbers it may quote. Asking it to create tasks shows a preview first, and creates exactly what I confirm." |
| **3:20-3:55** | **Rehearse this one: it has not been run end to end.** Switch to **Claude Desktop**. The **recallradar** connector is listed (plug icon). Type: **Are any of our infusion pumps recalled?** Click **Allow** when Claude asks to call the tool. Read the answer. | "And it is an MCP server. In Claude Desktop, with an admin's approval and my own sign-in, I ask about our infusion pumps. Claude calls RecallRadar's tools and answers with real FDA recall numbers and our device ids. It can create one task as me, and never assigns anyone." |
| **3:55-4:10** | Back in Jira, **Ward teams** tab. Choose a team for **Cath Lab**. Open a device in Cath Lab, click **Who handles this ward**. (If the graph is not permitted for this account, **cut this scene** and say the last sentence over the drawer.) | "RecallRadar reads teams and people from the Teamwork Graph, read-only, to say who handles a ward and how busy they are. Nobody is assigned unless you choose it." |
| **4:10-4:30** | **...** menu, **Daily alerts...**. Switch **Create tasks for new recalls every day** on, choose **Mobile Dev (MOBL)**, **Save**. Close. Zoom out to the dashboard. End card with the repository address. | "Every day it checks again. When a recall starts to affect a device, it creates the task and posts one comment, so nobody has to open a dashboard to hear about it. RecallRadar: recalls matched to your devices, with the proof, in Jira." |

## Word count and timing

The narration column is about 440 words (all nine scenes fit their time at 140 words a minute; the rest is clicking). Read it once with a timer; if you are over 4:30, drop the second Rovo question and the
"never assigns anyone" sentence first. Leave a half second of silence at every scene change.

## Things to say only if they are true on the day

- "Thirty devices, 26 need action" depends on today's FDA data: read the numbers off the screen, do not memorize them.
- Say "three years of recalls" and "never twice for the same pair": both are in the code and the tests.
- Do not say "certified", "HIPAA" or "runs on Atlassian": the app sends manufacturer names, model names and UDI-DIs to openFDA,
  so it is not eligible for Runs on Atlassian, and the README claims no certification.
- The matching accuracy is measured on recalls the author labeled from their own text. Say "measured on real recalls"; do not
  say "99 percent accurate in hospitals".

## If something breaks while recording

| Symptom | Do this |
| --- | --- |
| The check shows "Checking" for more than 3 minutes | It is a stuck job: it counts as failed after 6 minutes; press **Refresh** then. Record scene 2 again from the saved result. |
| "Could not read teams from the Teamwork Graph" | Cut scene 7 (see the checklist). |
| Rovo shows no **RecallRadar Assistant** | Open Rovo Home (home.atlassian.com), **Switch to: Full screen**, pick the agent there. |
| Claude does not list **recallradar** | The admin Tools switch is off, or the sign-in expired: `docs/mcp-demo.md`, "If it does not work". If it still fails, cut scene 6 and say the MCP sentence over the Rovo answer. |
| "Teamwork Graph could not be read" in the drawer | Reload and open it again; it needs the signed-in person to see teams. If it persists, cut scene 7. |
| "Create all" says tasks already exist | Delete the tasks with the label `recallradar` and run it again. |
