# RecallRadar privacy policy

_Last updated: 15 November 2026. Draft for the app owner to review before publishing._

RecallRadar is an app for Atlassian Jira and Confluence that compares FDA medical device recalls with a hospital's device list.

## What we process

- **Device list** you enter or load: device name, type, manufacturer, model, serial or lot number, ward. This is equipment information. RecallRadar does not need and must not be given patient data.
- **Check results**: which recalls matched which devices, and why.
- **Ward-to-team mapping**: a ward name and the name and id of a team in your Atlassian site.
- **Jira and Confluence content it creates** at your request: tasks and recall pages.
- **Atlassian account ids and names** of team members, read from the Teamwork Graph to suggest an assignee. They are shown to the signed-in person and used to fill the assignee field when that person asks. When the Rovo agent previews assigned tasks, the proposed people's account ids and names are kept in app storage in the preview record until it is confirmed (then it is deleted) or overwritten.

## Where it is stored

In Atlassian Forge app storage, inside Atlassian's infrastructure, scoped to your site. We do not keep a copy on our own servers.

## What leaves Atlassian

Searches to the public openFDA service (`api.fda.gov`) that contain **manufacturer and model names** from your device list. Nothing else is sent to any third party. We do not sell data, and we do not use it for advertising or to train models.

## Who acts, and with what rights

Tasks, Confluence pages and Teamwork Graph reads happen **as the person who clicked or asked**, so your Jira, Confluence and Teamwork Graph permissions apply.

## Retention and deletion

Check results are treated as fresh for 6 hours; an older result is still kept (shown flagged as old) until the next check replaces it. Short-lived guards and previews expire logically after minutes, but an unused one is not deleted until it is overwritten, so they can remain in storage longer than that. Device data stays until you remove it or uninstall the app; uninstalling removes the app's stored data from Forge storage. Jira tasks and Confluence pages remain, because they are your content.

## Your choices

Do not enter data you do not want processed. Ward-to-team mapping and assignment are optional, and nobody is assigned without your confirmation.

## Contact

**[Insert the owner's name and support email here before publishing.]**
