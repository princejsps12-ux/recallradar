# Jira tasks for matches, in detail

The summary is in the [README](../README.md#creating-tasks).

## Due-date rule

FDA classes a recall by how dangerous the problem is ([21 CFR 7.3](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-7/subpart-A/section-7.3)): **Class I** a reasonable chance of serious harm or death; **Class II** temporary or medically reversible harm, or a remote chance of serious harm; **Class III** not likely to cause harm. The due date is a number of **calendar days from the day the task is created** (the UTC date), so it never depends on weekends or holidays.

| Recall class | Days | Why |
| --- | --- | --- |
| **Class I** | **2** | Serious harm is possible, so the device should be found and quarantined within a couple of days, not left for a weekly review. |
| **Class II** and **III** | **7** | Harm is unlikely or reversible, so the team's normal weekly review is soon enough. |
| Unknown or missing class | **2** | Serious harm cannot be ruled out. In a hospital a task that is due too early costs far less than a missed recall, so it is treated like Class I. |

The numbers are the constants `DUE_DAYS_CLASS_I`, `DUE_DAYS_CLASS_II_III` and `UNKNOWN_CLASS_DUE_DAYS` in [`src/taskRules.js`](../src/taskRules.js), and each task's description states the rule that set its date. They are a starting point for a hospital to tune, not a regulatory requirement.

## No duplicates

Each task carries a label that encodes its recall and device (`recallradar-Z-2723-2026-demo-001`). Two layers stop a second task for the same pair:

1. **Jira is the source of truth.** Before creating anything, the app searches Jira for those labels, so an existing task is found even if the app's own storage was cleared, or the task was made from another browser or tab.
2. **A 2-minute guard in Forge storage** (`GUARD_TTL_MS`). Jira's search index can lag a few seconds behind a new issue, so a fast double click could slip past layer 1. For two minutes the app remembers what it just created or is creating. After that Jira's own search knows, and a task that was deleted in Jira can be created again.

Also: the same pair listed twice in one request makes one task; a "possible" match is refused by the server; and the browser sends only the recall number and device id, while everything else in a task is rebuilt **on the server** from the saved check result, so a forged request cannot set a task's text or due date.

Checked on the demo site: after 35 tasks had been created, a second tab that still thought none existed asked for all 35 again, and the server created none (each one "already had a task"). Jira held 35 tasks with 35 distinct labels.

## Limits

- **Request size.** Creating a task takes about 0.6 s, and a UI function is cut off at 25 s: creating 34 in one request took about 20 s on the demo site. So one request may ask for at most 25 tasks (`MAX_PAIRS_PER_REQUEST`) and the panel sends batches of 10, with a running count.
- **Looking up existing tasks** only searches Jira, so it may cover up to 200 pairs per request (`MAX_STATE_PAIRS_PER_REQUEST`); this is how the panel shows "Task: MOBL-12" for matches that already have one.
- **Jira bulk limit.** Jira creates at most 50 issues per bulk call (`BULK_CREATE_LIMIT`).
- **Permissions.** Tasks are created *as the person who clicked* (`asUser`), so someone who may not create issues gets Jira's error, and the app needs the `write:jira-work` scope.
- **Project.** On the dashboard you choose the project next to the button; on the issue panel it is the project of that issue; in a Rovo chat you name it, or it is the project of the Jira page you are on.
- **Task progress is only counted.** The dashboard counts open and done RecallRadar tasks and a row shows the task's key as a link; there is no per-recall closure record or audit trail.
