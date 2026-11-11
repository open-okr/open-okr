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
import { Check, Send, Square, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { dayLabel } from "../../lib/day-label";
import {
  applyCopilotProposalAction,
  type CopilotAvailability,
  copilotAvailabilityAction,
  dismissCopilotProposalAction,
  listCopilotProposalsAction,
  listCopilotThreadsAction,
  readCopilotThreadAction,
  stopCopilotRunAction,
  undoCopilotProposalAction,
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
  /** A background run is still producing this answer (P4-T14b-b). */
  readonly running?: boolean;
  /** Why the run stopped early, in words. Null when it did not. */
  readonly haltedReason?: string | null;
}

interface ThreadSummary {
  readonly id: string;
  readonly title: string | null;
}

type Availability = CopilotAvailability;

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
  const { t } = useTranslations();

  const mine = message.role === "member";
  return (
    <div className={mine ? "text-right" : ""}>
      <div
        className={`inline-block max-w-[46ch] whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-sm ${
          mine ? "bg-raised text-ink" : "bg-surface text-ink"
        }`}
      >
        {message.content}
        {message.running ? (
          <span className="mt-1 block">
            <Chip tone="info">{t("copilot.copilotPanel.stillWriting")}</Chip>
          </span>
        ) : null}
        {message.haltedReason ? (
          <span className="mt-1 block text-xs text-ink-3">
            {message.haltedReason}
          </span>
        ) : null}
        {message.stopped ? (
          <span className="mt-1 block">
            <Chip tone="warn">{t("copilot.copilotPanel.stopped")}</Chip>
          </span>
        ) : null}
      </div>
      {mine ? null : (
        <SourceList
          title={t("copilot.copilotPanel.sources")}
          items={message.citations}
        />
      )}
    </div>
  );
}

interface Proposal {
  readonly id: string;
  readonly action: string;
  readonly preview: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly why: string;
  readonly status: "pending" | "applied" | "dismissed";
  readonly undone: boolean;
  readonly reversible: boolean;
}

/**
 * What each proposable action is called on screen (completeness review M-09).
 *
 * The card printed the registry name, `goals.create`, which P8-G11d's rule
 * keeps out of the interface. With one action it was one string; with four it
 * is a reader wondering what `initiatives.create` means. An action without a
 * name here, which the catalogue in `packages/core` would have to gain first,
 * reads as a proposed change rather than as its identifier.
 */
const ACTION_NAME_KEYS: Readonly<Record<string, string>> = {
  "goals.create": "copilot.copilotPanel.actions.newObjective",
  "goals.addKeyResult": "copilot.copilotPanel.actions.newKeyResult",
  "initiatives.create": "copilot.copilotPanel.actions.newInitiative",
  "tasks.create": "copilot.copilotPanel.actions.newTask",
};

/**
 * The preview's labels, as the reader's language.
 *
 * Core builds the preview in English words because it is stored with the
 * proposal and read back on any surface; the panel is where it meets a
 * reader. A label not listed here is shown as it was stored.
 */
const PREVIEW_LABEL_KEYS: Readonly<Record<string, string>> = {
  Objective: "copilot.copilotPanel.preview.objective",
  Description: "copilot.copilotPanel.preview.description",
  Level: "copilot.copilotPanel.preview.level",
  Space: "copilot.copilotPanel.preview.space",
  Cycle: "copilot.copilotPanel.preview.cycle",
  "Key result": "copilot.copilotPanel.preview.keyResult",
  Baseline: "copilot.copilotPanel.preview.baseline",
  Target: "copilot.copilotPanel.preview.target",
  Direction: "copilot.copilotPanel.preview.direction",
  Indicator: "copilot.copilotPanel.preview.indicator",
  Initiative: "copilot.copilotPanel.preview.initiative",
  Task: "copilot.copilotPanel.preview.task",
};

/**
 * One proposal, with what it would do and what may be done about it.
 *
 * **The buttons are offered whether or not the reader may use them.** A member
 * who cannot create an objective sees Apply and gets the permission layer's own
 * refusal, which is the S-39 requirement and the opposite of hiding it. The one
 * thing that is not offered is an undo for an action with no reverse, because
 * that is a fact about the action rather than about the reader.
 */
function ProposalCard({
  proposal,
  busy,
  acting,
  onApply,
  onDismiss,
  onUndo,
}: {
  readonly proposal: Proposal;
  readonly busy: boolean;
  /** The button that started the work in flight, so only that one spins. */
  readonly acting: string | null;
  readonly onApply: () => void;
  readonly onDismiss: () => void;
  readonly onUndo: () => void;
}) {
  const { t } = useTranslations();

  return (
    <section
      aria-label={t("copilot.copilotPanel.proposedChange")}
      className="rounded-lg border border-line bg-surface p-3"
    >
      <header className="flex items-center gap-2">
        <Chip tone="agent">{t("common.ai")}</Chip>
        <span className="text-xs font-semibold text-ink-2">
          {t(
            ACTION_NAME_KEYS[proposal.action] ??
              "copilot.copilotPanel.proposedChange",
          )}
        </span>
        {proposal.status === "applied" ? (
          <Chip tone={proposal.undone ? "neutral" : "ok"}>
            {proposal.undone
              ? t("copilot.copilotPanel.undone")
              : t("copilot.copilotPanel.applied")}
          </Chip>
        ) : null}
        {proposal.status === "dismissed" ? (
          <Chip tone="neutral">{t("copilot.copilotPanel.dismissed")}</Chip>
        ) : null}
      </header>
      <p className="mt-2 text-xs text-ink-3">{proposal.why}</p>
      <dl className="mt-2 flex flex-col gap-1">
        {proposal.preview.map((row) => (
          <div key={row.label} className="flex gap-2 text-xs">
            <dt className="w-20 flex-none text-ink-4">
              {PREVIEW_LABEL_KEYS[row.label]
                ? t(PREVIEW_LABEL_KEYS[row.label] as string)
                : row.label}
            </dt>
            <dd className="min-w-0 text-ink-2">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-center gap-2">
        {proposal.status === "pending" ? (
          <>
            <Button
              variant="primary"
              disabled={busy}
              pending={busy && acting === `apply:${proposal.id}`}
              onClick={onApply}
            >
              <Check className="size-4" />
              {t("common.apply")}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              pending={busy && acting === `dismiss:${proposal.id}`}
              onClick={onDismiss}
            >
              {t("common.dismiss")}
            </Button>
          </>
        ) : null}
        {proposal.status === "applied" &&
        !proposal.undone &&
        proposal.reversible ? (
          <Button
            variant="ghost"
            disabled={busy}
            pending={busy && acting === `undo:${proposal.id}`}
            onClick={onUndo}
          >
            <Undo2 className="size-4" />
            {t("copilot.copilotPanel.undo")}
          </Button>
        ) : null}
        {proposal.status === "applied" && !proposal.reversible ? (
          <p className="text-xs text-ink-4">
            {t("copilot.copilotPanel.thisOneCannotBe")}
          </p>
        ) : null}
      </div>
    </section>
  );
}

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

/** The step a run says it is on (plan 0.8.1 W2). Core's `CopilotStep`. */
type Step =
  | { readonly step: "searching" }
  | { readonly step: "found"; readonly count: number }
  | { readonly step: "proposing" }
  | { readonly step: "writing" };

/** A step in the reader's words, from the catalogue and never from a model. */
function stepWords(
  step: Step,
  t: ReturnType<typeof useTranslations>["t"],
): string {
  switch (step.step) {
    case "searching":
      return t("copilot.copilotPanel.step.searching");
    case "found":
      return step.count === 0
        ? t("copilot.copilotPanel.step.foundNone")
        : step.count === 1
          ? t("copilot.copilotPanel.step.foundOne", { count: step.count })
          : t("copilot.copilotPanel.step.foundOther", { count: step.count });
    case "proposing":
      return t("copilot.copilotPanel.step.proposing");
    case "writing":
      return t("copilot.copilotPanel.step.writing");
  }
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

/**
 * What arrived for a question and is not in the recorded thread (plan 0.8.1
 * CP8, review F1). With AI off the passages and the reason are the answer, and
 * nothing records them, so the re-read that follows every turn used to take
 * them off the screen.
 */
interface Kept {
  readonly sources: readonly Source[];
  readonly notice: string | null;
}

/**
 * The passages and the reason a question was given, after the turn landed.
 * The reason is left out when the recorded answer already says it.
 */
function KeptAnswer({
  kept,
  said,
}: {
  readonly kept: Kept;
  /** What the recorded answer says about why it stopped, if anything. */
  readonly said: string | null;
}) {
  const { t } = useTranslations();
  return (
    <div data-testid="copilot-kept">
      {kept.notice && kept.notice !== said ? (
        <p className="rounded-md bg-raised px-3 py-2 text-xs text-ink-3">
          {kept.notice}
        </p>
      ) : null}
      <SourceList
        title={t("copilot.copilotPanel.passagesThatMatch")}
        items={kept.sources}
      />
    </div>
  );
}

/** The answer a question was given, when the next message is one. */
const answerTo = (
  messages: readonly Message[],
  index: number,
): Message | null => {
  const next = messages[index + 1];
  return next?.role === "assistant" ? next : null;
};

export function CopilotPanel({
  initialAvailability,
}: {
  /** Read on the server so the first open needs no round trip. */
  readonly initialAvailability: Availability;
}) {
  const { t } = useTranslations();

  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState(initialAvailability);
  const [threads, setThreads] = useState<readonly ThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [question, setQuestion] = useState("");
  /** The answer as it arrives. Replaced by the recorded message when it lands. */
  const [streaming, setStreaming] = useState<string | null>(null);
  const [sources, setSources] = useState<readonly Source[]>([]);
  const [proposals, setProposals] = useState<readonly Proposal[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  /** Passages and reasons kept beside the questions they answered (CP8). */
  const [kept, setKept] = useState<Readonly<Record<string, Kept>>>({});
  /** What the run says it is doing, while no words have arrived (W2). */
  const [step, setStep] = useState<Step | null>(null);
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

  useKeyboardShortcut(
    {
      id: "copilot",
      keys: "⌘J",
      description: t("copilot.copilotPanel.askTheCopilot"),
      group: "global",
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
      }
    })();
    return () => {
      live = false;
    };
  }, [open]);

  const loadThread = useCallback(async (id: string) => {
    const [thread, listed] = await Promise.all([
      readCopilotThreadAction(id),
      listCopilotProposalsAction(id),
    ]);
    // What was kept belongs to the conversation it was asked in.
    if (shownThread.current !== thread.id) {
      setKept({});
    }
    shownThread.current = thread.id;
    setThreadId(thread.id);
    setMessages(thread.messages);
    setProposals(listed);
    setStreaming(null);
    setSources([]);
    setNotice(null);
  }, []);

  /**
   * Rejoins a run that is still going (P4-T14b-b).
   *
   * **This is the acceptance criterion.** The member asked something that
   * takes a minute, the run went to the background, and the page they come
   * back to has an answer still being written. The thread read says so, and
   * this subscribes to the rest of it.
   *
   * What it cannot do is replay: prose already published is gone, and the
   * whole answer arrives when the run completes and the thread is re-read.
   * The chip says the answer is still being written, which is true and is
   * better than an empty bubble that looks finished.
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
      setStreaming((was) => (was ?? "") + (data.text ?? ""));
    };
    const onStep = (event: MessageEvent) => {
      setStep(JSON.parse(event.data) as Step);
    };
    const onDone = () => {
      source.close();
      // Re-read rather than assembling the final message here: the thread read
      // is what resolves citations against this reader's access, and a message
      // built in the browser would be one that skipped that.
      void loadThread(threadId);
    };
    source.addEventListener("text", onText);
    source.addEventListener("step", onStep);
    source.addEventListener("done", onDone);
    return () => {
      source.removeEventListener("text", onText);
      source.removeEventListener("step", onStep);
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
          await loadThread(threadId).catch(() => undefined);
        }
      }
    },
    [loadThread, t, threadId],
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
      setSources([]);
      setStreaming("");
      // The first thing every run does. Said at once rather than when the event
      // arrives, because a background run may publish it before the panel has
      // subscribed (plan 0.8.1 W2).
      setStep({ step: "searching" });
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
      // What this question was given, kept past the re-read when no words came.
      let questionId: string | null = null;
      let arrived = "";
      let found: readonly Source[] = [];
      let said: string | null = null;
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
          setNotice(t("copilot.copilotPanel.couldNotBeReached"));
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
              setThreadId(event.threadId);
            } else if (event.kind === "step") {
              setStep(event);
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
              setSources(event.sources);
            } else if (event.kind === "unavailable") {
              said = event.reason;
              setNotice(event.reason);
            } else if (event.kind === "text") {
              text += event.text;
              arrived = text;
              setStreaming(text);
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
        setBusy(false);
        setStreaming(null);
        setStep(null);
        if (landedThreadId) {
          // The recorded thread, with citations filtered against access now,
          // replaces everything drawn optimistically above. A proposal was asked
          // for on the server before the answer (plan 0.8.1 A2), so it is in it.
          await loadThread(landedThreadId).catch(() => undefined);
        }
        // With no words, the passages and the reason were the answer, and the
        // thread holds neither (plan 0.8.1 CP8, review F1). Kept beside the
        // question until another conversation is opened.
        const id = questionId;
        if (id && arrived.trim() === "" && (found.length > 0 || said)) {
          setKept((was) => ({
            ...was,
            [id]: { sources: found, notice: said },
          }));
        }
      }
    },
    [busy, loadThread, question, t, threadId],
  );

  if (!open) {
    return <CopilotTrigger onClick={() => setOpen(true)} />;
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

  return (
    <>
      <CopilotTrigger onClick={() => setOpen(false)} />
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
            <Button
              variant="ghost"
              className="ml-auto"
              onClick={() => setOpen(false)}
              aria-label={t("copilot.copilotPanel.closeTheCopilot")}
            >
              <X className="size-4" />
            </Button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {messages.length === 0 && streaming === null ? (
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
                {threads.length > 0 ? (
                  <div>
                    <p className="text-xs text-ink-4">
                      {t("copilot.copilotPanel.earlierConversations")}
                    </p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {threads.map((thread) => (
                        <li key={thread.id}>
                          <button
                            type="button"
                            className="text-left text-xs text-ink-2 underline"
                            onClick={() => void loadThread(thread.id)}
                          >
                            {thread.title ?? t("copilot.copilotPanel.untitled")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.map((message, index) => {
                  // After the answer to its question, or in the answer's
                  // place when the run recorded none (relay off, AI off).
                  const asked = messages[index - 1];
                  const extra =
                    message.role === "assistant"
                      ? asked?.role === "member"
                        ? kept[asked.id]
                        : undefined
                      : answerTo(messages, index) === null
                        ? kept[message.id]
                        : undefined;
                  return (
                    <div key={message.id} className="contents">
                      <Turn message={message} />
                      {extra ? (
                        <KeptAnswer
                          kept={extra}
                          said={
                            message.role === "assistant"
                              ? (message.haltedReason ?? null)
                              : null
                          }
                        />
                      ) : null}
                    </div>
                  );
                })}
                {proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    busy={busy}
                    acting={acting}
                    onApply={() =>
                      void decide(
                        "apply",
                        proposal.id,
                        applyCopilotProposalAction,
                      )
                    }
                    onDismiss={() =>
                      void decide(
                        "dismiss",
                        proposal.id,
                        dismissCopilotProposalAction,
                      )
                    }
                    onUndo={() =>
                      void decide(
                        "undo",
                        proposal.id,
                        undoCopilotProposalAction,
                      )
                    }
                  />
                ))}
                {streaming !== null ? (
                  <div className="whitespace-pre-wrap rounded-lg bg-surface px-3 py-2 text-sm text-ink">
                    {streaming === "" ? (
                      // One line, replaced in place as the run moves on, and
                      // read out politely (plan 0.8.1 W2).
                      <span
                        role="status"
                        className="flex items-center gap-2 text-ink-4"
                      >
                        {/* The face is the progress indicator here, so it
                            loops while the answer has not started. */}
                        <AgentFace mood="thinking" live className="size-4" />
                        {stepWords(step ?? { step: "searching" }, t)}
                      </span>
                    ) : (
                      streaming
                    )}
                  </div>
                ) : null}
              </div>
            )}

            {/* Only when it says something the footer does not. With the provider
                off the stream's reason and the footer's reason are the same
                sentence, and printing it twice reads as two problems. */}
            {notice && notice !== availability.reason ? (
              <p className="mt-3 rounded-md bg-raised px-3 py-2 text-xs text-ink-3">
                {notice}
              </p>
            ) : null}
            {/* The passages, shown whether or not a model used them. With the
                provider off this is the answer. */}
            <SourceList
              title={t("copilot.copilotPanel.passagesThatMatch")}
              items={sources}
            />
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
