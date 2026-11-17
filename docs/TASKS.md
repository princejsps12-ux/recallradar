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
2. **A 2-minute guard in Forge storage** (`GUARD_TTL_MS`). Jira's search index can lag a few seconds behind a new issue, so a fast double click could slip past layer 1. For two minutes the app remembers what it just created or is creating. Each label is *claimed* with one atomic write (it fails if the label is already claimed), so two requests at the same moment cannot both pass: the one that loses the claim reports the pair as "in progress". After that Jira's own search knows, and a task that was deleted in Jira can be created again.

Also: the same pair listed twice in one request makes one task; a "possible" match is refused by the server; and the browser sends only the recall number and device id, while everything else in a task is rebuilt **on the server** from the saved check result, so a forged request cannot set a task's text or due date.

Checked on the demo site: after 35 tasks had been created, a second tab that still thought none existed asked for all 35 again, and the server created none (each one "already had a task"). Jira held 35 tasks with 35 distinct labels.

## Tracking tasks to closure

A task is only useful when it is finished, so RecallRadar reads Jira's status of every task it made and says how far along the work is. Nothing is stored for this: Jira stays the source of truth, and every reading is made as the signed-in person.

- **Where the status comes from.** The same label search that finds a pair's task (`findTasks` in [`src/jiraClient.js`](../src/jiraClient.js)) also asks for the task's status. The project's own word is shown ("In review"), but the meaning comes from Jira's **status category**: *to do* (`new`), *in progress* (`indeterminate`) or *done* (`done`). Every project names its statuses differently, the category is the same everywhere. A status with no known category counts as *to do*, never as *done*.
- **Per pair.** A pair (one device, one recall) is *resolved* when its task is in a done status. A pair with no task yet is not resolved and is not hidden: "no task yet" is the number that says where work has not started. A task made a moment ago (still in the 2-minute guard, maybe not searchable yet) counts as *to do*.
- **Per recall and per ward.** [`src/progress.js`](../src/progress.js) rolls the pairs up: for the open recalls, their exact and likely matches, how many pairs have no task, are to do, in progress or done, and the share resolved (rounded, but never 100 % until every pair is done: 99.6 % shows as 99 %). The **Progress** tab of the dashboard shows the overall share with a bar, then one row per recall (Class I first, then the least done) and one per ward (the least done first); every bar is also written in words. The device table and the device drawer show each task's status next to its key.
- **Closed recalls drop out.** When the FDA closes a recall (status terminated or completed), its pairs are no longer part of the work, so the percentages describe what is still open. The finished tasks stay in Jira.
- **Cost.** Reading the status is the same JQL search as looking for existing tasks: 20 labels per search, about 0.3 s each, and one listing of the 2-minute guard instead of a storage read per pair. The Progress tab reads it when it is opened and again when a new check or new tasks arrive.

## Limits

- **Request size.** Creating a task takes about 0.6 s, and a UI function is cut off at 25 s: creating 34 in one request took about 20 s on the demo site. So one request may ask for at most 25 tasks (`MAX_PAIRS_PER_REQUEST`) and the panel sends batches of 10, with a running count.
- **Looking up existing tasks** only searches Jira, so it may cover up to 200 pairs per request (`MAX_STATE_PAIRS_PER_REQUEST`); this is how the panel shows "Task: MOBL-12" for matches that already have one.
- **Jira bulk limit.** Jira creates at most 50 issues per bulk call (`BULK_CREATE_LIMIT`).
- **Permissions.** Tasks are created *as the person who clicked* (`asUser`), so someone who may not create issues gets Jira's error, and the app needs the `write:jira-work` scope.
- **Project.** On the dashboard you choose the project next to the button; on the issue panel it is the project of that issue; in a Rovo chat you name it, or it is the project of the Jira page you are on.
- **Progress is read, not recorded.** The percentages are computed from Jira each time they are opened. There is no history ("how did the share resolved move this week") and no audit trail: Jira's own issue history is the record.
- **A pair with two tasks.** If somebody creates a second task by hand with the same label, the first one found is used.
