/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";
import { onceReady } from "@vencord/types/webpack";
import {
    ChannelStore,
    GuildStore,
    RestAPI,
    SelectedChannelStore,
    SelectedGuildStore,
    UserStore
} from "@vencord/types/webpack/common";
import { DiscordBridgeRequest } from "shared/grokBot";
import { IpcCommands } from "shared/IpcEvents";

import { onIpcCommand } from "../ipcCommands";

const logger = new Logger("VesktopGrok", "#d4a017");

const TEXT_CHANNEL_TYPES = new Set([0, 5, 10, 11, 12, 15]);

onIpcCommand(IpcCommands.GROK_DISCORD, async (request: DiscordBridgeRequest) => {
    await onceReady;

    switch (request?.op) {
        case "status":
            return status();
        case "listGuilds":
            return listGuilds();
        case "searchGuilds":
            return listGuilds(request.query);
        case "listChannels":
            return listChannels(request.guildId);
        case "readMessages":
            return readMessages(request.channelId, request.limit);
        case "sendMessage":
            return sendMessage(request.channelId, request.content, request.replyTo);
        default:
            throw new Error(`Unknown Discord bridge op: ${request?.op}`);
    }
});

function status() {
    const user = UserStore.getCurrentUser?.();
    const channelId = SelectedChannelStore.getChannelId?.();
    const guildId = SelectedGuildStore.getGuildId?.();
    const channel = channelId ? ChannelStore.getChannel?.(channelId) : null;
    const guild = guildId ? GuildStore.getGuild?.(guildId) : null;

    return {
        user: user
            ? {
                  id: user.id,
                  username: user.username,
                  globalName: user.globalName ?? null
              }
            : null,
        selected: {
            guildId: guildId ?? null,
            guildName: guild?.name ?? null,
            channelId: channelId ?? null,
            channelName: channel?.name ?? (channel?.rawRecipients ? "DM" : null)
        },
        ready: Boolean(user)
    };
}

function listGuilds(query?: string) {
    const guilds = Object.values(GuildStore.getGuilds?.() ?? {}).map((guild: any) => ({
        id: guild.id,
        name: guild.name
    }));

    const needle = query?.trim().toLowerCase();
    return needle ? guilds.filter(g => g.name.toLowerCase().includes(needle)) : guilds;
}

async function listChannels(guildId?: string) {
    if (!guildId) throw new Error("guildId is required");

    const res = await RestAPI.get({ url: `/guilds/${guildId}/channels` });
    const channels = Array.isArray(res?.body) ? res.body : [];

    return channels
        .filter((ch: any) => TEXT_CHANNEL_TYPES.has(ch.type))
        .map((ch: any) => ({
            id: ch.id,
            name: ch.name,
            type: ch.type,
            parentId: ch.parent_id ?? null,
            position: ch.position
        }));
}

async function readMessages(channelId?: string, limit = 25) {
    if (!channelId) throw new Error("channelId is required");

    const res = await RestAPI.get({
        url: `/channels/${channelId}/messages`,
        query: { limit: clamp(limit, 1, 100) }
    });
    const messages = Array.isArray(res?.body) ? res.body : [];

    return messages.slice().reverse().map(summarizeMessage);
}

async function sendMessage(channelId?: string, content?: string, replyTo?: string) {
    if (!channelId) throw new Error("channelId is required");
    const text = content?.trim();
    if (!text) throw new Error("content is required");

    const chunks = splitMessage(text);
    const sent: ReturnType<typeof summarizeMessage>[] = [];

    for (const chunk of chunks) {
        const body: Record<string, unknown> = { content: chunk };
        if (replyTo && sent.length === 0) {
            body.message_reference = { message_id: replyTo, channel_id: channelId };
        }

        const res = await RestAPI.post({
            url: `/channels/${channelId}/messages`,
            body
        });
        sent.push(summarizeMessage(res?.body));
    }

    logger.info(`Sent ${sent.length} message(s) to ${channelId}`);
    return { ok: true, messages: sent };
}

function summarizeMessage(message: any) {
    if (!message) return null;
    return {
        id: message.id,
        channelId: message.channel_id,
        author: message.author
            ? {
                  id: message.author.id,
                  username: message.author.username,
                  globalName: message.author.global_name ?? null,
                  bot: Boolean(message.author.bot)
              }
            : null,
        content: message.content ?? "",
        timestamp: message.timestamp ?? null,
        referencedMessageId: message.message_reference?.message_id ?? null
    };
}

function splitMessage(text: string, max = 1900) {
    if (text.length <= max) return [text];

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length) {
        if (remaining.length <= max) {
            chunks.push(remaining);
            break;
        }
        const slice = remaining.slice(0, max);
        const breakAt = slice.lastIndexOf("\n") > 200 ? slice.lastIndexOf("\n") : max;
        chunks.push(remaining.slice(0, breakAt).trim());
        remaining = remaining.slice(breakAt).trim();
    }
    return chunks.filter(Boolean);
}

function clamp(n: number, min: number, max: number) {
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.trunc(n)));
}
