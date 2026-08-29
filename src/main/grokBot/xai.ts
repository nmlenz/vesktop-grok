/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GROK_BOT_DEFAULT_MODEL, GrokChatMessage, GrokChatResult, XAI_API_BASE } from "shared/grokBot";

import { Settings } from "../settings";

function resolveApiKey() {
    const fromSettings = Settings.store.grokBot?.apiKey?.trim();
    if (fromSettings) return fromSettings;
    return process.env.XAI_API_KEY?.trim() || "";
}

function resolveModel(override?: string) {
    return override?.trim() || Settings.store.grokBot?.model?.trim() || GROK_BOT_DEFAULT_MODEL;
}

export async function grokChat(messages: GrokChatMessage[], modelOverride?: string): Promise<GrokChatResult> {
    const apiKey = resolveApiKey();
    if (!apiKey) {
        return {
            ok: false,
            error: "No xAI API key. Add one in Vesktop Settings → Grok Bot, or set XAI_API_KEY."
        };
    }

    const model = resolveModel(modelOverride);
    const res = await fetch(`${XAI_API_BASE}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model,
            messages
        })
    });

    const raw = await res.text();
    let data: any;
    try {
        data = JSON.parse(raw);
    } catch {
        return { ok: false, error: `xAI returned non-JSON (${res.status}): ${raw.slice(0, 300)}` };
    }

    if (!res.ok) {
        const message = data?.error?.message || data?.error || raw.slice(0, 300);
        return { ok: false, error: `xAI ${res.status}: ${message}` };
    }

    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
        return { ok: false, error: "xAI returned an empty reply.", model };
    }

    return { ok: true, text, model };
}

export async function testGrokConnection(): Promise<GrokChatResult> {
    return grokChat([{ role: "user", content: "Reply with the single word: pong" }]);
}
