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
 * `docs/design/p4-t14b-b-copilot-background-runs.md` records the whole of it.
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
import { resolveAgentRunCostCap } from "../ai/resolve.ts";
import { type AnswerSource, citationsFrom, groundQuestion } from "./answer.ts";

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
  const capUsd = await resolveAgentRunCostCap(context.pool, job.workspaceId);
  if (capUsd <= 0) {
    return halt(
      `Halted before starting: the cost cap for this workspace is ${capUsd}, ` +
        "so a run may not spend. An administrator sets it in AI governance.",
    );
  }

  const prepared = await groundQuestion(
    context,
    {
      threadId: job.threadId,
      questionMessageId: job.questionMessageId,
      question: job.question,
    },
    (drafter) => Boolean(drafter.answerGrounded),
  );
  await publish("copilot.sources", {
    answerMessageId: job.answerMessageId,
    sources: prepared.sources,
  });

  if (!prepared.ask || !context.drafter?.answerGrounded) {
    return halt(
      prepared.unavailableReason ??
        "No AI provider is configured, so these are the passages that match your question.",
    );
  }

  let answer: Awaited<
    ReturnType<NonNullable<typeof context.drafter.answerGrounded>>
  >;
  try {
    // Through the drafter, never as a detached function: a host's drafter is
    // often a class instance and `const f = drafter.answerGrounded` loses
    // `this`. The comment in `answerQuestion` says what that cost once.
    answer = await context.drafter.answerGrounded(prepared.ask);
  } catch {
    return halt(
      "The provider did not answer. These are the passages that match your question.",
    );
  }
  if (!answer || answer.text.trim() === "") {
    return halt(
      "The copilot had nothing to add. These are the passages that match your question.",
    );
  }

  // One event with the whole answer rather than a token at a time. The drafter
  // port answers whole; streaming it would mean a streaming port, and that is
  // a change to `packages/adapters` this row does not need. The reader still
  // gets it without the request they asked on, which is the point.
  await publish("copilot.text", {
    answerMessageId: job.answerMessageId,
    text: answer.text,
  });

  const spent = answer.costUsd ?? 0;
  const overBudget = spent > capUsd;

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
      : {}),
  });

  await publish("copilot.done", {
    answerMessageId: job.answerMessageId,
    haltedReason: null,
  });

  return {
    answered: true,
    haltedReason: null,
    sources: prepared.sources,
  };
}
