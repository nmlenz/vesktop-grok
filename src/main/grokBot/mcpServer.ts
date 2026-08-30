/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID } from "crypto";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { DiscordBridgeRequest, GrokBotStatus } from "shared/grokBot";
import { IpcCommands } from "shared/IpcEvents";

import { sendRendererCommand } from "../ipcCommands";
import { Settings } from "../settings";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "vesktop-grok", version: "1.0.0" };

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
    jsonrpc?: string;
    id?: JsonRpcId;
    method?: string;
    params?: any;
}

const TOOLS = [
    {
        name: "discord_status",
        description: "Current Discord session: signed-in user and the selected guild/channel in Vesktop.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
        name: "discord_list_guilds",
        description: "List Discord servers (guilds) the signed-in Vesktop user is in.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
        name: "discord_search_guilds",
        description: "Search the signed-in user's Discord servers by name.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Case-insensitive name substring." }
            },
            required: ["query"],
            additionalProperties: false
        }
    },
    {
        name: "discord_list_channels",
        description: "List text channels in a Discord server (not DMs).",
        inputSchema: {
            type: "object",
            properties: {
                guildId: { type: "string", description: "Discord guild/server snowflake." }
            },
            required: ["guildId"],
            additionalProperties: false
        }
    },
    {
        name: "discord_list_dms",
        description:
            "List DM and group-DM channels visible to the signed-in Vesktop user, including recipient user ids/names.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
        name: "discord_find_users",
        description:
            "Resolve people by username, display name, or id from DMs, the user cache, and optionally a server member search.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Name, display name, or user snowflake." },
                guildId: { type: "string", description: "Optional server to search members in." }
            },
            required: ["query"],
            additionalProperties: false
        }
    },
    {
        name: "discord_read_messages",
        description:
            "Read messages in a server channel or DM. Each call returns at most 100 messages. Pass nextBefore as before to walk older history. authorIds filters the fetched page (still pages the full channel; use search for sparse authors).",
        inputSchema: {
            type: "object",
            properties: {
                channelId: { type: "string", description: "Channel or DM snowflake." },
                limit: { type: "integer", minimum: 1, maximum: 100, description: "How many messages (default 25)." },
                before: { type: "string", description: "Oldest-id cursor: messages older than this snowflake." },
                after: { type: "string", description: "Messages newer than this snowflake." },
                around: { type: "string", description: "Messages around this snowflake." },
                authorIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Only keep messages from these user snowflakes in this page."
                }
            },
            required: ["channelId"],
            additionalProperties: false
        }
    },
    {
        name: "discord_search_messages",
        description:
            "Search a server or a DM for messages by authors, mentions, and/or text. Better than paging when analyzing a few specific people. Search results do not include reaction users — call discord_get_reactions on hits that matter.",
        inputSchema: {
            type: "object",
            properties: {
                guildId: { type: "string", description: "Server snowflake. Required unless channelId is a DM." },
                channelId: {
                    type: "string",
                    description: "Limit to this channel, or search inside a DM when guildId is omitted."
                },
                authorIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Authors to include (max 100). Use for 2–3 people you want to compare."
                },
                mentionIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Messages that mention these users."
                },
                content: { type: "string", description: "Text query." },
                limit: { type: "integer", minimum: 1, maximum: 25, description: "Hits per page (default 25)." },
                offset: { type: "integer", minimum: 0, maximum: 9975, description: "Search page offset." }
            },
            additionalProperties: false
        }
    },
    {
        name: "discord_get_reactions",
        description:
            "Who reacted to a message, and with which emoji. Omit emoji to fetch every reaction on the message. Unicode emoji or custom name:id. Includes normal and super (burst) reactions unless includeBurst is false.",
        inputSchema: {
            type: "object",
            properties: {
                channelId: { type: "string", description: "Channel or DM snowflake." },
                messageId: { type: "string", description: "Message snowflake." },
                emoji: {
                    type: "string",
                    description: "Optional. Unicode (👍) or custom name:id. Also accepts <:name:id> / <a:name:id>."
                },
                limit: {
                    type: "integer",
                    minimum: 1,
                    maximum: 100,
                    description: "Users per emoji (default 100)."
                },
                after: { type: "string", description: "User-id cursor for more reactors on one emoji." },
                includeBurst: { type: "boolean", description: "Include super reactions (default true)." }
            },
            required: ["channelId", "messageId"],
            additionalProperties: false
        }
    },
    {
        name: "discord_send_message",
        description:
            "Send a message as the signed-in Vesktop user. Requires the Allow Send setting. Prefer the selected channel unless the user named another one.",
        inputSchema: {
            type: "object",
            properties: {
                channelId: { type: "string", description: "Discord channel snowflake." },
                content: { type: "string", description: "Message text (max 2000 characters per chunk)." },
                replyTo: { type: "string", description: "Optional message id to reply to." }
            },
            required: ["channelId", "content"],
            additionalProperties: false
        }
    }
] as const;

let server: Server | undefined;
let lastError: string | undefined;
const sessionId = randomUUID();

export function getConnectorStatus(): GrokBotStatus {
    const { grokBot } = Settings.store;
    const { port } = grokBot;
    const url = `http://127.0.0.1:${port}`;
    return {
        enabled: grokBot.connector,
        running: Boolean(server?.listening),
        url,
        mcpUrl: `${url}/mcp`,
        port,
        hasToken: Boolean(grokBot.token),
        token: grokBot.token,
        allowSend: grokBot.allowSend,
        error: lastError
    };
}

export function stopGrokBotServer() {
    lastError = undefined;
    const current = server;
    server = undefined;
    if (!current) return;
    current.close();
}

export async function startGrokBotServer() {
    stopGrokBotServer();

    const { grokBot } = Settings.store;
    if (!grokBot.connector) return;

    const { port } = grokBot;
    const next = createServer((req, res) => {
        handleRequest(req, res).catch(err => {
            if (!res.headersSent) {
                json(res, 500, { error: String(err) });
            }
        });
    });

    await new Promise<void>((resolve, reject) => {
        next.once("error", err => {
            lastError = err.message;
            server = undefined;
            reject(err);
        });
        next.listen(port, "127.0.0.1", () => {
            lastError = undefined;
            server = next;
            console.log(`[Grok Bot] connector listening on http://127.0.0.1:${port}/mcp`);
            resolve();
        });
    });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    const host = req.headers.host || "127.0.0.1";
    const url = new URL(req.url || "/", `http://${host}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, mcp-session-id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { ok: true, ...getConnectorStatus(), server: SERVER_INFO });
        return;
    }

    if (!isAuthorized(req)) {
        json(res, 401, { error: "Unauthorized. Send Authorization: Bearer <token> from Vesktop Settings → Grok Bot." });
        return;
    }

    if (req.method === "GET" && (url.pathname === "/mcp" || url.pathname === "/")) {
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "mcp-session-id": sessionId
        });
        res.write(`event: endpoint\ndata: /mcp\n\n`);
        return;
    }

    if (req.method === "DELETE" && url.pathname === "/mcp") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/tools/")) {
        const name = decodeURIComponent(url.pathname.slice("/api/tools/".length));
        const body = await readJson(req);
        const result = await callTool(name, body && typeof body === "object" ? body : {});
        json(res, result.isError ? 400 : 200, result);
        return;
    }

    if (req.method === "POST" && (url.pathname === "/mcp" || url.pathname === "/")) {
        const body = await readJson(req);
        if (Array.isArray(body)) {
            const results: unknown[] = [];
            for (const item of body) {
                const handled = await handleRpc(item);
                if (handled) results.push(handled);
            }
            json(res, 200, results, sessionId);
            return;
        }

        const handled = await handleRpc(body);
        if (!handled) {
            res.writeHead(202, { "mcp-session-id": sessionId });
            res.end();
            return;
        }
        json(res, 200, handled, sessionId);
        return;
    }

    json(res, 404, { error: "Not found" });
}

function isAuthorized(req: IncomingMessage) {
    const { token } = Settings.store.grokBot;
    if (!token) return false;
    const header = req.headers.authorization;
    if (!header) return false;
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return Boolean(match && match[1] === token);
}

async function handleRpc(message: JsonRpcRequest) {
    if (!message || typeof message !== "object") {
        return rpcError(null, -32600, "Invalid Request");
    }

    const { id, method, params } = message;
    const isNotification = id === undefined;

    try {
        switch (method) {
            case "initialize":
                return rpcResult(id, {
                    protocolVersion: PROTOCOL_VERSION,
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: SERVER_INFO
                });
            case "notifications/initialized":
            case "notifications/cancelled":
                return null;
            case "ping":
                return rpcResult(id, {});
            case "tools/list":
                return rpcResult(id, { tools: TOOLS });
            case "tools/call": {
                const name = params?.name;
                const args = params?.arguments ?? {};
                const result = await callTool(String(name || ""), args);
                return rpcResult(id, result);
            }
            default:
                if (isNotification) return null;
                return rpcError(id ?? null, -32601, `Method not found: ${method}`);
        }
    } catch (err) {
        if (isNotification) return null;
        return rpcError(id ?? null, -32603, String(err));
    }
}

async function callTool(name: string, args: Record<string, any>) {
    try {
        switch (name) {
            case "discord_status":
                return toolText(await discord({ op: "status" }));
            case "discord_list_guilds":
                return toolText(await discord({ op: "listGuilds" }));
            case "discord_search_guilds":
                return toolText(await discord({ op: "searchGuilds", query: String(args.query || "") }));
            case "discord_list_channels":
                return toolText(await discord({ op: "listChannels", guildId: String(args.guildId || "") }));
            case "discord_list_dms":
                return toolText(await discord({ op: "listDms" }));
            case "discord_find_users":
                return toolText(
                    await discord({
                        op: "findUsers",
                        query: String(args.query || ""),
                        guildId: args.guildId ? String(args.guildId) : undefined
                    })
                );
            case "discord_read_messages":
                return toolText(
                    await discord({
                        op: "readMessages",
                        channelId: String(args.channelId || ""),
                        limit: Number(args.limit) || 25,
                        before: optionalString(args.before),
                        after: optionalString(args.after),
                        around: optionalString(args.around),
                        authorIds: stringList(args.authorIds)
                    })
                );
            case "discord_search_messages":
                return toolText(
                    await discord({
                        op: "searchMessages",
                        guildId: optionalString(args.guildId),
                        channelId: optionalString(args.channelId),
                        authorIds: stringList(args.authorIds),
                        mentionIds: stringList(args.mentionIds),
                        content: optionalString(args.content),
                        limit: Number(args.limit) || 25,
                        offset: Number(args.offset) || 0
                    })
                );
            case "discord_get_reactions":
                return toolText(
                    await discord({
                        op: "getReactions",
                        channelId: String(args.channelId || ""),
                        messageId: String(args.messageId || ""),
                        emoji: optionalString(args.emoji),
                        limit: Number(args.limit) || 100,
                        after: optionalString(args.after),
                        includeBurst: args.includeBurst !== false
                    })
                );
            case "discord_send_message": {
                if (!Settings.store.grokBot.allowSend) {
                    return toolText(
                        {
                            error: "Sending is disabled. Enable Allow Send in Vesktop Settings → Grok Bot."
                        },
                        true
                    );
                }
                return toolText(
                    await discord({
                        op: "sendMessage",
                        channelId: String(args.channelId || ""),
                        content: String(args.content || ""),
                        replyTo: args.replyTo ? String(args.replyTo) : undefined
                    })
                );
            }
            default:
                return toolText({ error: `Unknown tool: ${name}` }, true);
        }
    } catch (err) {
        return toolText({ error: String(err) }, true);
    }
}

async function discord(request: DiscordBridgeRequest) {
    return sendRendererCommand(IpcCommands.GROK_DISCORD, request);
}

function optionalString(value: unknown) {
    if (value == null) return undefined;
    const text = String(value).trim();
    return text.length ? text : undefined;
}

function stringList(value: unknown) {
    if (value == null || value === "") return undefined;
    const items = Array.isArray(value)
        ? value.map(v => String(v).trim())
        : String(value)
              .split(",")
              .map(v => v.trim());
    const list = items.filter(Boolean);
    return list.length ? list : undefined;
}

function toolText(payload: unknown, isError = false) {
    return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        isError
    };
}

function rpcResult(id: JsonRpcId | undefined, result: unknown) {
    return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
    return { jsonrpc: "2.0", id, error: { code, message } };
}

function json(res: ServerResponse, status: number, body: unknown, mcpSession?: string) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload),
        ...(mcpSession ? { "mcp-session-id": mcpSession } : {})
    });
    res.end(payload);
}

async function readJson(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        if (chunks.reduce((n, c) => n + c.length, 0) > 2_000_000) {
            throw new Error("Request body too large");
        }
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
}
