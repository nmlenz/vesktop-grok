/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const GROK_BOT_DEFAULT_PORT = 18788;
export const GROK_BOT_DEFAULT_MODEL = "grok-4.6";
export const XAI_API_BASE = "https://api.x.ai/v1";

export interface GrokBotSettings {
    /** Local MCP/HTTP sidecar Grok Bot can call on this machine. */
    connector: boolean;
    port: number;
    /** Bearer token for the local sidecar. Generated on first enable. */
    token: string;
    /** Allow Grok Bot to send Discord messages as the signed-in user. */
    allowSend: boolean;
    /** In-app Grok chat (/grok, chat bar, Ask Grok). */
    chat: boolean;
    /** xAI API key for in-app Grok. Never sent to Discord. */
    apiKey: string;
    model: string;
    includeChannelContext: boolean;
}

export const DefaultGrokBotSettings: GrokBotSettings = {
    connector: false,
    port: GROK_BOT_DEFAULT_PORT,
    token: "",
    allowSend: false,
    chat: true,
    apiKey: "",
    model: GROK_BOT_DEFAULT_MODEL,
    includeChannelContext: true
};

export type GrokChatRole = "system" | "user" | "assistant";

export interface GrokChatMessage {
    role: GrokChatRole;
    content: string;
}

export interface GrokChatRequest {
    messages: GrokChatMessage[];
    model?: string;
}

export interface GrokChatResult {
    ok: boolean;
    text?: string;
    error?: string;
    model?: string;
}

export interface GrokBotStatus {
    enabled: boolean;
    running: boolean;
    url: string;
    mcpUrl: string;
    port: number;
    hasToken: boolean;
    token: string;
    allowSend: boolean;
    error?: string;
}

export type DiscordBridgeOp =
    "status" | "listGuilds" | "listChannels" | "readMessages" | "sendMessage" | "searchGuilds";

export interface DiscordBridgeRequest {
    op: DiscordBridgeOp;
    guildId?: string;
    channelId?: string;
    query?: string;
    limit?: number;
    content?: string;
    replyTo?: string;
}

export const GROK_CHAT_SYSTEM_PROMPT =
    "You are Grok, xAI's assistant, talking from inside Discord via Vesktop. " +
    "Be helpful, direct, and concise. If Discord channel context is provided, use it. " +
    "Do not claim to be an official Discord or xAI Discord bot.";
