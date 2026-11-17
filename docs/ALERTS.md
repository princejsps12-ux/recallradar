# Daily alerts, in detail

The summary is in the [README](../README.md#what-it-does-today). This page says what a "new" recall is, what the daily run does, who it acts as, what it stores and what it cannot do.

## What "new" means

RecallRadar keeps a list of the **(recall, device) pairs that need a task** (an exact or likely match of a recall that is still open), and when each pair was first seen. A pair that was not in the list at the last look is **new**: a recall has started to affect a device.

- **The first look is a baseline.** What is affected the first time (or the first time after alerts were switched on, or after devices were imported or the demo loaded) is the starting point. Nothing from it is new and nothing is alerted, so switching alerts on never floods a project with tasks. The pairs that imported devices bring are the baseline too, for the same reason.
- **Only a complete check counts.** A check with failed FDA lookups is shown but not tracked, so a partial result can never make pairs look gone and then new again.
- **A pair that stops matching is remembered for a week**, so a search that misses a recall one day (openFDA capped it) does not raise the same alert again the next day. A pair that was gone for a whole week and comes back is new again.
- **New for 24 hours.** The dashboard's **New since yesterday** card lists the devices that became affected in the last 24 hours, newest first, with their task if one exists. It works whether or not alerts are on.

## What the daily run does

After the daily check (and when an administrator presses **Run now**), if the alerts are on:

1. Takes the new pairs that were first seen in the last **48 hours** and have not been handled (`ALERT_WINDOW_MS`). Older ones that were never handled are marked handled without a task: an alert is about news, and a task for something found three days ago while alerts were off would be a surprise.
2. Creates **one Jira task per pair** in the project the administrator chose, with the same title, labels, description and due date as a task made by hand. It looks for the pair's existing task first (by its label), so nothing is created twice. At most **50 tasks per run** (`MAX_ALERT_TASKS_PER_RUN`); the rest wait for the next run and the comment says so.
3. Posts **one comment** on the issue the administrator named (optional): how many recalls affect how many devices, one line per device with its task as a link, and where to look next. At most 20 lines; the rest are counted.
4. Saves a short summary (what was new, which tasks were created, whether the comment was posted, any problem) so the dialog can show it.

Nobody is assigned. The Teamwork Graph can only be read on behalf of a person, and a scheduled run has none; the team picks the tasks up (or someone uses **Create and assign** on the dashboard).

If Jira refuses, the run says so in words ("give the RecallRadar app user the permissions to browse the project, create issues and add comments") and tries again the next day; the pairs stay waiting for 48 hours.

## Who it acts as

A scheduled run has no signed-in person, so the alert acts as **the app itself** (`asApp`), the only place the app does. Everything a person does stays as that person. The app user needs permission to create issues in the chosen project; Jira adds apps to most projects on its own. **Saving the settings tests exactly that**: with the alerts on, the project is tried as the app and a refusal is reported at once, not at 3 a.m. The settings are for **Jira administrators** (checked on the server), because they decide where the app creates issues without anyone clicking.

## What is stored

Two records, both without any personal data (see [Data and trust](../README.md#data-and-trust)):

| Record | Holds | Kept |
| --- | --- | --- |
| `alerts:state` | For each affected pair: when it was first and last seen, whether it was alerted, whether it was news. The summary of the last run (counts and Jira issue keys). | Deleted when nothing has updated it for **7 days**, by the daily clean-up, when the devices are removed, and on uninstall. |
| `alerts:settings` | Whether alerts are on, the project key, the optional issue key. | Until an administrator changes them, and on uninstall. It is configuration, not data about anyone. |

## Limits

- **It is as good as the matching.** A new pair is a new exact or likely match; see [ACCURACY.md](ACCURACY.md) for how the matching measures up. A rule that gets smarter can make old recalls match new devices, and those show up as new.
- **It only knows what the check saw.** A check that fails is not tracked; the next complete check carries on.
- **Two writers can race.** The record is read and written whole; a check and an administrator's "Run now" at the same moment can lose one update. The worst case is one pair announced again, and tasks are never duplicated (the label search protects them).
- **One comment issue.** The comment goes to a single issue; there is no email, chat or per-ward routing yet.
- **What is verified.** The state, the run, the comment and the resolvers are unit tested with fakes; the dashboard card and the dialog are checked in the preview. What happened on a real Jira site is written in the [README](../README.md#connect-other-agents-mcp) under "What was and was not verified"; where it says nothing, it was not tried.
