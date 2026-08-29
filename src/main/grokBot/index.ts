/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomBytes } from "crypto";
import { GROK_BOT_DEFAULT_PORT } from "shared/grokBot";

import { Settings } from "../settings";
import { getConnectorStatus, startGrokBotServer, stopGrokBotServer } from "./mcpServer";

export { getConnectorStatus } from "./mcpServer";
export { grokChat, testGrokConnection } from "./xai";

export function generateConnectorToken() {
    return randomBytes(32).toString("hex");
}

function clampPort(port: number) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return GROK_BOT_DEFAULT_PORT;
    return port;
}

function ensureToken() {
    if (!Settings.store.grokBot.token) {
        Settings.store.grokBot.token = generateConnectorToken();
    }
}

export async function initGrokBot() {
    Settings.store.grokBot.port = clampPort(Settings.store.grokBot.port);

    const sync = async () => {
        if (!Settings.store.grokBot.connector) {
            stopGrokBotServer();
            return;
        }

        ensureToken();
        Settings.store.grokBot.port = clampPort(Settings.store.grokBot.port);

        try {
            await startGrokBotServer();
        } catch (err) {
            console.error("[Grok Bot] failed to start connector", err);
        }
    };

    Settings.addChangeListener("grokBot.connector", sync);
    Settings.addChangeListener("grokBot.port", sync);

    await sync();
}

export function regenerateConnectorToken() {
    Settings.store.grokBot.token = generateConnectorToken();
    return Settings.store.grokBot.token;
}

export function connectorStatus() {
    return getConnectorStatus();
}
