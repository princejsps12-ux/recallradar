---
name: recallradar
description: Check a hospital's medical devices against FDA recalls using the RecallRadar tools - list which devices have open recalls (by ward or recall class), check one device by model, serial or id, and create a Jira follow-up task for one recall and device. Use it for any question about device recalls in the hospital's Jira.
---

# RecallRadar: FDA device recalls for a hospital's Jira

RecallRadar compares FDA medical device recalls with the devices a hospital keeps in Jira and says which
devices may be affected, how sure it is, and why. These tools are provided by the RecallRadar app through
Atlassian's MCP server. They read RecallRadar's **saved recall check**; they do not search the FDA live.

## The tools

Your client may show the names with a prefix. The four tools:

| Tool | Use it to | Inputs |
| --- | --- | --- |
| `list_open_recalls` | See which devices have an open recall that matches EXACT or LIKELY | optional `ward`, `recallClass` (I, II or III), `confidence` (exact or likely), `limit` |
| `check_device` | Ask whether one device matches any recall | at least one of `model`, `serial`, `deviceId`; optional `manufacturer` |
| `who_handles_ward` | Ask which Teamwork Graph team handles a ward, who is in it, and who to suggest (read-only) | `ward` (required). If the ward has no team it says so: do not guess one |
| `create_remediation_task` | Create ONE Jira task for one recall and one device | `recallNumber`, `deviceId`, `projectKey` (all required) |

## How to work

1. **Start with `list_open_recalls`** to learn the real recall numbers and device ids. Use `check_device`
   when the user names a specific model, serial number or device.
2. **Quote only real data.** Every answer includes `citations`: the only recall numbers and device ids you
   may mention. Copy them exactly (for example `Z-2723-2026`, `demo-001`). Never invent or guess a recall
   number, device id, serial number or Jira key. If a tool finds nothing, say so.
3. **Say how fresh the data is.** Answers include `basedOn.checkedAt`. If `basedOn.stale` is true or there
   is a `warning`, tell the user. If no saved check exists, say the user must open the RecallRadar panel
   on a Jira issue and click "Check devices for recalls".
4. **Respect confidence.** `exact` = manufacturer, model and serial/lot are all listed in the recall.
   `likely` = the model matches but the serial/lot is not listed or not recorded: say it needs a manual
   check and never call it confirmed. `possible` matches are weak and are never listed as open recalls.
5. **Recall classes.** Class I: serious harm or death possible (most urgent). Class II: temporary or
   reversible harm. Class III: harm unlikely. RecallRadar tasks are due 2 days after creation for Class I
   and 7 days for Class II and III.
6. **Creating a task needs the user's say-so.** `create_remediation_task` writes to Jira (as the person
   using your client) and creates exactly one task. Before you call it, tell the user which recall, which
   device (id and ward), which project, and the due date, and wait for a clear yes. Never create tasks in
   a loop without asking. It never creates a duplicate: if the task exists you get its Jira key back.
7. **No clinical advice.** RecallRadar does not know a manufacturer's specific fix. Point the user to the
   manufacturer's recall notice and the FDA record for the corrective action.

## Typical flows

- "Which ICU devices have open Class I recalls?" -> `list_open_recalls` with `ward` = ICU and
  `recallClass` = I. If nothing matches, the answer lists the wards that do.
- "Is serial 50003704 affected?" -> `check_device` with `serial`.
- "Create a task for that one" -> confirm the details with the user, then `create_remediation_task`.
