/**
 * A copilot answer that outlives the request that asked for it (P4-T14b-b).
 *
 * **The problem this solves is that an answer used to exist only inside one
 * HTTP response.** `streamAnswer` produces prose into the request that asked
 * for it and records what arrived in a `finally`. Close the tab a few seconds
 * in and the run stops with it: there is nothing still going and nothing to
 * come back to. The acceptance criterion is a member asking for something that
 * takes a minute, reloading, and rejoining, and none of that is reachable from
 * inside a response the reader has just abandoned.
 *
 * So the run is a background job. The question and an empty assistant message
 * are written when the question is asked, the job produces the answer, and the
 * prose is published on a channel anybody holding that thread may listen to.
 * Rejoining is subscribing again.
 *
 * **Every answer takes this path, and the fallback is the old one.** Agung
 * chose that on 20 September 2026 over two narrower readings. Nothing can
 * predict which question will take a minute, so a member who has to ask for a
 * background run in advance is being asked to predict it, and the case the
 * criterion describes, somebody who asked without thinking about it and closed
 * the tab, is the one that still loses its run. One path also means one place
 * where an answer is produced rather than two that drift.
 *
 * An instance whose serving process drains no queue answers inline exactly as
 * before, because enqueuing there would be enqueuing into nothing.
 * `docs/design/copilot-background-runs.md` records the whole of it.
 *
 * **What is published is prose, and what is persisted is the finished
 * answer.** A chunk is not written to the database as it arrives: a write per
 * chunk is a write per token, and every write in this product carries an audit
 * row, which would turn one answer into hundreds of audit entries saying
 * nothing. A reader who rejoins mid-run therefore hears the rest of the answer
 * live and sees the whole of it the moment the run completes. That is stated
 * here rather than discovered: the first half of a long answer is not replayed
 * to somebody who arrives late.
 */
import type { ActionCallContext } from "../actions/define.ts";
import { callAction } from "../actions/registry.ts";
import type {
  AgentDrafter,
  GroundedAnswer,
  GroundedQuestionContext,
} from "../agents/drafter.ts";
import { aiOffSentence } from "../ai/off-reason.ts";
import { resolveAgentRunCostCap } from "../ai/resolve.ts";
import {
  type AnswerSource,
  type CopilotStep,
  citationsFrom,
  groundQuestion,
} from "./answer.ts";
import { offersToPropose, proposeBeforeAnswering } from "./proposals.ts";

/** The channel one copilot conversation's prose is published on. */
export function copilotThreadChannel(
  workspaceId: string,
  threadId: string,
): string {
  return `workspace:${workspaceId}:copilot:${threadId}`;
}

/** What the outbox row carries, and the whole of what the job needs. */
export interface CopilotRunJob {
  readonly workspaceId: string;
  readonly threadId: string;
  /** The question's own message, which the history is read up to. */
  readonly questionMessageId: string;
  /** The empty assistant message the answer is written into. */
  readonly answerMessageId: string;
  /** Who asked. The run acts as them, so the audit row names a person. */
  readonly userId: string;
  readonly question: string;
}

/** Turns an outbox payload into a job, or answers null. */
export function parseCopilotRunJob(
  payload: Record<string, unknown>,
): CopilotRunJob | null {
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value : null;
  const workspaceId = text(payload.workspaceId);
  const threadId = text(payload.threadId);
  const questionMessageId = text(payload.questionMessageId);
  const answerMessageId = text(payload.answerMessageId);
  const userId = text(payload.userId);
  const question = text(payload.question);
  if (
    !workspaceId ||
    !threadId ||
    !questionMessageId ||
    !answerMessageId ||
    !userId ||
    !question
  ) {
    return null;
  }
  return {
    workspaceId,
    threadId,
    questionMessageId,
    answerMessageId,
    userId,
    question,
  };
}

/** How the run reports itself, for a caller that wants to know. */
export interface CopilotRunOutcome {
  readonly answered: boolean;
  /** Set when the run ended early, in the words the reader is shown. */
  readonly haltedReason: string | null;
  readonly sources: readonly AnswerSource[];
}

export interface CopilotRunDeps {
  /** Publishes one event. Absent on a deployment with no realtime. */
  readonly publish?: (
    channel: string,
    event: string,
    data: Record<string, unknown>,
  ) => Promise<void>;
}

/**
 * Produces one answer, publishing it as it goes and recording it at the end.
 *
 * **Safe to run twice.** `copilot.completeRun` refuses a message that has
 * already completed, so a redelivered row costs one retrieval and one refused
 * write rather than a second answer charged to the workspace.
 */
export async function runCopilotAnswer(
  context: ActionCallContext,
  job: CopilotRunJob,
  deps: CopilotRunDeps = {},
): Promise<CopilotRunOutcome> {
  const channel = copilotThreadChannel(job.workspaceId, job.threadId);
  const publish = async (
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> => {
    // Never fatal to the run. A realtime driver having a bad minute should
    // cost the reader their live view, not the answer they paid for.
    await deps.publish?.(channel, event, data).catch(() => undefined);
  };

  const halt = async (reason: string): Promise<CopilotRunOutcome> => {
    await callAction(context, "copilot.completeRun", {
      answerMessageId: job.answerMessageId,
      text: "",
      citations: [],
      haltedReason: reason,
    });
    await publish("copilot.done", {
      answerMessageId: job.answerMessageId,
      haltedReason: reason,
    });
    return { answered: false, haltedReason: reason, sources: [] };
  };

  /**
   * **The budget is read before a token is spent** (P4-T14b-b's test plan).
   *
   * Zero means this workspace has decided an AI run may not spend, which is
   * the opposite of unset, and the Champion's own runs have halted on it since
   * P5-T09. Saying so is half the requirement: a run that stopped silently
   * leaves a short answer that looks finished.
   */
  // **A redelivered row stops here** (plan 0.8.1 A2). Asking for the proposal
  // writes a card, and `copilot.completeRun` refusing the second answer comes
  // too late to stop a second card. An answer no longer running was written.
  if (await alreadyAnswered(context, job)) {
    return { answered: false, haltedReason: null, sources: [] };
  }

  const capUsd = await resolveAgentRunCostCap(context.pool, job.workspaceId);
  if (capUsd <= 0) {
    return halt(
      `Halted before starting: the cost cap for this workspace is ${capUsd}, ` +
        "so a run may not spend. An administrator sets it in AI governance.",
    );
  }

  // Each step as it happens, so the reader is told what the run is doing
  // rather than watching an empty answer (plan 0.8.1 W2).
  const step = (data: CopilotStep) =>
    publish("copilot.step", { answerMessageId: job.answerMessageId, ...data });

  await step({ step: "searching" });
  const prepared = await groundQuestion(
    context,
    {
      threadId: job.threadId,
      questionMessageId: job.questionMessageId,
      question: job.question,
    },
    (drafter) => Boolean(drafter.streamGrounded ?? drafter.answerGrounded),
  );
  await step({ step: "found", count: prepared.sources.length });
  await publish("copilot.sources", {
    answerMessageId: job.answerMessageId,
    sources: prepared.sources,
  });

  const drafter = context.drafter;
  if (!prepared.ask || !(drafter?.streamGrounded ?? drafter?.answerGrounded)) {
    // The relay passes no reason, so this reads as no provider, as before. It
    // only happens when AI went off between the question and this run.
    return halt(
      prepared.unavailableReason ??
        aiOffSentence(context.aiOff ?? "no_provider", "answer"),
    );
  }

  // The proposal first, so the answer is told whether a card exists (A2).
  const offers = await offersToPropose(context);
  if (offers !== null) {
    await step({ step: "proposing" });
  }
  const proposal = await proposeBeforeAnswering(
    context,
    { threadId: job.threadId, request: job.question },
    offers,
  );
  if (proposal.proposalId !== null) {
    await publish("copilot.proposal", {
      answerMessageId: job.answerMessageId,
      proposalId: proposal.proposalId,
    });
  }
  const ask = { ...prepared.ask, proposal: proposal.note };
  await step({ step: "writing" });

  const answered = drafter?.streamGrounded
    ? await streamInto(drafter, ask, (text) =>
        publish("copilot.text", { answerMessageId: job.answerMessageId, text }),
      )
    : await wholeInto(drafter, ask, (text) =>
        publish("copilot.text", { answerMessageId: job.answerMessageId, text }),
      );

  if (answered.kind === "failed") {
    return halt(
      "The provider did not answer. These are the passages that match your question.",
    );
  }
  if (answered.kind === "empty") {
    return halt(
      "The copilot had nothing to add. These are the passages that match your question.",
    );
  }

  const answer = answered.answer;
  const spent = answer.costUsd ?? 0;
  const overBudget = spent > capUsd;
  const stoppedPartway =
    answered.kind === "partial"
      ? "The provider stopped partway through this answer. What arrived is kept."
      : null;

  await callAction(context, "copilot.completeRun", {
    answerMessageId: job.answerMessageId,
    text: answer.text,
    citations: citationsFrom(prepared.hits, answer.usedSourceIndexes),
    ...(answer.model ? { model: answer.model } : {}),
    ...(answer.tokensIn === undefined ? {} : { tokensIn: answer.tokensIn }),
    ...(answer.tokensOut === undefined ? {} : { tokensOut: answer.tokensOut }),
    ...(answer.costUsd === undefined ? {} : { cost: answer.costUsd }),
    ...(overBudget
      ? {
          haltedReason:
            `This answer cost ${spent} and the cap for this workspace is ` +
            `${capUsd}. The next run will halt before starting until an ` +
            "administrator raises it.",
        }
      : stoppedPartway === null
        ? {}
        : { haltedReason: stoppedPartway }),
  });

  await publish("copilot.done", {
    answerMessageId: job.answerMessageId,
    haltedReason: stoppedPartway,
  });

  return {
    answered: true,
    haltedReason: null,
    sources: prepared.sources,
  };
}

/** How long published words wait to be joined by the next ones, at most. */
const PUBLISH_EVERY_MS = 60;

/**
 * How much text one published event may carry. NOTIFY refuses a payload past
 * 8000 bytes and a character may take four, so this stays well under it.
 */
const PUBLISH_AT_CHARACTERS = 1_000;

type Answered =
  | { readonly kind: "whole"; readonly answer: GroundedAnswer }
  | { readonly kind: "partial"; readonly answer: GroundedAnswer }
  | { readonly kind: "empty" }
  | { readonly kind: "failed" };

/**
 * The answer, published as it is written (plan 0.8.1 W1).
 *
 * Every answer on a deployment that drains its queue comes this way, and it
 * used to arrive in one piece at the end: the reader watched nothing for
 * seconds and then the whole answer. Pieces are joined for up to
 * `PUBLISH_EVERY_MS`, so a token does not cost a NOTIFY of its own, and the
 * reader still sees the words come.
 *
 * A stream that stops without its `done` keeps what arrived, marked as
 * stopped partway, which is what the inline path does too.
 */
async function streamInto(
  drafter: AgentDrafter,
  ask: GroundedQuestionContext,
  publishText: (text: string) => Promise<void>,
): Promise<Answered> {
  let text = "";
  let pending = "";
  let flushedAt = 0;
  let done: GroundedAnswer | null = null;
  const flush = async () => {
    if (pending === "") {
      return;
    }
    const piece = pending;
    pending = "";
    flushedAt = Date.now();
    await publishText(piece);
  };
  try {
    // Through the drafter, for the reason `answerQuestion` records.
    for await (const chunk of drafter.streamGrounded?.(ask) ?? []) {
      if (chunk.kind === "done") {
        done = chunk.answer;
        continue;
      }
      text += chunk.text;
      pending += chunk.text;
      if (
        Date.now() - flushedAt >= PUBLISH_EVERY_MS ||
        pending.length >= PUBLISH_AT_CHARACTERS
      ) {
        await flush();
      }
    }
  } catch {
    // Handled below by what arrived: nothing, or a partial answer.
  }
  await flush();
  if (done !== null) {
    return done.text.trim() === ""
      ? { kind: "empty" }
      : { kind: "whole", answer: done };
  }
  if (text.trim() === "") {
    return { kind: "failed" };
  }
  return {
    kind: "partial",
    answer: { text: text.trim(), usedSourceIndexes: [] },
  };
}

/** A drafter that cannot stream answers whole, published as one piece. */
async function wholeInto(
  drafter: AgentDrafter | undefined,
  ask: GroundedQuestionContext,
  publishText: (text: string) => Promise<void>,
): Promise<Answered> {
  let answer: GroundedAnswer | null;
  try {
    // Through the drafter, never as a detached function: a host's drafter is
    // often a class instance and `const f = drafter.answerGrounded` loses
    // `this`. The comment in `answerQuestion` says what that cost once.
    answer = (await drafter?.answerGrounded?.(ask)) ?? null;
  } catch {
    return { kind: "failed" };
  }
  if (!answer || answer.text.trim() === "") {
    return { kind: "empty" };
  }
  await publishText(answer.text);
  return { kind: "whole", answer };
}

/** Whether this run's answer was already written, by an earlier delivery. */
async function alreadyAnswered(
  context: ActionCallContext,
  job: CopilotRunJob,
): Promise<boolean> {
  try {
    const thread = await callAction(context, "copilot.thread", {
      threadId: job.threadId,
    });
    const answer = thread.messages.find(
      (message) => message.id === job.answerMessageId,
    );
    return answer !== undefined && !answer.running;
  } catch {
    // Unreadable is not proof it was answered. The run goes ahead, and
    // `copilot.completeRun` still refuses a second answer.
    return false;
  }
}
