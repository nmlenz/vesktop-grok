/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./grokBot.css";

import { addChatBarButton, ChatBarButton } from "@vencord/types/api/ChatButtons";
import {
    ApplicationCommandInputType,
    ApplicationCommandOptionType,
    findOption,
    registerCommand,
    sendBotMessage
} from "@vencord/types/api/Commands";
import { addMessagePopoverButton } from "@vencord/types/api/MessagePopover";
import { Button, ErrorBoundary, FormSwitch, Paragraph } from "@vencord/types/components";
import { onceReady } from "@vencord/types/webpack";
import {
    ChannelStore,
    MessageStore,
    Modal,
    openModal,
    SelectedChannelStore,
    TextArea,
    useEffect,
    useRef,
    useState
} from "@vencord/types/webpack/common";
import { GROK_CHAT_SYSTEM_PROMPT, GrokChatMessage } from "shared/grokBot";

import { Settings, useSettings } from "../settings";
import { GrokIcon } from "./icons";

interface Seed {
    prompt?: string;
}

export function initGrokBotUi() {
    addChatBarButton(
        "vesktop-grok",
        ({ isMainChat }) => {
            const settings = useSettings();
            if (!settings.grokBot.chat || !isMainChat) return null;

            return (
                <ChatBarButton tooltip="Ask Grok" onClick={() => openGrokChat()}>
                    <GrokIcon width={20} height={20} />
                </ChatBarButton>
            );
        },
        GrokIcon
    );

    addMessagePopoverButton(
        "vesktop-grok",
        message => {
            if (!Settings.store.grokBot.chat) return null;
            const content = message.content?.trim();
            if (!content) return null;

            const channel = ChannelStore.getChannel(message.channel_id);
            return {
                label: "Ask Grok",
                icon: GrokIcon,
                message,
                channel,
                onClick: () =>
                    openGrokChat({
                        prompt: `Help with this Discord message from ${message.author?.username ?? "unknown"}:\n${content}`
                    })
            };
        },
        GrokIcon
    );

    onceReady.then(() => {
        registerCommand(
            {
                name: "grok",
                description: "Ask Grok (xAI) from Vesktop",
                inputType: ApplicationCommandInputType.BUILT_IN,
                options: [
                    {
                        name: "prompt",
                        description: "What to ask Grok",
                        type: ApplicationCommandOptionType.STRING,
                        required: true
                    }
                ],
                execute: async (args, { channel }) => {
                    if (!Settings.store.grokBot.chat) {
                        sendBotMessage(channel.id, {
                            content: "Enable **In-app Grok** in Vesktop Settings → Grok Bot.",
                            author: { username: "Grok" }
                        });
                        return;
                    }

                    const prompt = findOption<string>(args, "prompt", "");
                    sendBotMessage(channel.id, {
                        content: "Grok is thinking…",
                        author: { username: "Grok" }
                    });

                    const result = await VesktopNative.grokBot.chat({
                        messages: buildMessages(prompt)
                    });

                    sendBotMessage(channel.id, {
                        content: result.ok ? result.text! : `Grok error: ${result.error}`,
                        author: { username: "Grok" }
                    });
                }
            },
            "VesktopGrok"
        );
    });
}

export function openGrokChat(seed?: Seed) {
    openModal(props => (
        <ErrorBoundary>
            <GrokChatModal seed={seed} modalProps={props} />
        </ErrorBoundary>
    ));
}

function GrokChatModal({ seed, modalProps }: { seed?: Seed; modalProps: any }) {
    const settings = useSettings();
    const [input, setInput] = useState(seed?.prompt ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [messages, setMessages] = useState<GrokChatMessage[]>([]);
    const scroller = useRef<HTMLDivElement>(null);

    useEffect(() => {
        scroller.current?.scrollTo(0, scroller.current.scrollHeight);
    }, [messages, busy]);

    async function send() {
        const prompt = input.trim();
        if (!prompt || busy) return;

        const next: GrokChatMessage[] = [...messages, { role: "user", content: prompt }];
        setMessages(next);
        setInput("");
        setBusy(true);
        setError(null);

        const result = await VesktopNative.grokBot.chat({
            messages: [{ role: "system", content: GROK_CHAT_SYSTEM_PROMPT }, ...maybeContext(), ...next]
        });

        setBusy(false);
        if (!result.ok) {
            setError(result.error ?? "Unknown error");
            return;
        }
        setMessages([...next, { role: "assistant", content: result.text! }]);
    }

    return (
        <Modal {...modalProps} size="lg" title="Grok">
            <Paragraph className="vcd-grok-subtitle">
                Talk to Grok through xAI. Channel context stays on this machine; your API key never goes to Discord.
            </Paragraph>

            <div className="vcd-grok-log" ref={scroller}>
                {messages.length === 0 && <div className="vcd-grok-empty">Ask anything, or use /grok in chat.</div>}
                {messages.map((message, i) => (
                    <div key={i} className={`vcd-grok-bubble vcd-grok-${message.role}`}>
                        <div className="vcd-grok-role">{message.role === "assistant" ? "Grok" : "You"}</div>
                        <div className="vcd-grok-text">{message.content}</div>
                    </div>
                ))}
                {busy && <div className="vcd-grok-empty">Grok is thinking…</div>}
            </div>

            {error && <Paragraph className="vcd-grok-error">{error}</Paragraph>}

            <FormSwitch
                title="Include channel context"
                hideBorder
                value={settings.grokBot.includeChannelContext}
                onChange={v => (settings.grokBot.includeChannelContext = v)}
            />

            <div
                onKeyDown={(e: any) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                    }
                }}
            >
                <TextArea value={input} placeholder="Message Grok" onChange={setInput} />
            </div>

            <div className="vcd-grok-actions">
                <Button disabled={busy || !input.trim()} onClick={send}>
                    Send
                </Button>
            </div>
        </Modal>
    );
}

function buildMessages(prompt: string): GrokChatMessage[] {
    return [{ role: "system", content: GROK_CHAT_SYSTEM_PROMPT }, ...maybeContext(), { role: "user", content: prompt }];
}

function maybeContext(): GrokChatMessage[] {
    if (!Settings.store.grokBot.includeChannelContext) return [];
    const transcript = getChannelTranscript();
    if (!transcript) return [];
    return [
        {
            role: "system",
            content: `Nearby Discord messages for context:\n${transcript}`
        }
    ];
}

function getChannelTranscript(limit = 15) {
    const channelId = SelectedChannelStore.getChannelId?.();
    if (!channelId) return "";

    const collected: string[] = [];
    try {
        MessageStore.getMessages?.(channelId)?.forEach?.((message: any) => {
            const text = message?.content?.trim();
            if (!text) return;
            const name = message.author?.username ?? "user";
            collected.push(`${name}: ${text}`);
        });
    } catch {
        return "";
    }

    return collected.slice(-limit).join("\n");
}
