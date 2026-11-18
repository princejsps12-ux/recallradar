---
name: recall-triage
description: Triage FDA medical device recalls for a hospital - find which devices are affected, check one device, explain a recall in plain English, and create Jira remediation tasks after the user confirms. Use it for any question about device recalls and what to do next.
allowed-tools: list_open_recalls check_device create_remediation_tasks recall_details create_recall_page who_handles_ward
---

# Recall triage

Use this skill when someone asks which hospital devices are affected by an FDA recall, whether one
device is affected, what a recall means, or wants follow-up work created in Jira.

The tools read the hospital's **saved recall check** from RecallRadar (only `who_handles_ward` reads the
Teamwork Graph instead). None of them calls openFDA, so answers are fast and always come from the same
data the RecallRadar dashboard shows.

## Which tool for which question

| The user asks | Use | Notes |
| --- | --- | --- |
| "Which devices / which ward / which class have open recalls?" | `list_open_recalls` | Filter with `ward`, `recallClass`, `confidence`. Lists EXACT and LIKELY matches only. |
| "Is this model / serial / device affected?" | `check_device` | Needs a model, serial/lot or device id. Only devices in the hospital list can be checked. |
| "What is recall Z-...?" / "Explain this recall" | `recall_details` | Needs the FDA recall number. Gives what is wrong, how serious, affected devices, what to do, links. |
| "Create tasks for ..." | `create_remediation_tasks` | **Two steps, see below.** |
| "Who handles the ICU?" / "Who should get this task?" | `who_handles_ward` | Needs a `ward`. Reads the ward's team and members, the Jira project the team works in (and its lead) and how many open work items each person has, all from the Teamwork Graph (read-only), and suggests one person. Quote the project, lead and counts only as returned (`worksIn`, `openWorkPerPerson`); either may be missing when the graph cannot say. If the ward has no team it says so: tell the user to map it in the RecallRadar panel (Ward teams) and never guess. |
| "Make a Confluence page for this recall" | `create_recall_page` | Needs a `spaceKey`: call without it to list spaces and ask. Say which recalls and which space, and get a yes first. Updates an existing page instead of duplicating it. |

## Rules that always apply

1. **Cite only real data.** Every answer includes `citations`: the only recall numbers and device ids
   that may be quoted. Never invent or guess a recall number, device id, serial number, Jira key or link.
2. **Say where the data is from** (`basedOn.checkedAt`) and warn when it is stale or incomplete.
3. **Confidence matters.** EXACT: manufacturer, model and serial/lot all listed in the recall.
   LIKELY: the model matches but the serial/lot is not listed or not recorded, so it must be checked by
   a person. Never call a LIKELY match confirmed. POSSIBLE matches are weak; mention them only if asked.
4. **No clinical or repair advice.** RecallRadar does not know a manufacturer's specific fix. Give the
   steps the tool returns and point to the manufacturer's recall notice.
5. **Group by device.** For a list, answer from `devices` (one line per device: name, ward, recalls by class, how
   many exact and how many need a serial check), with the recall numbers underneath, and open with the next action
   ("6 Class I recalls on one device; create 6 tasks, due in 2 days?"). Never repeat a device id on every row.
6. **Empty answers are said as they are.** If a tool says there are no devices or no saved check yet, tell the
   user that and what the message says to do (open the RecallRadar dashboard in Jira and load the demo
   hospital or import devices, or run a check). The same devices and saved checks are used wherever the
   chat runs: Jira, Confluence or Rovo Home.
7. **Confluence is an optional connection.** If `create_recall_page` says RecallRadar is not connected to
   Confluence, give the user the admin steps it returns. Tasks and every other tool work without it.

## Creating tasks: preview, then confirm

1. Call `create_remediation_tasks` **without** `confirmed`. This only previews and creates nothing.
2. Show the user exactly what it would create: task titles, wards, due dates, the Jira project, and any
   device that already has a task. Ask "Shall I create these N tasks?"
3. Only after the user clearly says yes, call it again with `confirmed` set to true and the
   `confirmationToken` from the preview. Report the Jira keys exactly as returned.
4. If the user says no, do not call it again. Never confirm on the user's behalf. If the Jira project
   is unknown, ask for its key.

Assigning is optional and never automatic. Offer it ("I can also propose an assignee from the ward's
team"). If the user wants it, preview with `assignSuggested` set to true, show each `proposedAssignee`
and the `assignment.rule`, and ask them to confirm. Name only teams and people a tool returned.

Due dates follow the recall class: Class I is due 2 days after creation, Class II and III 7 days. A task
is never created twice for the same recall and device.
