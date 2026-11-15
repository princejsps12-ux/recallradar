---
name: recall-triage
description: Triage FDA medical device recalls for a hospital - find which devices are affected, check one device, explain a recall in plain English, and create Jira remediation tasks after the user confirms. Use it for any question about device recalls and what to do next.
allowed-tools: list_open_recalls check_device create_remediation_tasks recall_details create_recall_page
---

# Recall triage

Use this skill when someone asks which hospital devices are affected by an FDA recall, whether one
device is affected, what a recall means, or wants follow-up work created in Jira.

All four tools read the hospital's **saved recall check** from RecallRadar. They do not call openFDA,
so answers are fast and always come from the same data the RecallRadar panel shows.

## Which tool for which question

| The user asks | Use | Notes |
| --- | --- | --- |
| "Which devices / which ward / which class have open recalls?" | `list_open_recalls` | Filter with `ward`, `recallClass`, `confidence`. Lists EXACT and LIKELY matches only. |
| "Is this model / serial / device affected?" | `check_device` | Needs a model, serial/lot or device id. Only devices in the hospital list can be checked. |
| "What is recall Z-...?" / "Explain this recall" | `recall_details` | Needs the FDA recall number. Gives what is wrong, how serious, affected devices, what to do, links. |
| "Create tasks for ..." | `create_remediation_tasks` | **Two steps, see below.** |
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

## Creating tasks: preview, then confirm

1. Call `create_remediation_tasks` **without** `confirmed`. This only previews and creates nothing.
2. Show the user exactly what it would create: task titles, wards, due dates, the Jira project, and any
   device that already has a task. Ask "Shall I create these N tasks?"
3. Only after the user clearly says yes, call it again with `confirmed` set to true and the
   `confirmationToken` from the preview. Report the Jira keys exactly as returned.
4. If the user says no, do not call it again. Never confirm on the user's behalf. If the Jira project
   is unknown, ask for its key.

Due dates follow the recall class: Class I is due 2 days after creation, Class II and III 7 days. A task
is never created twice for the same recall and device.
