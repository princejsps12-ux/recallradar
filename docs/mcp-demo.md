# MCP demo: ask Claude Desktop "Are any of our infusion pumps recalled?"

You do the clicking; every step says exactly where. Demo site: `one-atlas-gykz.atlassian.net`. App id: `2e0464e9-8b4a-4388-b224-b4f05eae484f`.

**Use the development app on the demo site** (that is where the demo hospital and saved check are). The MCP address is:

```
https://mcp.atlassian.com/forge/2e0464e9-8b4a-4388-b224-b4f05eae484f
```

## A. Make sure there is a saved check (1 minute)

1. Open `https://one-atlas-gykz.atlassian.net/browse/MOBL-57`, or open **Apps, RecallRadar** (the dashboard).
2. If it says "Last checked ..." you are done. If not, click **Load demo hospital**, then **Check devices for recalls**, and wait for it to finish (about 15 seconds).

## B. Turn on the MCP tools for the site (an organization admin does this)

1. Go to `https://admin.atlassian.com`, choose your organization.
2. **Apps**, then **Sites**, then click `one-atlas-gykz.atlassian.net`.
3. **Connected apps**, find **RecallRadar** (development), click **View app details**.
4. Scroll to **Tools**. It says *Expose tools to MCP-compatible apps: Disabled*.
5. Read the warning ("any action the app is capable of, on behalf of users"). RecallRadar's tools only read the saved check, look up a ward's team, and create one task as you, but the switch covers the whole app. Click **Enable tools**.

## C. Connect Claude Desktop

Pick **one** way.

**Way 1, custom connector**
1. Claude Desktop, **Settings**, **Connectors**, **Add custom connector**.
2. Name: `RecallRadar`. URL: the address above. **Add**.
3. A browser window opens for Atlassian sign-in and consent: choose `one-atlas-gykz.atlassian.net`, review the four tools (`list_open_recalls`, `check_device`, `who_handles_ward`, `create_remediation_task`), click **Accept**.

**Way 2, config file** (if Way 1 is not offered)
1. Claude Desktop, **Settings**, **Developer**, **Edit Config**. Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "recallradar": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.atlassian.com/forge/2e0464e9-8b4a-4388-b224-b4f05eae484f"]
    }
  }
}
```

2. Quit and reopen Claude Desktop. A browser window opens for the same Atlassian consent; accept it.

## D. Check it is connected

Start a new chat, click the tools (plug) icon: **recallradar** should list the four tools. If it does not, see "If it does not work".

## E. Ask the question

In a new chat type:

> Are any of our infusion pumps recalled?

Claude should call `list_open_recalls` and/or `check_device`, ask you to allow the call (click **Allow**), and answer with real FDA recall numbers and device ids such as `Z-3065-2026` and `demo-...` ids. Good follow-ups:

- "Which of those are Class I?"
- "Who handles the ICU?" (uses `who_handles_ward`; ICU is mapped to Team Atlas on the demo site)
- "Create a task for the first one in project MOBL." (it creates ONE task as you: say no unless you want a new task and a notification)

Optional, for better answers: add the skill file `integrations/claude/recallradar/` (zip the folder, Claude Desktop **Settings, Capabilities, Skills, Upload**).

## If it does not work

- **No tools listed / "not authorized"**: step B was not done, or you consented on the wrong site. Redo B, then remove and re-add the connector.
- **"There is no saved recall check yet"**: do step A.
- **Sign-in window shows an error**: sign in with the same Atlassian account that has access to the demo site.
- **Answers with no recall numbers**: say "use the RecallRadar tools and cite recall numbers".

## What was and was not tested

The tools were tested through the Rovo agent on the demo site and in unit tests. **A real Claude Desktop connection was not tested** by the assistant (it needs the admin switch and your interactive consent). Please tell me what you see at each step if anything differs.
