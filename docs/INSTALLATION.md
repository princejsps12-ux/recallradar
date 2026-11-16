# One installation for Jira, Confluence and Rovo Home

The summary is in the [README](../README.md#install-and-connect-confluence).

Forge keeps app storage per installation, and an app installed separately in two products gets two installations: two copies of the agent in the picker and, in Rovo Home, actions that can land in the installation that has no devices. RecallRadar avoids that with Forge's **multi-app compatibility** (`app.compatibility` in [`manifest.yml`](../manifest.yml): Jira is the required app, Confluence an optional one; [Atlassian's documentation](https://developer.atlassian.com/platform/forge/app-compatibility/)). There is **one installation per site, one storage and one agent**.

- **Install in Jira; connect Confluence only if you want recall pages** (admin steps in the quick start).
- A chat in Rovo Home reads the same devices as the Jira dashboard. Its Forge log line says `runs in confluence`: that names the product context of the call, not another installation.
- **Checked live on the demo site (2026-11-16, development environment):** one RecallRadar Assistant in the agent picker (two before); the same question in the Jira sidebar and in Rovo Home returned the same devices; "Who handles the ICU ward?" and a Confluence page update worked from Rovo Home too. Before Confluence was connected, the Create Confluence pages dialog showed the connect message (Forge's own answer was `403 The app is not installed on this instance`); after connecting through Atlassian Administration it listed the spaces.
- **Uninstalling goes the other way round:** disconnect Confluence first, then uninstall from Jira.

## Connecting Confluence, step by step

1. Open admin.atlassian.com and choose your organization.
2. In the left menu expand **Apps** and open **Sites**, then click your site.
3. Open **Connected apps** and search for `recallradar` (the admin pages list the app under that name).
4. **View app details**, then the **Connections** tab.
5. Click **Connect** next to Confluence, and **Connect** again in the side panel that asks you to review the permissions.

The admin page can say "Connecting..." for a few minutes after the connection already works.
