"use client";

/**
 * The copilot panel (UIUX-PLAN.md S-39, P4-T14a-b).
 *
 * A side panel opened with ⌘J, holding one conversation. Turns arrive word by
 * word, the reader can stop an answer halfway, and every answer shows the
 * passages it was grounded in as links they can open.
 *
 * **The stop control is an aborted request, not a second endpoint.** Pressing
 * stop aborts the fetch, the route's `request.signal` fires, and the server
 * records what had arrived. So what the reader saw is what the thread holds, and
 * nothing is lost between the two.
 *
 * **The thread is re-read from the server after every turn.** The streamed text
 * is what the reader watches; the recorded message, with its citations filtered
 * against their access at that moment, is what they keep. Drawing the stream
 * forever would show citations nobody checked again.
 *
 * **Three states before a question is possible.** Empty is the first open with
 * nothing asked. AI off is a provider that cannot write prose, and it still
 * offers the passages, which is §2.4's own degradation rather than a dead panel.
 * Capped is a budget or a switch, and it says which.
 */
import { Button, Chip, Kbd, useKeyboardShortcut } from "@openokr/ui";
import { Loader2, MessageSquare, Send, Square, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  copilotAvailabilityAction,
  listCopilotThreadsAction,
  readCopilotThreadAction,
} from "./actions";

interface Citation {
  readonly entityType: string;
  readonly entityId: string;
  readonly label: string;
}

interface Message {
  readonly id: string;
  readonly role: "member" | "assistant";
  readonly content: string;
  readonly citations: readonly Citation[];
  readonly stopped: boolean;
}

interface ThreadSummary {
  readonly id: string;
  readonly title: string | null;
}

interface Availability {
  readonly available: boolean;
  readonly providerConfigured: boolean;
  readonly reason: string | null;
  readonly streaming: boolean;
}

interface Source {
  readonly entityType: string;
  readonly entityId: string;
  readonly label: string;
}

/**
 * Where a cited or retrieved thing lives.
 *
 * Only the types that have a page of their own are linked. Everything else is
 * named without a link, which is honest: a retro note has no address, and a link
 * to nowhere is worse than plain text.
 */
function hrefFor(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "goal":
      return `/goals/${entityId}`;
    case "kpi":
      return `/kpis/${entityId}`;
    default:
      return null;
  }
}

/** How a source or citation reads: its own first line, or its type. */
const labelFor = (item: Source | Citation) =>
  item.label === "" ? item.entityType.replace("_", " ") : item.label;

function SourceList({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly (Source | Citation)[];
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="mt-2">
      <p className="text-xs text-ink-4">{title}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((item) => {
          const href = hrefFor(item.entityType, item.entityId);
          return (
            <li key={`${item.entityType}:${item.entityId}`} className="text-xs">
              {href ? (
                <Link href={href} className="text-ink-2 underline">
                  {labelFor(item)}
                </Link>
              ) : (
                <span className="text-ink-3">{labelFor(item)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Turn({ message }: { readonly message: Message }) {
  const mine = message.role === "member";
  return (
    <div className={mine ? "text-right" : ""}>
      <div
        className={`inline-block max-w-[46ch] whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-sm ${
          mine ? "bg-surface-2 text-ink" : "bg-surface text-ink"
        }`}
      >
        {message.content}
        {message.stopped ? (
          <span className="mt-1 block">
            <Chip tone="warn">Stopped</Chip>
          </span>
        ) : null}
      </div>
      {mine ? null : <SourceList title="Sources" items={message.citations} />}
    </div>
  );
}

export function CopilotPanel({
  initialAvailability,
}: {
  /** Read on the server so the first open needs no round trip. */
  readonly initialAvailability: Availability;
}) {
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState(initialAvailability);
  const [threads, setThreads] = useState<readonly ThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [question, setQuestion] = useState("");
  /** The answer as it arrives. Replaced by the recorded message when it lands. */
  const [streaming, setStreaming] = useState<string | null>(null);
  const [sources, setSources] = useState<readonly Source[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useKeyboardShortcut(
    {
      id: "copilot",
      keys: "⌘J",
      description: "Ask the copilot",
      group: "Global",
    },
    () => setOpen((was) => !was),
    { key: "j", mod: true, allowInInputs: true },
  );

  // Re-read availability and the thread list on every open: a budget spent in
  // another tab, or a conversation started on another device, should be visible
  // without a reload.
  useEffect(() => {
    if (!open) {
      return;
    }
    inputRef.current?.focus();
    let live = true;
    void (async () => {
      const [next, list] = await Promise.all([
        copilotAvailabilityAction(),
        listCopilotThreadsAction(),
      ]);
      if (live) {
        setAvailability(next);
        setThreads(list);
      }
    })();
    return () => {
      live = false;
    };
  }, [open]);

  const loadThread = useCallback(async (id: string) => {
    const thread = await readCopilotThreadAction(id);
    setThreadId(thread.id);
    setMessages(thread.messages);
    setStreaming(null);
    setSources([]);
    setNotice(null);
  }, []);

  const stop = useCallback(() => {
    abort.current?.abort();
  }, []);

  const send = useCallback(async () => {
    const asked = question.trim();
    if (asked === "" || busy) {
      return;
    }
    setQuestion("");
    setBusy(true);
    setNotice(null);
    setSources([]);
    setStreaming("");
    // Shown straight away rather than after the round trip. The id is the
    // server's, so this turn is replaced when the thread is re-read.
    setMessages((current) => [
      ...current,
      {
        id: `pending-${current.length}`,
        role: "member",
        content: asked,
        citations: [],
        stopped: false,
      },
    ]);

    const controller = new AbortController();
    abort.current = controller;
    let landedThreadId = threadId;
    try {
      const response = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: asked,
          ...(threadId ? { threadId } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        setNotice(
          "The copilot could not be reached. Your question was not saved.",
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        // Server-Sent Events: frames are separated by a blank line, and only
        // the `data:` line is parsed. The `event:` line names the same kind the
        // payload carries, so nothing is read twice.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame
            .split("\n")
            .find((part) => part.startsWith("data: "));
          if (!line) {
            continue;
          }
          const event = JSON.parse(line.slice(6)) as
            | { kind: "thread"; threadId: string }
            | { kind: "sources"; sources: readonly Source[] }
            | { kind: "unavailable"; reason: string }
            | { kind: "text"; text: string }
            | { kind: "done" };
          if (event.kind === "thread") {
            landedThreadId = event.threadId;
            setThreadId(event.threadId);
          } else if (event.kind === "sources") {
            setSources(event.sources);
          } else if (event.kind === "unavailable") {
            setNotice(event.reason);
          } else if (event.kind === "text") {
            text += event.text;
            setStreaming(text);
          }
        }
      }
    } catch (error) {
      // An abort is the stop control working, not a failure. What arrived was
      // recorded by the server, and the re-read below shows it.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setNotice("The answer stopped early. What arrived was saved.");
      }
    } finally {
      abort.current = null;
      setBusy(false);
      setStreaming(null);
      if (landedThreadId) {
        // The recorded thread, with citations filtered against access now,
        // replaces everything drawn optimistically above.
        await loadThread(landedThreadId).catch(() => undefined);
      }
    }
  }, [busy, loadThread, question, threadId]);

  if (!open) {
    return (
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label="Ask the copilot"
      >
        <MessageSquare className="size-4" />
        <span className="hidden sm:inline">Ask</span>
        <Kbd>⌘J</Kbd>
      </Button>
    );
  }

  const canAsk = availability.available;

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => setOpen(false)}
        aria-label="Ask the copilot"
      >
        <MessageSquare className="size-4" />
        <span className="hidden sm:inline">Ask</span>
        <Kbd>⌘J</Kbd>
      </Button>
      <aside
        role="dialog"
        aria-label="Copilot"
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-100 flex-col border-l border-line bg-bg shadow-lg"
      >
        <header className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium text-ink">Copilot</h2>
          {availability.providerConfigured ? null : (
            <Chip tone="neutral">AI off</Chip>
          )}
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => setOpen(false)}
            aria-label="Close the copilot"
          >
            <X className="size-4" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {messages.length === 0 && streaming === null ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-ink-3">
                Ask about this workspace's goals, metrics and reviews. Answers
                cite what they came from, and only what you can already read.
              </p>
              {threads.length > 0 ? (
                <div>
                  <p className="text-xs text-ink-4">Earlier conversations</p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {threads.map((thread) => (
                      <li key={thread.id}>
                        <button
                          type="button"
                          className="text-left text-xs text-ink-2 underline"
                          onClick={() => void loadThread(thread.id)}
                        >
                          {thread.title ?? "Untitled"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((message) => (
                <Turn key={message.id} message={message} />
              ))}
              {streaming !== null ? (
                <div className="whitespace-pre-wrap rounded-lg bg-surface px-3 py-2 text-sm text-ink">
                  {streaming === "" ? (
                    <span className="flex items-center gap-2 text-ink-4">
                      <Loader2 className="size-3.5 animate-spin" />
                      Reading your workspace
                    </span>
                  ) : (
                    streaming
                  )}
                </div>
              ) : null}
            </div>
          )}

          {notice ? (
            <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-ink-3">
              {notice}
            </p>
          ) : null}
          {/* The passages, shown whether or not a model used them. With the
              provider off this is the answer. */}
          <SourceList title="Passages that match" items={sources} />
        </div>

        <footer className="flex-none border-t border-line px-4 py-3">
          {canAsk ? null : (
            <p className="mb-2 text-xs text-ink-3">
              {availability.reason ??
                "The copilot cannot answer in this workspace right now."}
            </p>
          )}
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="sr-only">Your question</span>
              <textarea
                ref={inputRef}
                rows={2}
                value={question}
                disabled={busy}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  canAsk
                    ? "Ask a question"
                    : "Search your workspace for matching passages"
                }
                className="w-full resize-none rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none placeholder:text-ink-4"
              />
            </label>
            {busy && availability.streaming ? (
              <Button
                variant="ghost"
                onClick={stop}
                aria-label="Stop the answer"
              >
                <Square className="size-4" />
                Stop
              </Button>
            ) : (
              <Button
                onClick={() => void send()}
                disabled={busy || question.trim() === ""}
                aria-label="Send the question"
              >
                <Send className="size-4" />
              </Button>
            )}
          </div>
        </footer>
      </aside>
    </>
  );
}
