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
import { Dialog } from "@base-ui-components/react/dialog";
import {
  AgentFace,
  type AgentMood,
  Button,
  Chip,
  Kbd,
  useKeyboardShortcut,
  useTranslations,
} from "@openokr/ui";
import { ArrowDown, History, Maximize2, SquarePen, X } from "lucide-react";
import Link from "next/link";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
import { Composer } from "./composer";
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
function CopilotTrigger({
  onClick,
  buttonRef,
}: {
  readonly onClick: () => void;
  /** Where focus goes back to when the panel closes (plan 0.8.1 CP1). */
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
}) {
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
        ref={buttonRef}
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
  /** Every step the run has said, in order; the last is the one it is on. */
  readonly steps: readonly Step[];
  /** What retrieval found, shown as the answer only when no words come. */
  readonly sources: readonly Source[];
  /** Why no words are coming, when the run says so. */
  readonly notice: string | null;
  /** The request ended and the re-read did not land, so this is all there is. */
  readonly settled: boolean;
  /** The reader stopped it, and the run has not recorded what it kept yet. */
  readonly stopped?: boolean;
}

/** A background run being rejoined after a reload (P4-T14b-b). */
interface Rejoined {
  readonly text: string;
  readonly steps: readonly Step[];
}

/** The steps with one more, unless it is the one already last. */
const withStep = (steps: readonly Step[], step: Step): readonly Step[] =>
  JSON.stringify(steps.at(-1)) === JSON.stringify(step)
    ? steps
    : [...steps, step];

/** How long a stopped run is given to record what it kept. */
const STOPPED_RECORDED_AFTER_MS = 1_500;

/** The recorded words of the answer to one question, or "" for none yet. */
const recordedAnswer = (
  messages: readonly {
    readonly id: string;
    readonly role: string;
    readonly content: string;
  }[],
  questionId: string | null,
): string => {
  const index = messages.findIndex((message) => message.id === questionId);
  const answer = index === -1 ? undefined : messages[index + 1];
  return answer?.role === "assistant" ? answer.content : "";
};

/** How often the status line may say a step, at most (plan 0.8.1 CP9). */
const STEP_SAID_EVERY_MS = 2_000;

type Thread = Awaited<ReturnType<typeof readCopilotThreadAction>>;

/** Where this browser remembers that the panel was widened (plan 0.8.1 CP1). */
const EXPANDED_KEY = "openokr.copilot.expanded";

/**
 * Whether this browser widened the panel last time. Storage can be refused,
 * in a private window or with site data blocked, and then the panel is narrow.
 */
function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberExpanded(expanded: boolean): void {
  try {
    if (expanded) {
      window.localStorage.setItem(EXPANDED_KEY, "1");
    } else {
      window.localStorage.removeItem(EXPANDED_KEY);
    }
  } catch {
    // Not remembered, which costs one press next time.
  }
}

/** How long an announcement stays in the status line before it is cleared. */
const ANNOUNCED_FOR_MS = 4_000;

export function CopilotPanel({
  initialAvailability,
}: {
  /** Read on the server so the first open needs no round trip. */
  readonly initialAvailability: Availability;
}) {
  const { t } = useTranslations();

  const [open, setOpen] = useState(false);
  /** 768px rather than 512px (plan 0.8.1 CP1). Read once the panel opens. */
  const [expanded, setExpanded] = useState(false);
  /**
   * What the polite status line says once: "Answering", "Answer ready",
   * "Stopped" or why not (plan 0.8.1 CP1). Cleared after a moment, so the
   * same words a turn later are said again.
   */
  const [announcement, setAnnouncement] = useState("");
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
  const [rejoined, setRejoined] = useState<Rejoined>({ text: "", steps: [] });
  const [proposals, setProposals] = useState<readonly Proposal[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Why the last question did not reach the copilot, under the box that
   * holds it again (plan 0.8.1 CP6, review F13).
   */
  const [sendError, setSendError] = useState<string | null>(null);
  /** The steps each question's run went through, this session (CP9). */
  const [stepsKept, setStepsKept] = useState<
    Readonly<Record<string, readonly Step[]>>
  >({});
  /** Passages and reasons kept beside the questions they answered (CP8). */
  const [kept, setKept] = useState<Readonly<Record<string, Kept>>>({});
  const [busy, setBusy] = useState(false);
  // Which proposal button started the decision in flight. Cleared with `busy`,
  // because `busy` is also set while a question is sent.
  const [acting, setActing] = useState<string | null>(null);
  /** Why the last decision on each card was refused, by card (CP7). */
  const [cardErrors, setCardErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const abort = useRef<AbortController | null>(null);
  /** The answer a background run is writing, so Stop can stop it (W4). */
  const runningAnswer = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  /** An input method is composing in the box, so Escape and Enter are its. */
  const composing = useRef(false);
  /** When the status line last said something about a run's progress. */
  const stepSaidAt = useRef(0);
  /** The turn ended with focus in the panel, so the box takes it back. */
  const refocus = useRef(false);
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

  useEffect(() => {
    if (open) {
      setExpanded(readExpanded());
    }
  }, [open]);

  useEffect(() => {
    if (!busy && refocus.current) {
      refocus.current = false;
      inputRef.current?.focus();
    }
  }, [busy]);

  // The step the run is on, said at most every two seconds and only until
  // the words start: "Answering" was said when it began, and "Answer ready"
  // is said when it ends (plan 0.8.1 CP9).
  const latestStep = arriving?.text === "" ? arriving.steps.at(-1) : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: said when the step changes, and `t` is stable for the session.
  useEffect(() => {
    if (!latestStep) {
      return;
    }
    const now = Date.now();
    if (now - stepSaidAt.current < STEP_SAID_EVERY_MS) {
      return;
    }
    stepSaidAt.current = now;
    setAnnouncement(stepWords(latestStep, t));
  }, [JSON.stringify(latestStep)]);

  useEffect(() => {
    if (announcement === "") {
      return;
    }
    const timer = setTimeout(() => setAnnouncement(""), ANNOUNCED_FOR_MS);
    return () => clearTimeout(timer);
  }, [announcement]);

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
      setStepsKept({});
    }
    shownThread.current = thread.id;
    setThreadId(thread.id);
    setMessages(thread.messages);
    setProposals(listed);
    setRejoined({ text: "", steps: [] });
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
    setStepsKept({});
    setRejoined({ text: "", steps: [] });
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
      const { kind: _kind, ...step } = JSON.parse(event.data) as {
        kind?: string;
      } & Step;
      setRejoined((was) => ({ ...was, steps: withStep(was.steps, step) }));
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
   * The refusal is shown as it arrives, on the card it is about (plan 0.8.1
   * CP7). A member who may not create an objective gets `goals.create`'s own
   * words, not a disabled button and no explanation.
   *
   * **Deciding does not hold up asking, nor asking deciding.** One busy flag
   * for both disabled Apply while an answer arrived and the box while a card
   * was decided (review F23); a decision has its own, `acting`.
   */
  const decide = useCallback(
    async (
      name: string,
      id: string,
      decision: (id: string) => Promise<{ readonly error: string | null }>,
    ): Promise<void> => {
      setActing(`${name}:${id}`);
      setCardErrors((was) => {
        const { [id]: _gone, ...rest } = was;
        return rest;
      });
      const error = await decision(id).then(
        (answered) => answered.error,
        () => t("copilot.copilotPanel.couldNotBeDone"),
      );
      if (error) {
        setCardErrors((was) => ({ ...was, [id]: error }));
      }
      setActing(null);
      if (threadId) {
        await read(threadId)
          .then(([thread, listed]) => show(thread, listed))
          .catch(() => undefined);
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
      setSendError(null);
      setAnnouncement(t("copilot.copilotPanel.announce.answering"));
      stepSaidAt.current = Date.now();
      // Shown straight away rather than after the round trip, with the first
      // thing every run does: a background run may publish that step before
      // the panel has subscribed (plan 0.8.1 W2).
      setArriving({
        question: asked,
        text: "",
        steps: [{ step: "searching" }],
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
      // The steps, kept with the question once it lands (live only, W2-Q).
      let stepsSoFar: readonly Step[] = [{ step: "searching" }];
      let text = "";
      let found: readonly Source[] = [];
      let said: string | null = null;
      let reached = true;
      let stopped = false;
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
              stepsSoFar = withStep(stepsSoFar, step);
              update({ steps: stepsSoFar });
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
        if (error instanceof DOMException && error.name === "AbortError") {
          stopped = true;
        } else if (questionId === null) {
          // Nothing was recorded: the question never reached the copilot.
          reached = false;
        } else {
          setNotice(t("copilot.copilotPanel.answerStoppedEarly"));
        }
      } finally {
        abort.current = null;
        runningAnswer.current = null;
        // The recorded thread, with citations filtered against access now,
        // replaces everything drawn optimistically above, in one render so
        // the answer never leaves the screen. A proposal was asked for on the
        // server before the answer (plan 0.8.1 A2), so it is in it.
        const landed =
          reached && landedThreadId
            ? await read(landedThreadId).catch(() => null)
            : null;
        if (!reached) {
          // Nothing was recorded, in a new conversation or an open one. The
          // question goes back in the box, unless the next one is being
          // typed there already, with why under it (plan 0.8.1 CP6).
          setArriving(null);
          setQuestion((current) => (current.trim() === "" ? asked : current));
          setSendError(t("copilot.copilotPanel.couldNotBeReached"));
        } else if (
          landed &&
          stopped &&
          text.trim() !== "" &&
          recordedAnswer(landed[0].messages, questionId) === ""
        ) {
          // Stopped in the background, and the run has not written what it
          // kept yet (plan 0.8.1 W4): the words stay where they are, marked
          // stopped, and the recorded answer replaces them a moment later,
          // rather than the answer leaving the screen until a reload.
          update({ settled: true, stopped: true });
          const id = landedThreadId as string;
          setTimeout(() => {
            void read(id)
              .then((again) => {
                show(...again);
                setArriving(null);
              })
              .catch(() => undefined);
          }, STOPPED_RECORDED_AFTER_MS);
        } else if (landed) {
          show(...landed);
          setArriving(null);
        } else {
          update({ settled: true });
        }
        setBusy(false);
        // Said once, politely: the words themselves were never read out as
        // they arrived (plan 0.8.1 CP1).
        setAnnouncement(
          stopped
            ? t("copilot.copilotPanel.stopped")
            : !reached
              ? t("copilot.copilotPanel.couldNotBeReached")
              : text.trim() !== ""
                ? t("copilot.copilotPanel.announce.ready")
                : (said ?? t("copilot.copilotPanel.announce.ready")),
        );
        // Focus stays in the composer for the next question, unless the
        // reader has gone somewhere else on the page meanwhile. Given back
        // once the box is drawn usable again, below.
        const focused = document.activeElement;
        refocus.current =
          focused === null ||
          focused === document.body ||
          popupRef.current?.contains(focused) === true;
        // The steps stay folded above the answer for this session, so the
        // line above it does not vanish when the recorded turn replaces it.
        const askedId = questionId;
        if (askedId) {
          const steps = stepsSoFar;
          setStepsKept((was) => ({ ...was, [askedId]: steps }));
        }
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
            busy={acting !== null}
            acting={acting}
            error={cardErrors[proposal.id] ?? null}
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
  /** Words may still come for the question just asked. */
  const answering = arriving !== null && !arriving.settled;

  return (
    <>
      <CopilotTrigger
        buttonRef={triggerRef}
        onClick={open ? closePanel : openPanel}
      />
      {/*
       * A Base UI dialog that is not modal, the OKR drawer's pattern
       * (plan 0.8.1 CP1, review F4): the page stays usable beside it, Escape
       * closes it, and focus goes back to Ask. Escape is the box's own while
       * something is typed in it, or while an input method is composing.
       *
       * **Portalled to the body, and it has to be.** The trigger lives in
       * `Topbar`, which carries `backdrop-blur-md`. A backdrop filter makes an
       * element the containing block for every `position: fixed` descendant,
       * so rendered in place the panel resolved against the 50px topbar.
       */}
      <Dialog.Root
        open={open}
        modal={false}
        disablePointerDismissal
        onOpenChange={(next, details) => {
          if (next) {
            return;
          }
          if (
            details.reason === "escape-key" &&
            (composing.current || question.trim() !== "")
          ) {
            return;
          }
          closePanel();
        }}
      >
        <Dialog.Portal>
          <Dialog.Popup
            ref={popupRef}
            initialFocus={inputRef}
            finalFocus={triggerRef}
            // 512px, widened to 768px, on the container scale so compact
            // density does not narrow it; a full-screen sheet below 768px.
            className={`fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-bg shadow-lg outline-none ${
              expanded ? "md:max-w-3xl" : "md:max-w-lg"
            }`}
          >
            <header className="flex flex-none items-center gap-2 border-b border-line px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
              {/* Blinks while idle, and plays any other change once and
                rests. The face in the reply is the one that keeps moving
                while the answer is on its way, and one moving face in a
                panel is enough. */}
              <AgentFace mood={mood} />
              <Dialog.Title className="text-sm font-medium text-ink">
                {t("copilot.copilotPanel.copilot")}
              </Dialog.Title>
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
                {/* Wider for a long answer or a table of cards. Only where
                  there is room: below 768px the panel is the whole screen. */}
                <Button
                  variant="ghost"
                  aria-label={t("copilot.copilotPanel.expand")}
                  aria-pressed={expanded}
                  onClick={() => {
                    setExpanded(!expanded);
                    rememberExpanded(!expanded);
                  }}
                  className={`hidden px-2 md:inline-flex ${expanded ? "bg-raised" : ""}`}
                >
                  <Maximize2 className="size-4" aria-hidden="true" />
                </Button>
                <Dialog.Close
                  aria-label={t("copilot.copilotPanel.closeTheCopilot")}
                  className="flex size-7.5 flex-none items-center justify-center rounded-control text-ink-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-strong"
                >
                  <X className="size-4" aria-hidden="true" />
                </Dialog.Close>
              </div>
            </header>

            <div className="relative min-h-0 flex-1">
              <div ref={scroller} className="h-full overflow-y-auto px-4 py-3">
                {/* The conversation is a log, and says nothing as it grows:
                  the status line below announces a finished answer, a stop
                  and an error once, where a live log would read every word
                  as it arrived (plan 0.8.1 CP1). */}
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
                    <div
                      role="log"
                      aria-label={t("copilot.copilotPanel.conversation")}
                      aria-live="off"
                      className="flex flex-col gap-4"
                    >
                      {turns.map((turn, index) => {
                        const answer = turn.answer;
                        const extra = turn.question
                          ? (kept[turn.question.id] ?? null)
                          : null;
                        const live = answer?.running === true;
                        // The last turn, with nothing asked after it, is
                        // where an error is said and Retry offered (CP7).
                        const last =
                          arriving === null && index === turns.length - 1;
                        const asked = turn.question?.content ?? null;
                        const fellShort =
                          answer?.stopped === true ||
                          Boolean(answer?.haltedReason) ||
                          (last && notice !== null);
                        return (
                          <div key={turn.key} className="flex flex-col gap-3">
                            {turn.question ? (
                              <MemberTurn text={turn.question.content} />
                            ) : null}
                            {answer ||
                            extra ||
                            turn.proposals.length > 0 ||
                            (last && notice) ? (
                              <AssistantTurn
                                text={
                                  live ? rejoined.text : (answer?.content ?? "")
                                }
                                arriving={live}
                                steps={
                                  live
                                    ? rejoined.steps
                                    : asked && turn.question
                                      ? (stepsKept[turn.question.id] ?? null)
                                      : null
                                }
                                haltedReason={answer?.haltedReason ?? null}
                                stopped={answer?.stopped ?? false}
                                citations={answer?.citations ?? []}
                                kept={extra}
                                cards={cardsFor(turn.proposals)}
                                copyText={
                                  !live &&
                                  answer &&
                                  answer.content.trim() !== ""
                                    ? answer.content
                                    : null
                                }
                                onRetry={
                                  // Not with AI off: a retry would only
                                  // search again for the same passages.
                                  last &&
                                  fellShort &&
                                  asked &&
                                  !live &&
                                  availability.providerConfigured
                                    ? () => void send(asked)
                                    : null
                                }
                                retryDisabled={busy || !availability.available}
                                error={last ? notice : null}
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
                            steps={arriving.steps}
                            haltedReason={null}
                            stopped={arriving.stopped === true}
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

                      {/* With no turn to say it under, such as a
                          conversation that is not there any more. */}
                      {notice && turns.length === 0 && arriving === null ? (
                        <p className="rounded-md bg-raised px-3 py-2 text-xs text-ink-3">
                          {notice}
                        </p>
                      ) : null}
                    </div>
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

            <p role="status" className="sr-only">
              {announcement}
            </p>
            <footer className="flex-none border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {canAsk ? null : <Unavailable availability={availability} />}
              <Composer
                value={question}
                onChange={(next) => {
                  setQuestion(next);
                  setSendError(null);
                }}
                onSend={() => void send()}
                onStop={stop}
                answering={answering}
                canStop={answering && availability.streaming}
                placeholder={
                  canAsk
                    ? t("copilot.copilotPanel.askAQuestion")
                    : t("copilot.copilotPanel.searchForMatchingPassages")
                }
                error={sendError}
                inputRef={inputRef}
                composing={composing}
              />
            </footer>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
