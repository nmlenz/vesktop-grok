# Vesktop Grok

A fork of [Vesktop](https://github.com/Vencord/Vesktop) with a **Grok Bot connector**.

Vesktop is a custom Discord desktop app. This fork keeps that client and adds a localhost bridge so [Grok Bot](https://docs.x.ai/grok-bot/overview) can use your signed-in Discord session, plus optional in-app Grok chat through the xAI API.

This is an unofficial community fork. It is not affiliated with Discord, Vencord, or xAI.

**Main features**:
- Everything in upstream Vesktop (Vencord, screenshare, privacy-friendly desktop shell)
- Grok Bot MCP connector on `127.0.0.1` (read guilds/channels/messages; send only if you opt in)
- In-app Grok: `/grok`, chat-bar button, and **Ask Grok** on messages
- xAI calls run in the Electron main process, so your API key is never sent to Discord

**Not yet supported** (upstream):
- Global Keybinds
- see the [Vesktop Roadmap](https://github.com/Vencord/Vesktop/issues/324)

## Grok Bot connector

xAI does not ship an official Discord inbound plugin for Grok Bot. This fork is the Vesktop-side connector:

1. Run this app and sign into Discord.
2. Open **Settings → Vesktop → Grok Bot**.
3. Enable **Grok Bot connector**. Copy the MCP URL and bearer token.
4. In Grok Bot, add a custom MCP server:
   - URL: `http://127.0.0.1:18788/mcp`
   - Header: `Authorization: Bearer <token>`
5. Leave **Allow send** off until you want the Bot to post as you.

The server binds to localhost only. Grok Bot's cloud computer cannot reach it unless local computer access or an egress tunnel is enabled. The in-app Grok chat path does not need Grok Bot at all — only an xAI API key from [console.x.ai](https://console.x.ai).

Tools exposed to Grok Bot:

| Tool | What it does |
| --- | --- |
| `discord_status` | Signed-in user and the selected guild/channel or DM |
| `discord_list_guilds` | Servers you are in |
| `discord_search_guilds` | Filter servers by name |
| `discord_list_channels` | Text channels in a server |
| `discord_list_dms` | DMs and group DMs, with recipient ids/names |
| `discord_find_users` | Resolve a name or id from DMs, cache, or a server |
| `discord_read_messages` | Page a channel/DM (max 100 per call). `before` walks older history; `authorIds` filters that page |
| `discord_search_messages` | Search a server or DM by authors, mentions, and text |
| `discord_get_reactions` | Emoji on a message plus each user who reacted (normal and super) |
| `discord_send_message` | Send as you (requires Allow send) |

`discord_read_messages` returns `nextBefore`. Pass that as `before` to keep walking back. Discord will keep serving history as far as this account can see in that channel or DM. Each page is at most 100 messages.

To compare two or three people: `discord_find_users` → `discord_search_messages` with their `authorIds` (server or DM), or page a DM/channel with `authorIds` + `before`. Reaction summaries come back on each read; use `discord_get_reactions` when you need **which user used which emoji**. Search hits do not include reactors.

There is also `GET /health` and `POST /api/tools/<name>` for a plain HTTP client (local exec / curl).

## In-app Grok

In **Settings → Vesktop → Grok Bot**:

- Paste an xAI API key (or export `XAI_API_KEY` before launch)
- Pick a model (`grok-4.6` by default)
- Use `/grok your question`, the sparkle button in the chat bar, or **Ask Grok** on a message

## Building from Source

You need:
- [Git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/en/download) 22+
- pnpm: `npm install --global pnpm`

```sh
git clone https://github.com/nmlenz/vesktop-grok
cd vesktop-grok

pnpm i

# Run without packaging
pnpm start

# Package for your OS (builds land in dist/)
pnpm package
```

## Upstream Vesktop

Packaging, LibVesktop, and general Vesktop behavior match [upstream](https://github.com/Vencord/Vesktop). To pull Vesktop updates:

```sh
git remote add upstream https://github.com/Vencord/Vesktop.git
git fetch upstream
git merge upstream/main
```

License remains GPL-3.0-or-later.
