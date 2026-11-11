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
 * forever would show citations nobody checked again. The recorded turn replaces
 * the arriving one in the same render, drawn by the same component, so nothing
 * leaves the screen or moves when it does (plan 0.8.1 CP3).
 *
 * **Three states before a question is possible.** Empty is the first open with
 * nothing asked. AI off is a provider that cannot write prose, and it still
 * offers the passages, which is §2.4's own degradation rather than a dead panel.
 * Capped is a budget or a switch, and it says which.
 */
import {
  AgentFace,
  type AgentMood,
  Button,
  Chip,
  Kbd,
  TextArea,
  useKeyboardShortcut,
  useTranslations,
} from "@openokr/ui";
import { ArrowDown, History, Send, Square, SquarePen, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { dayLabel } from "../../lib/day-label";
import {
  applyCopilotProposalAction,
  type CopilotAvailability,
  copilotAvailabilityAction,
  deleteCopilotThreadAction,
  dismissCopilotProposalAction,
  listCopilotProposalsAction,
  listCopilotThreadsAction,
  readCopilotThreadAction,
  stopCopilotRunAction,
  undoCopilotProposalAction,
} from "./actions";
import { type Proposal, ProposalCard } from "./proposal-card";
import { ThreadList, type ThreadSummary } from "./thread-list";
import {
  AssistantTurn,
  type Kept,
  MemberTurn,
  type Message,
  type Source,
  type Step,
  stepWords,
} from "./turn";
import { groupTurns } from "./turns";
import { useCopilotAddress } from "./use-copilot-address";
import { useStickToBottom } from "./use-stick-to-bottom";

type Availability = CopilotAvailability;

/**
 * The topbar's trigger. The shortcut hint sits beside the button, not inside
 * it: every visible word inside a button has to be part of its name (WCAG
 * 2.5.3, label in name), so a speech user who says what they see reaches it,
 * and "⌘J" inside a button named "Ask the copilot" broke that. The button
 * also announces the shortcut itself, through `aria-keyshortcuts`.
 */
function CopilotTrigger({ onClick }: { readonly onClick: () => void }) {
  const { t } = useTranslations();

  // One pill, so the hint reads as part of the control rather than a stray
  // key beside it (owner, 4 November 2026). The hint stays outside the
  // button for the reason above, and a press on it opens the panel too.
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the button inside is the keyboard path; this only widens the pointer target.
    // biome-ignore lint/a11y/noStaticElementInteractions: as above.
    <span
      onClick={(event) => {
        // The button handles its own press; only a press beside it lands here.
        if (!(event.target as HTMLElement).closest("button")) {
          onClick();
        }
      }}
      className="inline-flex h-7.5 cursor-pointer items-center rounded-control border border-line bg-surface pr-1.5 transition-colors duration-fast ease-out hover:border-line-2"
      // The product tour's Ask AI step lights this (plan 0.8.0 T1).
      data-tour-target="ask-ai"
    >
      <Button
        variant="ghost"
        onClick={onClick}
        aria-label={t("copilot.copilotPanel.askTheCopilot")}
        aria-keyshortcuts="Control+J Meta+J"
        className="h-full px-2 hover:bg-transparent"
      >
        <AgentFace className="size-4" />
        <span className="hidden sm:inline">
          {t("copilot.copilotPanel.ask")}
        </span>
      </Button>
      <Kbd className="hidden md:inline-flex">⌘J</Kbd>
    </span>
  );
}

/**
 * Four questions the copilot answers well today (plan 0.8.1 CP8, review Q9).
 *
 * Before L2 gives it the reads, a question about values and health is one it
 * cannot answer, and a suggestion whose first press fails teaches somebody
 * the copilot does not work. These lean on what it does have: the passages
 * people wrote, and the cards it can make.
 */
const SUGGESTIONS = [
  "copilot.copilotPanel.suggestion.feedback",
  "copilot.copilotPanel.suggestion.blockers",
  "copilot.copilotPanel.suggestion.task",
  "copilot.copilotPanel.suggestion.initiative",
] as const;

/** Each page that can turn the copilot back on, and what its link says. */
const FIX_LINKS = {
  aiSettings: { href: "/admin/ai", key: "copilot.copilotPanel.fix.aiSettings" },
  plan: { href: "/admin/plan", key: "copilot.copilotPanel.fix.plan" },
  personalKeys: {
    href: "/account/ai",
    key: "copilot.copilotPanel.fix.personalKeys",
  },
} as const;

/**
 * Why the copilot cannot answer, when that lifts, and where it is changed
 * (UIUX-PLAN S-39, "AI off with a link for admins").
 */
function Unavailable({
  availability,
}: {
  readonly availability: Availability;
}) {
  const { t, locale } = useTranslations();
  return (
    <div className="mb-2 flex flex-col gap-1.5 text-xs text-ink-3">
      <p>
        {availability.reason ?? t("copilot.copilotPanel.cannotAnswerRightNow")}
      </p>
      {availability.resetsAt ? (
        <p>
          {t("copilot.copilotPanel.liftsOn", {
            date: dayLabel(availability.resetsAt, locale),
          })}
        </p>
      ) : null}
      {availability.fixes.length > 0 ? (
        <p className="flex flex-wrap gap-x-3 gap-y-1">
          {availability.fixes.map((fix) => (
            <Link
              key={fix}
              href={FIX_LINKS[fix].href}
              className="font-semibold text-brand-text hover:underline"
            >
              {t(FIX_LINKS[fix].key)}
            </Link>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** The question being answered in this page, and what has come for it. */
interface Arriving {
  readonly question: string;
  /** The words so far. */
  readonly text: string;
  readonly step: Step;
  /** What retrieval found, shown as the answer only when no words come. */
  readonly sources: readonly Source[];
  /** Why no words are coming, when the run says so. */
  readonly notice: string | null;
  /** The request ended and the re-read did not land, so this is all there is. */
  readonly settled: boolean;
}

/** A background run being rejoined after a reload (P4-T14b-b). */
interface Rejoined {
  readonly text: string;
  readonly step: Step | null;
}

type Thread = Awaited<ReturnType<typeof readCopilotThreadAction>>;

export function CopilotPanel({
  initialAvailability,
}: {
  /** Read on the server so the first open needs no round trip. */
  readonly initialAvailability: Availability;
}) {
  const { t } = useTranslations();

  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState(initialAvailability);
  /** The member's conversations for History. Null until read. */
  const [threads, setThreads] = useState<readonly ThreadSummary[] | null>(null);
  const [threadsFailed, setThreadsFailed] = useState(false);
  /** The conversation, or the list of them (plan 0.8.1 CP2). */
  const [view, setView] = useState<"chat" | "history">("chat");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [question, setQuestion] = useState("");
  const [arriving, setArriving] = useState<Arriving | null>(null);
  const [rejoined, setRejoined] = useState<Rejoined>({ text: "", step: null });
  const [proposals, setProposals] = useState<readonly Proposal[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  /** Passages and reasons kept beside the questions they answered (CP8). */
  const [kept, setKept] = useState<Readonly<Record<string, Kept>>>({});
  const [busy, setBusy] = useState(false);
  // Which proposal button started the decision in flight. Cleared with `busy`,
  // because `busy` is also set while a question is sent.
  const [acting, setActing] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** The answer a background run is writing, so Stop can stop it (W4). */
  const runningAnswer = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** The thread whose messages are on screen, so `kept` is cleared on a change. */
  const shownThread = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useStickToBottom(
    scroller,
    content,
    `${open}:${view}:${threadId}`,
  );
  const { addressed, write } = useCopilotAddress();
  /**
   * What the address last said that the panel already acts on: what it wrote
   * itself, or adopted. Anything else is Back, Forward, a reload or a link.
   */
  const written = useRef<string | null>(null);
  /** The address, written by the panel and remembered as written. */
  const address = useCallback(
    (id: string | null, how: "push" | "replace") => {
      written.current = id;
      write(id, how);
    },
    [write],
  );

  useKeyboardShortcut(
    {
      id: "copilot",
      keys: "⌘J",
      description: t("copilot.copilotPanel.askTheCopilot"),
      group: "global",
    },
    () => (open ? closePanel() : openPanel()),
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
      // Neither failure is the panel's to show as an error: the availability
      // read says "cannot answer right now" by itself, and a list that did not
      // load is one with nothing to pick yet.
      const [next, list] = await Promise.all([
        copilotAvailabilityAction().catch(() => null),
        listCopilotThreadsAction().catch(() => null),
      ]);
      if (live) {
        if (next) {
          setAvailability(next);
        }
        if (list) {
          setThreads(list);
        }
        setThreadsFailed(list === null);
      }
    })();
    return () => {
      live = false;
    };
  }, [open]);

  // History reads the list again each time it is shown, so a conversation
  // started since the panel opened is in it.
  useEffect(() => {
    if (!open || view !== "history") {
      return;
    }
    let live = true;
    void listCopilotThreadsAction()
      .then((list) => {
        if (live) {
          setThreads(list);
          setThreadsFailed(false);
        }
      })
      .catch(() => {
        if (live) {
          setThreadsFailed(true);
        }
      });
    return () => {
      live = false;
    };
  }, [open, view]);

  /** One conversation and its cards, read together. */
  const read = useCallback(
    async (id: string) =>
      Promise.all([
        readCopilotThreadAction(id),
        listCopilotProposalsAction(id),
      ]),
    [],
  );

  /** Puts a conversation on screen. Called in the render that swaps it in. */
  const show = useCallback((thread: Thread, listed: readonly Proposal[]) => {
    // What was kept belongs to the conversation it was asked in.
    if (shownThread.current !== thread.id) {
      setKept({});
    }
    shownThread.current = thread.id;
    setThreadId(thread.id);
    setMessages(thread.messages);
    setProposals(listed);
    setRejoined({ text: "", step: null });
  }, []);

  const loadThread = useCallback(
    async (id: string) => {
      const [thread, listed] = await read(id);
      show(thread, listed);
      setNotice(null);
    },
    [read, show],
  );

  /** An empty conversation; the next question starts a new one. */
  const clear = useCallback(() => {
    shownThread.current = null;
    setThreadId(null);
    setMessages([]);
    setProposals([]);
    setKept({});
    setRejoined({ text: "", step: null });
    setNotice(null);
  }, []);

  /** Opens a conversation, saying so when it is not there any more. */
  const openThread = useCallback(
    async (id: string) => {
      setView("chat");
      try {
        await loadThread(id);
      } catch {
        // Deleted, somebody else's, or never one: the read answers
        // not-found for all three, and the panel says it plainly.
        clear();
        address(null, "replace");
        setNotice(t("copilot.copilotPanel.notThere"));
      }
    },
    [address, clear, loadThread, t],
  );

  const openPanel = useCallback(() => {
    setOpen(true);
    // The conversation it closed on goes back into the address.
    if (shownThread.current) {
      address(shownThread.current, "replace");
    }
  }, [address]);

  const closePanel = useCallback(() => {
    setOpen(false);
    // Closed, a reload should not open it again.
    address(null, "replace");
  }, [address]);

  const newChat = useCallback(() => {
    clear();
    setView("chat");
    address(null, "replace");
    inputRef.current?.focus();
  }, [address, clear]);

  /**
   * The address changed under the panel: Back, Forward, a reload, or a link
   * to a conversation. A conversation named opens the panel on it; none named
   * where one was shown is Back past the step that opened it.
   */
  useEffect(() => {
    if (addressed === written.current) {
      return;
    }
    written.current = addressed;
    if (addressed === null) {
      clear();
      return;
    }
    setOpen(true);
    if (addressed !== shownThread.current) {
      void openThread(addressed);
    }
  }, [addressed, clear, openThread]);

  const deleteThread = useCallback(
    async (id: string): Promise<string | null> => {
      const { error } = await deleteCopilotThreadAction(id).catch(() => ({
        error: t("copilot.copilotPanel.history.couldNotDelete"),
      }));
      if (error) {
        return error;
      }
      if (id === shownThread.current) {
        clear();
        address(null, "replace");
      }
      const list = await listCopilotThreadsAction().catch(() => null);
      setThreads(
        list ?? ((was) => (was ? was.filter((one) => one.id !== id) : was)),
      );
      return null;
    },
    [address, clear, t],
  );

  /**
   * Rejoins a run that is still going (P4-T14b-b).
   *
   * **This is the acceptance criterion.** The member asked something that
   * takes a minute, the run went to the background, and the page they come
   * back to has an answer still being written. The thread read says so, and
   * this subscribes to the rest of it, drawn in the recorded answer's own turn
   * rather than in a second one beside it (plan 0.8.1 CP3, review F21).
   *
   * What it cannot do is replay: prose already published is gone, and the
   * whole answer arrives when the run completes and the thread is re-read.
   */
  const running = messages.some(
    (message) => message.role === "assistant" && message.running,
  );
  useEffect(() => {
    if (!open || !threadId || !running) {
      return;
    }
    const source = new EventSource(
      `/api/copilot/live?threadId=${encodeURIComponent(threadId)}`,
    );
    const onText = (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { text?: string };
      setRejoined((was) => ({ ...was, text: was.text + (data.text ?? "") }));
    };
    const onStep = (event: MessageEvent) => {
      const step = JSON.parse(event.data) as Step;
      setRejoined((was) => ({ ...was, step }));
    };
    const onProposal = () => {
      void listCopilotProposalsAction(threadId)
        .then(setProposals)
        .catch(() => undefined);
    };
    const onDone = () => {
      source.close();
      // Re-read rather than assembling the final message here: the thread read
      // is what resolves citations against this reader's access, and a message
      // built in the browser would be one that skipped that.
      void loadThread(threadId).catch(() => undefined);
    };
    source.addEventListener("text", onText);
    source.addEventListener("step", onStep);
    source.addEventListener("proposal", onProposal);
    source.addEventListener("done", onDone);
    return () => {
      source.removeEventListener("text", onText);
      source.removeEventListener("step", onStep);
      source.removeEventListener("proposal", onProposal);
      source.removeEventListener("done", onDone);
      source.close();
    };
  }, [open, threadId, running, loadThread]);

  /**
   * Applies, dismisses or undoes one, then re-reads.
   *
   * The refusal is shown as it arrives. A member who may not create an objective
   * gets `goals.create`'s own words, not a disabled button and no explanation.
   */
  const decide = useCallback(
    async (
      name: string,
      id: string,
      decision: (id: string) => Promise<unknown>,
    ): Promise<void> => {
      setBusy(true);
      setActing(`${name}:${id}`);
      setNotice(null);
      try {
        await decision(id);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : t("copilot.copilotPanel.couldNotBeDone"),
        );
      } finally {
        setBusy(false);
        setActing(null);
        if (threadId) {
          await read(threadId)
            .then(([thread, listed]) => show(thread, listed))
            .catch(() => undefined);
        }
      }
    },
    [read, show, t, threadId],
  );

  const stop = useCallback(() => {
    // A background run is not this request, so cancelling the request alone
    // would only stop listening (plan 0.8.1 W4). The run is told first.
    const answerId = runningAnswer.current;
    if (answerId) {
      void stopCopilotRunAction(answerId).catch(() => undefined);
    }
    abort.current?.abort();
  }, []);

  const send = useCallback(
    async (suggested?: string) => {
      const asked = (suggested ?? question).trim();
      if (asked === "" || busy) {
        return;
      }
      if (suggested === undefined) {
        setQuestion("");
      }
      setBusy(true);
      setNotice(null);
      // Shown straight away rather than after the round trip, with the first
      // thing every run does: a background run may publish that step before
      // the panel has subscribed (plan 0.8.1 W2).
      setArriving({
        question: asked,
        text: "",
        step: { step: "searching" },
        sources: [],
        notice: null,
        settled: false,
      });
      // Asking is reading the end of the conversation.
      stick.toEnd();
      const update = (patch: Partial<Arriving>) =>
        setArriving((was) => (was ? { ...was, ...patch } : was));

      const controller = new AbortController();
      abort.current = controller;
      let landedThreadId = threadId;
      // What this question was given, kept past the re-read when no words came.
      let questionId: string | null = null;
      let text = "";
      let found: readonly Source[] = [];
      let said: string | null = null;
      let reached = true;
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
          reached = false;
          setNotice(t("copilot.copilotPanel.couldNotBeReached"));
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          // Server-Sent Events: frames are separated by a blank line, and only
          // the `data:` line is parsed. The `event:` line names the same kind
          // the payload carries, so nothing is read twice.
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
              | {
                  kind: "thread";
                  threadId: string;
                  questionMessageId: string;
                  answerMessageId?: string;
                }
              | { kind: "sources"; sources: readonly Source[] }
              | { kind: "proposal"; proposalId: string }
              | ({ kind: "step" } & Step)
              | { kind: "unavailable"; reason: string }
              | { kind: "text"; text: string }
              | { kind: "done" };
            if (event.kind === "thread") {
              landedThreadId = event.threadId;
              questionId = event.questionMessageId;
              runningAnswer.current = event.answerMessageId ?? null;
              shownThread.current = event.threadId;
              setThreadId(event.threadId);
              // A new conversation goes into the address the moment it
              // exists, so a reload mid-answer comes back to it.
              if (written.current !== event.threadId) {
                address(event.threadId, "replace");
              }
            } else if (event.kind === "step") {
              const { kind: _kind, ...step } = event;
              update({ step });
            } else if (event.kind === "proposal" && landedThreadId) {
              // The card was made before the answer (plan 0.8.1 A2), so it is
              // shown while the answer is still being written.
              const listed = await listCopilotProposalsAction(
                landedThreadId,
              ).catch(() => null);
              if (listed) {
                setProposals(listed);
              }
            } else if (event.kind === "sources") {
              found = event.sources;
              update({ sources: event.sources });
            } else if (event.kind === "unavailable") {
              said = event.reason;
              update({ notice: event.reason });
            } else if (event.kind === "text") {
              text += event.text;
              update({ text });
            }
          }
        }
      } catch (error) {
        // An abort is the stop control working, not a failure. What arrived was
        // recorded by the server, and the re-read below shows it.
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setNotice(t("copilot.copilotPanel.answerStoppedEarly"));
        }
      } finally {
        abort.current = null;
        runningAnswer.current = null;
        // The recorded thread, with citations filtered against access now,
        // replaces everything drawn optimistically above, in one render so
        // the answer never leaves the screen. A proposal was asked for on the
        // server before the answer (plan 0.8.1 A2), so it is in it.
        const landed = landedThreadId
          ? await read(landedThreadId).catch(() => null)
          : null;
        if (landed) {
          show(...landed);
          setArriving(null);
        } else if (reached) {
          update({ settled: true });
        } else {
          setArriving(null);
        }
        setBusy(false);
        // With no words, the passages and the reason were the answer, and the
        // thread holds neither (plan 0.8.1 CP8, review F1). Kept beside the
        // question until another conversation is opened.
        const id = questionId;
        if (id && text.trim() === "" && (found.length > 0 || said)) {
          setKept((was) => ({
            ...was,
            [id]: { sources: found, notice: said },
          }));
        }
      }
    },
    [address, busy, question, read, show, stick, t, threadId],
  );

  if (!open) {
    return <CopilotTrigger onClick={openPanel} />;
  }

  const canAsk = availability.available;
  // The copilot's face, in the order a reader would want the reason: off
  // before working, working before a problem with the last answer.
  const mood: AgentMood = !availability.providerConfigured
    ? "sleeping"
    : busy || running
      ? "thinking"
      : notice
        ? "sad"
        : "idle";

  const { turns, afterLast } = groupTurns(
    messages,
    proposals,
    arriving !== null,
  );
  const cardsFor = (listed: readonly Proposal[]) =>
    listed.length === 0
      ? null
      : listed.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            busy={busy}
            acting={acting}
            onApply={() =>
              void decide("apply", proposal.id, applyCopilotProposalAction)
            }
            onDismiss={() =>
              void decide("dismiss", proposal.id, dismissCopilotProposalAction)
            }
            onUndo={() =>
              void decide("undo", proposal.id, undoCopilotProposalAction)
            }
          />
        ));
  const empty = turns.length === 0 && arriving === null;

  return (
    <>
      <CopilotTrigger onClick={closePanel} />
      {/* **Portalled to the body, and it has to be.** The trigger above lives in
          `Topbar`, which carries `backdrop-blur-md`. A backdrop filter makes an
          element the containing block for every `position: fixed` descendant, so
          rendered in place the panel's `inset-y-0` resolved against the 50px
          topbar: a 49px strip with its content spilling over the page and no
          background painted under it. `document.body` is safe to read here
          because `open` starts false, so this branch is only ever reached after
          a click or the shortcut, which is to say only in a browser. */}
      {createPortal(
        <aside
          role="dialog"
          aria-label={t("copilot.copilotPanel.copilot")}
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-100 flex-col border-l border-line bg-bg shadow-lg"
        >
          <header className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
            {/* Blinks while idle, and plays any other change once and
                rests. The face in the reply is the one that keeps moving
                while the answer is on its way, and one moving face in a
                panel is enough. */}
            <AgentFace mood={mood} />
            <h2 className="text-sm font-medium text-ink">
              {t("copilot.copilotPanel.copilot")}
            </h2>
            {availability.providerConfigured ? null : (
              <Chip tone="neutral">{t("copilot.copilotPanel.aiOff")}</Chip>
            )}
            <div className="ml-auto flex items-center gap-1">
              {/* A label beside the icon from 640px; below that the icon,
                  with the same words for a screen reader. */}
              <Button
                variant="ghost"
                onClick={newChat}
                disabled={arriving !== null}
                className="px-2"
              >
                <SquarePen className="size-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">
                  {t("copilot.copilotPanel.newChat")}
                </span>
              </Button>
              <Button
                variant="ghost"
                aria-pressed={view === "history"}
                onClick={() =>
                  setView((was) => (was === "history" ? "chat" : "history"))
                }
                className={`px-2 ${view === "history" ? "bg-raised" : ""}`}
              >
                <History className="size-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">
                  {t("copilot.copilotPanel.history.title")}
                </span>
              </Button>
              <Button
                variant="ghost"
                onClick={closePanel}
                aria-label={t("copilot.copilotPanel.closeTheCopilot")}
                className="px-2"
              >
                <X className="size-4" />
              </Button>
            </div>
          </header>

          <div className="relative min-h-0 flex-1">
            <div ref={scroller} className="h-full overflow-y-auto px-4 py-3">
              <div ref={content} className="flex flex-col gap-4">
                {view === "history" ? (
                  <ThreadList
                    threads={threads}
                    openId={threadId}
                    loading={!threadsFailed}
                    onOpen={(id) => {
                      // A step Back can undo, as the OKR drawer's opening is.
                      address(
                        id,
                        written.current === null ? "push" : "replace",
                      );
                      void openThread(id);
                    }}
                    onDelete={deleteThread}
                  />
                ) : null}
                {view === "chat" && empty ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col items-start gap-2 pt-2">
                      <AgentFace mood={mood} className="size-8" />
                      <p className="text-sm text-ink-3">
                        {t("copilot.copilotPanel.askAboutThisWorkspace")}
                      </p>
                    </div>
                    {/* Only where an answer can come: with AI off a suggestion
                        would be a search for a sentence (plan 0.8.1 CP8). */}
                    {canAsk ? (
                      <ul
                        aria-label={t("copilot.copilotPanel.suggestions")}
                        className="flex flex-col gap-1.5"
                      >
                        {SUGGESTIONS.map((key) => (
                          <li key={key}>
                            <Button
                              variant="default"
                              disabled={busy}
                              onClick={() => void send(t(key))}
                              className="h-auto w-full justify-start whitespace-normal py-2 text-left font-normal"
                            >
                              {t(key)}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                {view === "chat" ? (
                  <>
                    {turns.map((turn) => {
                      const answer = turn.answer;
                      const extra = turn.question
                        ? (kept[turn.question.id] ?? null)
                        : null;
                      const live = answer?.running === true;
                      return (
                        <div key={turn.key} className="flex flex-col gap-3">
                          {turn.question ? (
                            <MemberTurn text={turn.question.content} />
                          ) : null}
                          {answer || extra || turn.proposals.length > 0 ? (
                            <AssistantTurn
                              text={
                                live ? rejoined.text : (answer?.content ?? "")
                              }
                              arriving={live}
                              status={
                                live
                                  ? rejoined.step
                                    ? stepWords(rejoined.step, t)
                                    : t("copilot.copilotPanel.stillWriting")
                                  : null
                              }
                              haltedReason={answer?.haltedReason ?? null}
                              stopped={answer?.stopped ?? false}
                              citations={answer?.citations ?? []}
                              kept={extra}
                              cards={cardsFor(turn.proposals)}
                            />
                          ) : null}
                        </div>
                      );
                    })}

                    {arriving ? (
                      <div className="flex flex-col gap-3">
                        <MemberTurn text={arriving.question} />
                        <AssistantTurn
                          text={arriving.text}
                          arriving={!arriving.settled}
                          status={stepWords(arriving.step, t)}
                          haltedReason={null}
                          stopped={false}
                          citations={[]}
                          // Passages are shown while arriving only when the run
                          // has said no words are coming: then they are the
                          // answer. Otherwise they wait for the recorded answer.
                          kept={
                            arriving.notice
                              ? {
                                  sources: arriving.sources,
                                  notice: arriving.notice,
                                }
                              : null
                          }
                          cards={cardsFor(afterLast)}
                        />
                      </div>
                    ) : null}

                    {notice ? (
                      <p className="rounded-md bg-raised px-3 py-2 text-xs text-ink-3">
                        {notice}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
            {stick.away && !empty && view === "chat" ? (
              <Button
                variant="default"
                onClick={stick.toEnd}
                aria-label={t("copilot.copilotPanel.jumpToLatest")}
                className="absolute bottom-3 left-1/2 size-8 -translate-x-1/2 rounded-full px-0 shadow-lg"
              >
                <ArrowDown className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>

          <footer className="flex-none border-t border-line px-4 py-3">
            {canAsk ? null : <Unavailable availability={availability} />}
            <div className="flex items-end gap-2">
              <TextArea
                label={t("copilot.copilotPanel.yourQuestion")}
                hideLabel
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
                    ? t("copilot.copilotPanel.askAQuestion")
                    : t("copilot.copilotPanel.searchForMatchingPassages")
                }
                maxLength={4000}
                className="flex-1"
                inputClassName="resize-none placeholder:text-ink-4"
              />
              {busy && availability.streaming ? (
                <Button
                  variant="ghost"
                  onClick={stop}
                  aria-label={t("copilot.copilotPanel.stopTheAnswer")}
                >
                  <Square className="size-4" />
                  {t("copilot.copilotPanel.stop")}
                </Button>
              ) : (
                <Button
                  onClick={() => void send()}
                  disabled={busy || question.trim() === ""}
                  aria-label={t("copilot.copilotPanel.sendTheQuestion")}
                >
                  <Send className="size-4" />
                </Button>
              )}
            </div>
          </footer>
        </aside>,
        document.body,
      )}
    </>
  );
}
