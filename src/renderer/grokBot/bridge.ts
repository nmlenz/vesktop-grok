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
const DM_CHANNEL_TYPES = new Set([1, 3]);
const CUSTOM_EMOJI = /^<a?:([a-zA-Z0-9_]+):(\d+)>$/;

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
        case "listDms":
            return listDms();
        case "findUsers":
            return findUsers(request.query, request.guildId);
        case "readMessages":
            return readMessages(request);
        case "searchMessages":
            return searchMessages(request);
        case "getReactions":
            return getReactions(request);
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
        user: summarizeUser(user),
        selected: {
            guildId: guildId ?? null,
            guildName: guild?.name ?? null,
            channelId: channelId ?? null,
            channelName: channelName(channel),
            channelType: channel?.type ?? null
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

async function listDms() {
    const byId = new Map<string, any>();

    try {
        const res = await RestAPI.get({ url: "/users/@me/channels" });
        const channels = Array.isArray(res?.body) ? res.body : [];
        for (const ch of channels) {
            if (DM_CHANNEL_TYPES.has(ch.type)) byId.set(ch.id, summarizeDm(ch));
        }
    } catch (err) {
        logger.warn("Failed to list DMs from REST, using local cache", err);
    }

    const cached = ChannelStore.getSortedPrivateChannels?.() ?? [];
    for (const ch of cached) {
        if (!DM_CHANNEL_TYPES.has(ch.type)) continue;
        if (!byId.has(ch.id)) byId.set(ch.id, summarizeDm(ch));
    }

    return [...byId.values()];
}

async function findUsers(query?: string, guildId?: string) {
    const needle = query?.trim();
    if (!needle) throw new Error("query is required");

    const hits = new Map<string, any>();
    const add = (user: any, source: string) => {
        const summary = summarizeUser(user);
        if (!summary) return;
        const existing = hits.get(summary.id);
        if (existing) {
            if (!existing.sources.includes(source)) existing.sources.push(source);
            return;
        }
        hits.set(summary.id, { ...summary, sources: [source] });
    };

    if (/^\d{17,20}$/.test(needle)) {
        const cached = UserStore.getUser?.(needle);
        if (cached) add(cached, "id");
    }

    const lowered = needle.toLowerCase();
    for (const user of Object.values(UserStore.getUsers?.() ?? {})) {
        if (userMatches(user, lowered)) add(user, "cache");
    }

    for (const ch of ChannelStore.getSortedPrivateChannels?.() ?? []) {
        for (const recipient of recipientsOf(ch)) {
            if (userMatches(recipient, lowered)) add(recipient, "dm");
        }
    }

    if (guildId) {
        const res = await RestAPI.get({
            url: `/guilds/${guildId}/members/search`,
            query: { query: needle, limit: 10 }
        });
        const members = Array.isArray(res?.body) ? res.body : [];
        for (const member of members) add(member.user ?? member, "guild");
    }

    return [...hits.values()].slice(0, 25);
}

async function readMessages(request: DiscordBridgeRequest) {
    const { channelId } = request;
    if (!channelId) throw new Error("channelId is required");

    const query: Record<string, any> = { limit: clamp(request.limit ?? 25, 1, 100) };
    if (request.before) query.before = request.before;
    else if (request.after) query.after = request.after;
    else if (request.around) query.around = request.around;

    const res = await RestAPI.get({
        url: `/channels/${channelId}/messages`,
        query
    });
    const fetched = Array.isArray(res?.body) ? res.body : [];
    const chronological = fetched.slice().reverse();
    const authorIds = new Set(request.authorIds ?? []);
    const matched = authorIds.size ? chronological.filter((m: any) => authorIds.has(m.author?.id)) : chronological;

    const oldestId = chronological[0]?.id ?? null;
    const newestId = chronological.at(-1)?.id ?? null;

    return {
        channelId,
        messages: matched.map(summarizeMessage).filter(Boolean),
        fetched: fetched.length,
        matched: matched.length,
        oldestId,
        newestId,
        hasMore: fetched.length === query.limit,
        nextBefore: oldestId,
        hint: "Pass nextBefore as before to read older messages. Discord keeps history as far back as this account can see in that channel or DM."
    };
}

async function searchMessages(request: DiscordBridgeRequest) {
    const { guildId, channelId } = request;
    if (!guildId && !channelId) throw new Error("guildId or channelId is required");

    const params = new URLSearchParams();
    params.set("limit", String(clamp(request.limit ?? 25, 1, 25)));
    if (request.offset) params.set("offset", String(Math.max(0, Math.trunc(request.offset))));
    if (request.content) params.set("content", request.content);
    for (const id of request.authorIds ?? []) params.append("author_id", id);
    for (const id of request.mentionIds ?? []) params.append("mentions", id);
    if (guildId && channelId) params.append("channel_id", channelId);

    const path = guildId
        ? `/guilds/${guildId}/messages/search?${params}`
        : `/channels/${channelId}/messages/search?${params}`;

    const res = await RestAPI.get({ url: path });
    const body = res?.body ?? {};
    const groups: any[][] = Array.isArray(body.messages) ? body.messages : [];
    const results = groups.map(group => {
        const hit = group[group.length - 1];
        return {
            ...summarizeMessage(hit),
            context: group.slice(0, -1).map(summarizeMessage)
        };
    });

    const offset = request.offset ?? 0;
    return {
        totalResults: body.total_results ?? results.length,
        results,
        offset,
        nextOffset: offset + results.length,
        hasMore: (body.total_results ?? 0) > offset + results.length,
        hint: "Search hits omit reaction users. Call discord_get_reactions with channelId and messageId to see who used which emoji."
    };
}

async function getReactions(request: DiscordBridgeRequest) {
    const { channelId, messageId } = request;
    if (!channelId) throw new Error("channelId is required");
    if (!messageId) throw new Error("messageId is required");

    const limit = clamp(request.limit ?? 100, 1, 100);
    const includeBurst = request.includeBurst !== false;
    const emojis = request.emoji
        ? [normalizeEmoji(request.emoji)]
        : await reactionEmojisOnMessage(channelId, messageId);

    if (!emojis.length) {
        return { channelId, messageId, reactions: [], hint: "This message has no reactions." };
    }

    const reactions: Array<{
        emoji: ReturnType<typeof describeEmoji>;
        type: "normal" | "burst";
        users: UserSummary[];
        count: number;
        hasMore: boolean;
        nextAfter: string | null;
    }> = [];
    for (const emoji of emojis.slice(0, 25)) {
        const types: Array<{ type: 0 | 1; label: "normal" | "burst" }> = [{ type: 0, label: "normal" }];
        if (includeBurst) types.push({ type: 1, label: "burst" });

        for (const { type, label } of types) {
            const users = await reactionUsers(channelId, messageId, emoji, {
                limit,
                after: request.after,
                type
            });
            if (!users.length && label === "burst") continue;
            reactions.push({
                emoji: describeEmoji(emoji),
                type: label,
                users,
                count: users.length,
                hasMore: users.length === limit,
                nextAfter: users.at(-1)?.id ?? null
            });
        }
    }

    return { channelId, messageId, reactions };
}

async function reactionEmojisOnMessage(channelId: string, messageId: string) {
    const res = await RestAPI.get({
        url: `/channels/${channelId}/messages`,
        query: { around: messageId, limit: 1 }
    });
    const message = Array.isArray(res?.body) ? (res.body.find((m: any) => m.id === messageId) ?? res.body[0]) : null;
    const reactions = Array.isArray(message?.reactions) ? message.reactions : [];
    return reactions.map((reaction: any) => emojiKey(reaction.emoji)).filter(Boolean);
}

async function reactionUsers(
    channelId: string,
    messageId: string,
    emoji: string,
    opts: { limit: number; after?: string; type: 0 | 1 }
) {
    const encoded = encodeURIComponent(emoji);
    const query: Record<string, any> = { limit: opts.limit, type: opts.type };
    if (opts.after) query.after = opts.after;

    try {
        const res = await RestAPI.get({
            url: `/channels/${channelId}/messages/${messageId}/reactions/${encoded}`,
            query
        });
        const users = Array.isArray(res?.body) ? res.body : [];
        return users.map(summarizeUser).filter((user): user is UserSummary => user != null);
    } catch (err) {
        if (opts.type === 1) return [];
        logger.warn("Failed to fetch reactions", emoji, err);
        throw err;
    }
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

function summarizeDm(ch: any) {
    const people = recipientsOf(ch)
        .map(summarizeUser)
        .filter((user): user is UserSummary => user != null);
    return {
        id: ch.id,
        type: ch.type,
        kind: ch.type === 3 ? "group_dm" : "dm",
        name: ch.name || people.map((p: any) => p.globalName || p.username).join(", ") || "DM",
        recipients: people,
        lastMessageId: ch.last_message_id ?? ch.lastMessageId ?? null
    };
}

function summarizeMessage(message: any) {
    if (!message) return null;
    return {
        id: message.id,
        channelId: message.channel_id,
        author: summarizeUser(message.author),
        content: message.content ?? "",
        timestamp: message.timestamp ?? null,
        referencedMessageId: message.message_reference?.message_id ?? null,
        mentionIds: Array.isArray(message.mentions) ? message.mentions.map((u: any) => u.id) : [],
        reactions: summarizeReactions(message.reactions)
    };
}

function summarizeReactions(reactions: any) {
    if (!Array.isArray(reactions)) return [];
    return reactions.map((reaction: any) => ({
        emoji: {
            id: reaction.emoji?.id ?? null,
            name: reaction.emoji?.name ?? null,
            animated: Boolean(reaction.emoji?.animated),
            key: emojiKey(reaction.emoji)
        },
        count: reaction.count ?? 0,
        burstCount: reaction.count_details?.burst ?? 0,
        me: Boolean(reaction.me),
        meBurst: Boolean(reaction.me_burst)
    }));
}

interface UserSummary {
    id: string;
    username: string | null;
    globalName: string | null;
    bot: boolean;
}

function summarizeUser(user: any): UserSummary | null {
    if (!user?.id) return null;
    return {
        id: user.id,
        username: user.username ?? null,
        globalName: user.globalName ?? user.global_name ?? user.display_name ?? null,
        bot: Boolean(user.bot)
    };
}

function recipientsOf(ch: any) {
    return ch?.recipients ?? ch?.rawRecipients ?? [];
}

function channelName(channel: any) {
    if (!channel) return null;
    if (channel.name) return channel.name;
    const people = recipientsOf(channel).map((u: any) => u.globalName ?? u.global_name ?? u.username);
    return people.length ? people.join(", ") : "DM";
}

function userMatches(user: any, needle: string) {
    if (!user) return false;
    if (user.id === needle) return true;
    const fields = [user.username, user.globalName, user.global_name, user.display_name, user.displayName];
    return fields.some(field => typeof field === "string" && field.toLowerCase().includes(needle));
}

function emojiKey(emoji: any) {
    if (!emoji) return "";
    if (emoji.id) return `${emoji.name}:${emoji.id}`;
    return emoji.name ?? "";
}

function normalizeEmoji(raw: string) {
    const trimmed = raw.trim();
    const custom = CUSTOM_EMOJI.exec(trimmed);
    if (custom) return `${custom[1]}:${custom[2]}`;
    if (trimmed.startsWith(":") && trimmed.includes(":")) {
        return trimmed.replace(/^:|:$/g, "");
    }
    return trimmed;
}

function describeEmoji(key: string) {
    const [name, id] = key.includes(":")
        ? [key.slice(0, key.lastIndexOf(":")), key.slice(key.lastIndexOf(":") + 1)]
        : [key, null];
    const looksCustom = Boolean(id && /^\d{17,20}$/.test(id));
    return {
        id: looksCustom ? id : null,
        name: looksCustom ? name : key,
        key,
        custom: looksCustom
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
