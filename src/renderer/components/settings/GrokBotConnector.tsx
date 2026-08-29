/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../../grokBot/grokBot.css";

import { Button, Heading, Paragraph } from "@vencord/types/components";
import { Margins, useForceUpdater } from "@vencord/types/utils";
import { Select, showToast, TextInput, useEffect, useState } from "@vencord/types/webpack/common";
import { useSettings } from "renderer/settings";
import { GROK_BOT_DEFAULT_MODEL, GrokBotStatus } from "shared/grokBot";

import { SettingsComponent } from "./Settings";
import { VesktopSettingsSwitch } from "./VesktopSettingsSwitch";

const MODELS = [
    { label: "Grok 4.6", value: GROK_BOT_DEFAULT_MODEL, default: true },
    { label: "Grok 4.5", value: "grok-4.5" },
    { label: "Grok 4.3", value: "grok-4.3" }
];

export const GrokBotConnector: SettingsComponent = () => {
    const settings = useSettings();
    const grok = settings.grokBot;
    const forceUpdate = useForceUpdater();
    const [status, setStatus] = useState<GrokBotStatus | null>(null);
    const [revealToken, setRevealToken] = useState(false);
    const [testing, setTesting] = useState(false);

    async function refreshStatus() {
        const next = await VesktopNative.grokBot.status();
        setStatus(next);
        if (next.token && next.token !== grok.token) grok.token = next.token;
        forceUpdate();
    }

    useEffect(() => {
        refreshStatus();
        const timer = setTimeout(refreshStatus, 400);
        return () => clearTimeout(timer);
    }, [grok.connector, grok.port, grok.token, grok.allowSend]);

    async function copy(text: string, label: string) {
        try {
            await navigator.clipboard.writeText(text);
            showToast(`Copied ${label}`);
        } catch {
            showToast(`Could not copy ${label}`);
        }
    }

    async function testApi() {
        setTesting(true);
        const result = await VesktopNative.grokBot.test();
        setTesting(false);
        showToast(result.ok ? `Grok replied (${result.model})` : (result.error ?? "Test failed"));
    }

    const running = Boolean(status?.running);
    const mcpUrl = status?.mcpUrl ?? `http://127.0.0.1:${grok.port}/mcp`;

    return (
        <div className="vcd-grok-settings">
            <Paragraph>
                Connect Grok Bot to this Discord session over a localhost MCP server, and optionally chat with Grok
                inside Discord via the xAI API.
            </Paragraph>

            <VesktopSettingsSwitch
                title="Grok Bot connector"
                description="Expose a local MCP server so Grok Bot can read this Discord session (and send if you allow it)."
                value={grok.connector}
                onChange={async v => {
                    if (v && !grok.token) grok.token = await VesktopNative.grokBot.regenerateToken();
                    grok.connector = v;
                }}
            />

            <VesktopSettingsSwitch
                title="Allow send"
                description="Let Grok Bot send messages as you. Off by default."
                value={grok.allowSend}
                onChange={v => (grok.allowSend = v)}
                disabled={!grok.connector}
            />

            <div className={`vcd-grok-status ${running ? "vcd-grok-status-ok" : "vcd-grok-status-bad"}`}>
                {grok.connector
                    ? running
                        ? `Connector running at ${mcpUrl}`
                        : `Connector not running${status?.error ? `: ${status.error}` : ""}`
                    : "Connector is off"}
            </div>

            <div className={`vcd-grok-field ${Margins.top16}`}>
                <span className="vcd-grok-field-label">MCP URL</span>
                <div className="vcd-grok-row">
                    <span className="vcd-grok-mono">{mcpUrl}</span>
                    <Button size="small" onClick={() => copy(mcpUrl, "MCP URL")}>
                        Copy
                    </Button>
                </div>
            </div>

            <div className={`vcd-grok-field ${Margins.top8}`}>
                <span className="vcd-grok-field-label">Bearer token</span>
                <div className="vcd-grok-row">
                    <span className="vcd-grok-mono">
                        {grok.token
                            ? revealToken
                                ? grok.token
                                : "•".repeat(24)
                            : "Generated when you enable the connector"}
                    </span>
                    <Button size="small" disabled={!grok.token} onClick={() => setRevealToken(v => !v)}>
                        {revealToken ? "Hide" : "Show"}
                    </Button>
                    <Button size="small" disabled={!grok.token} onClick={() => copy(grok.token, "token")}>
                        Copy
                    </Button>
                    <Button
                        size="small"
                        variant="secondary"
                        onClick={async () => {
                            await VesktopNative.grokBot.regenerateToken();
                            await refreshStatus();
                            showToast("New connector token generated");
                        }}
                    >
                        Rotate
                    </Button>
                </div>
            </div>

            <div className={`vcd-grok-field ${Margins.top8}`}>
                <span className="vcd-grok-field-label">Port</span>
                <TextInput
                    value={String(grok.port)}
                    onChange={(value: string) => {
                        const port = Number(value);
                        if (Number.isInteger(port)) grok.port = port;
                    }}
                />
            </div>

            <Heading tag="h4" className={Margins.top16}>
                Add this to Grok Bot
            </Heading>
            <Paragraph>
                In Grok Bot, open Settings → Plugins and add a custom MCP server pointing at the URL above. Use header{" "}
                <span className="vcd-grok-mono">Authorization: Bearer &lt;token&gt;</span>. The server only listens on
                127.0.0.1. If the Bot runs on its cloud computer, enable local computer access or an egress tunnel so it
                can reach this Mac.
            </Paragraph>

            <Heading tag="h4" className={Margins.top16}>
                In-app Grok
            </Heading>

            <VesktopSettingsSwitch
                title="In-app Grok"
                description="Adds /grok, an Ask Grok message action, and a chat-bar button. Uses your xAI API key."
                value={grok.chat}
                onChange={v => (grok.chat = v)}
            />

            <VesktopSettingsSwitch
                title="Include channel context"
                description="Attach nearby messages when you ask Grok from Discord."
                value={grok.includeChannelContext}
                onChange={v => (grok.includeChannelContext = v)}
                disabled={!grok.chat}
            />

            <div className={`vcd-grok-field ${Margins.top8}`}>
                <span className="vcd-grok-field-label">xAI API key</span>
                <TextInput
                    type="password"
                    value={grok.apiKey}
                    placeholder="xai-... or leave empty to use XAI_API_KEY"
                    onChange={(value: string) => (grok.apiKey = value)}
                />
            </div>

            <div className={`vcd-grok-field ${Margins.top8}`}>
                <span className="vcd-grok-field-label">Model</span>
                <Select
                    options={MODELS}
                    closeOnSelect={true}
                    select={v => (grok.model = v)}
                    isSelected={v => v === grok.model}
                    serialize={s => s}
                />
            </div>

            <div className={`vcd-grok-row ${Margins.top8}`}>
                <Button disabled={testing} onClick={testApi}>
                    {testing ? "Testing…" : "Test xAI connection"}
                </Button>
            </div>
        </div>
    );
};
