# RecallRadar privacy policy

_Last updated: 15 November 2026. Draft for the app owner to review before publishing._

RecallRadar is an app for Atlassian Jira and Confluence that compares FDA medical device recalls with a hospital's device list.

## What we process

- **Device list** you enter or load: device name, type, manufacturer, model, serial or lot number, ward. This is equipment information. RecallRadar does not need and must not be given patient data.
- **Check results**: which recalls matched which devices, and why.
- **Ward-to-team mapping**: a ward name and the name and id of a team in your Atlassian site.
- **Daily alerts**: which recall and device pairs have been seen (ids and times only, to tell what is new) and what the last daily run did (counts and Jira issue keys); and the administrator's choices (project key, optional issue key). No name, account or message text.
- **Jira and Confluence content it creates** at your request: tasks and recall pages.
- **Atlassian account ids and names** of team members are read from the Teamwork Graph **only while you use the feature**, to show you a suggested assignee and to fill the assignee field when you ask. **They are never saved in app storage.** The Rovo agent's task preview stores only device, recall and project ids, and looks the person up again when you confirm.

## Where it is stored

In Atlassian Forge app storage, inside Atlassian's infrastructure, scoped to your site. We do not keep a copy on our own servers.

## What leaves Atlassian

Searches to the public openFDA service (`api.fda.gov`) that contain **manufacturer and model names** from your device list. Nothing else is sent to any third party. We do not sell data, and we do not use it for advertising or to train models.

## Who acts, and with what rights

Tasks, Confluence pages and Teamwork Graph reads happen **as the person who clicked or asked**, so your Jira, Confluence and Teamwork Graph permissions apply. The one exception is the **daily alert** (off until a Jira administrator turns it on): it has no signed-in person, so it creates tasks and posts one comment as the app itself, only in the project and on the issue the administrator chose.

## Retention and deletion

- **Saved check result** (and the finished-job copy of it): treated as fresh for 6 hours, shown flagged as old after that while a refresh runs, and **deleted after 24 hours at the latest**.
- **Task previews** (Rovo agent): deleted when confirmed or when they expire after 10 minutes. **Task duplicate-guards**: deleted when they expire after 2 minutes. A daily clean-up job deletes anything that was left.
- **Daily-alert record** (pairs seen and the last run): deleted after 7 days without an update, by the daily clean-up, and when the devices are removed. **The administrator's alert choices**: kept until changed or the app is uninstalled.
- **Device list and ward-to-team mapping**: kept until you remove them or uninstall the app; uninstalling removes the app's stored data from Forge storage.
- **Jira tasks and Confluence pages** remain, because they are your content.

## Your choices

Do not enter data you do not want processed. Ward-to-team mapping and assignment are optional, and nobody is assigned without your confirmation.

## Contact

**[Insert the owner's name and support email here before publishing.]**
