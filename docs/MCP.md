# Connect external agents (MCP), step by step

The summary is in the [README](../README.md#connect-other-agents-mcp).

## Outside Atlassian: Claude Desktop, Claude Code, Cursor and others

**1. A site admin switches it on.** External MCP exposure is **off by default**. In Atlassian Administration open **Apps**, **Sites**, your site, **Connected apps**, then **View app details** for RecallRadar and scroll to **Tools**. It shows *Expose tools to MCP-compatible apps: Disabled*; click **Enable tools**. This is per app and per site, and needs an organization admin. Read the warning on that page first: *"Enabling this gives access to perform any action the app is capable of, on behalf of users."* RecallRadar's own tools only read the saved check and create single tasks as the signed-in user, but the switch is for the whole app, so enable it only for a site you trust.

**2. Use the app's MCP address.**

```
https://mcp.atlassian.com/forge/<appId>
```

`<appId>` is the UUID in `manifest.yml` after `ari:cloud:ecosystem::app/` (under `app: id:`).

**3. Add it to your client and sign in.** The first connection opens Atlassian's OAuth consent screen: pick the site, review the tools, approve. No API token is involved.

*Claude Desktop*, either way (Atlassian's docs do not cover Claude Desktop; this is the standard way to add a remote MCP server to it):

- **Custom connector** (Settings, then Connectors, then **Add custom connector**): paste the address above.
- **Or** the `mcp-remote` bridge, in **Settings, Developer, Edit Config** (`claude_desktop_config.json`), then restart Claude Desktop and complete the sign-in that opens:

```json
{
  "mcpServers": {
    "recallradar": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.atlassian.com/forge/<appId>"]
    }
  }
}
```

*Claude Code* (this is the command Atlassian documents), then run `/mcp` and sign in:

```bash
claude mcp add --transport http recallradar https://mcp.atlassian.com/forge/<appId>
```

**4. Teach the agent how to use the tools (optional but recommended).** [`integrations/claude/recallradar/SKILL.md`](../integrations/claude/recallradar/SKILL.md) is a skill file for third-party agents: which tool for which question, always cite real recall numbers and device ids, say how fresh the data is, and ask the user before creating a task. In Claude Code copy the `recallradar` folder to `~/.claude/skills/`; in Claude Desktop zip the folder and add it under **Settings, Capabilities, Skills**.

**5. Make sure there is a check to read.** The tools read the saved check. Open the RecallRadar dashboard (Jira, Apps, RecallRadar): a check runs by itself after **Load demo hospital**, and **Refresh** runs it again (the daily refresh then keeps it current). Without a saved check the tools say so.
