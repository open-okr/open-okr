/**
 * Grounded question answering (AI-NATIVE-PLAN.md §2.4, P4-T14a-a and P4-T14a-b).
 *
 * **Plain functions, not registered actions.** They run two registered writes
 * with a retrieval and a model call between them, and the model call must happen
 * with no transaction open: `actions/copilot.ts` explains why at length. Nothing
 * escapes the contract registry, because both writes are in it. The precedent is
 * `resolveAICredential`, which is also plain for a reason about what a single
 * action would have to hold.
 *
 * **The degradation is the product, not a fallback.** §2.4's own line is
 * "degrades to full-text search". With no provider, or with the feature switched
 * off, or with the budget spent, both functions return the passages retrieval
 * found and no prose. Nothing is written but the question. That is a smaller
 * answer and a true one, and it is what a self-hosted instance with no API key
 * gets.
 *
 * Two entry points over one preparation. `answerQuestion` waits for the whole
 * answer, which is what a chat command or an external agent asking once wants.
 * `streamAnswer` yields the words as they arrive, which is what the panel wants,
 * and records what arrived even when the reader stops it halfway.
 */

import { activeOnly, withWorkspace, workspaceMembers } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  askingMemberId,
  COPILOT_DEFAULT_TIER,
  COPILOT_FEATURE_KEY,
} from "../actions/copilot.ts";
import type { ActionCallContext } from "../actions/define.ts";
import { callAction } from "../actions/registry.ts";
import type {
  AgentDrafter,
  GroundedQuestionContext,
  GroundingSource,
} from "../agents/drafter.ts";
import { checkFeatureAvailability } from "../ai/budgets.ts";
import { aiOffSentence } from "../ai/off-reason.ts";
import { EmbeddingService, type RetrievalHit } from "../embeddings/service.ts";
import { creditsPausedReason } from "../tenancy/index.ts";
import { citationLabel } from "./citations.ts";
import { offersToPropose, proposeBeforeAnswering } from "./proposals.ts";
import { COPILOT_READS } from "./read-tools.ts";
import { drainReading, readLiveData, withReadingCost } from "./reading.ts";

/**
 * How many passages a grounded answer is given.
 *
 * Six rather than the retrieval default of ten: a passage is up to a few hundred
 * words, and the context guard refuses an oversized request rather than
 * truncating one, so the request has to be built small enough to send.
 */
export const GROUNDING_LIMIT = 6;

/** How many earlier turns the model is shown, so a follow-up makes sense. */
const HISTORY_TURNS = 8;

export interface AnswerQuestionInput {
  readonly workspaceId: string;
  readonly question: string;
  /** Omit to start a new conversation. */
  readonly threadId?: string;
  readonly subjectType?: string;
  readonly subjectId?: string;
}

/** One passage retrieval found, as a reader is shown it. */
export interface AnswerSource {
  readonly entityType: string;
  readonly entityId: string;
  readonly label: string;
  readonly excerpt: string;
}

export interface AnswerQuestionResult {
  readonly threadId: string;
  /** The member's own turn, always written. */
  readonly questionMessageId: string;
  /** The answer's message id, or null when there was no prose to record. */
  readonly answerMessageId: string | null;
  /** The prose, or null. */
  readonly answer: string | null;
  /** What retrieval found, whether or not a model used it. */
  readonly sources: readonly AnswerSource[];
  /** Why there is no prose, in words for the reader. Null when there is prose. */
  readonly unavailableReason: string | null;
}

/** What the model is shown of one hit. Never its identifier. */
const sourceFor = (hit: RetrievalHit): GroundingSource => ({
  label: citationLabel(hit.content),
  content: hit.content,
});

/**
 * The model's claimed source indexes, turned into citations.
 *
 * **Indexes, dropped when out of range.** The model is shown passages
 * positionally and never an identifier, so it cannot name an entity that was not
 * retrieved for this member. An index outside the list is a model miscounting,
 * and the citation it would have produced does not exist.
 */
export const citationsFrom = (
  hits: readonly { readonly entityType: string; readonly entityId: string }[],
  indexes: readonly number[],
) =>
  [...new Set(indexes)]
    .filter(
      (index) => Number.isInteger(index) && index >= 0 && index < hits.length,
    )
    .map((index) => ({ index, hit: hits[index] }))
    .filter(
      (
        entry,
      ): entry is {
        readonly index: number;
        readonly hit: NonNullable<(typeof hits)[number]>;
      } => entry.hit !== undefined,
    )
    // `n` is the number the model saw: indexes are 0-based, the prose's `[n]`
    // is 1-based (plan 0.9.0 CP5).
    .map(({ index, hit }) => ({
      entityType: hit.entityType,
      entityId: hit.entityId,
      n: index + 1,
    }));

export interface Prepared {
  readonly threadId: string;
  readonly questionMessageId: string;
  readonly hits: readonly RetrievalHit[];
  /**
   * What a citation index points at, by position. Retrieval's hits until the
   * read loop replaces them with the records it read, in the order the model
   * was shown their numbers (plan 0.9.0 L2b).
   */
  readonly cite: readonly {
    readonly entityType: string;
    readonly entityId: string;
  }[];
  readonly sources: readonly AnswerSource[];
  /** Null when there is nothing that can answer. */
  readonly ask: GroundedQuestionContext | null;
  readonly unavailableReason: string | null;
}

/**
 * Records the question, retrieves, and decides whether anything can answer.
 *
 * The question is written first and unconditionally. A run that then fails to
 * get an answer leaves a thread showing what was asked and nothing back, which
 * is what happened; writing the question last would lose it.
 */
async function prepare(
  context: ActionCallContext,
  input: AnswerQuestionInput,
  wants: (drafter: AgentDrafter) => boolean,
): Promise<Prepared> {
  const asked = await callAction(context, "copilot.ask", {
    threadId: input.threadId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    question: input.question,
    // Inline. This path is the fallback for an instance draining no queue.
    background: false,
  });
  return groundQuestion(
    context,
    {
      threadId: asked.threadId,
      questionMessageId: asked.messageId,
      question: input.question,
    },
    wants,
  );
}

/** A question already written down, and what it takes to answer it. */
export interface GroundedAsk {
  readonly threadId: string;
  readonly questionMessageId: string;
  readonly question: string;
}

/**
 * Retrieves, and decides whether anything can answer.
 *
 * **Split out of `prepare` at P4-T14b-b**, which needs everything here and
 * none of the recording above it: a background run's question was written when
 * the member asked, in the same transaction that created the empty answer and
 * enqueued the job, and recording it a second time would put the question in
 * the thread twice.
 */
export async function groundQuestion(
  context: ActionCallContext,
  asked: GroundedAsk,
  wants: (drafter: AgentDrafter) => boolean,
): Promise<Prepared> {
  const pool: Pool = context.pool;
  const input = { question: asked.question, workspaceId: context.workspaceId };
  const memberId = await askingMemberId(context);
  const asker = await askerName(context, memberId);

  // Retrieval runs whether or not there is a model: with no provider this is
  // the whole answer.
  const service = new EmbeddingService(pool, context.embed ?? null);
  const hits = await service.retrieve({
    workspaceId: input.workspaceId,
    memberId,
    query: input.question,
    limit: GROUNDING_LIMIT,
  });
  const sources = hits.map((hit) => ({
    entityType: hit.entityType,
    entityId: hit.entityId,
    label: citationLabel(hit.content),
    excerpt: hit.content,
  }));

  const nothing = (reason: string): Prepared => ({
    threadId: asked.threadId,
    questionMessageId: asked.questionMessageId,
    hits,
    cite: hits,
    sources,
    ask: null,
    unavailableReason: reason,
  });

  const drafter = context.drafter;
  if (!drafter || !wants(drafter)) {
    const paused = await creditsPausedReason(pool, input.workspaceId);
    if (paused) {
      return nothing(paused);
    }
    return nothing(aiOffSentence(context.aiOff ?? "no_provider", "answer"));
  }

  const availability = await checkFeatureAvailability(pool, {
    workspaceId: input.workspaceId,
    featureKey: COPILOT_FEATURE_KEY,
    defaultTier: COPILOT_DEFAULT_TIER,
    memberId,
  });
  if (!availability.available) {
    return nothing(
      availability.reason ??
        "The copilot is not available in this workspace right now.",
    );
  }

  return {
    threadId: asked.threadId,
    questionMessageId: asked.questionMessageId,
    hits,
    cite: hits,
    sources,
    ask: {
      question: input.question,
      history: await recentTurns(
        context,
        asked.threadId,
        asked.questionMessageId,
      ),
      sources: hits.map(sourceFor),
      ...(asker === null ? {} : { asker }),
    },
    unavailableReason: null,
  };
}

/**
 * The asking member's name, or null. The model needs it to match "my" to a
 * record that names the person; the same directory names tool results carry.
 * A decoration: a failure leaves the name out and the answer still runs.
 */
async function askerName(
  context: ActionCallContext,
  memberId: string,
): Promise<string | null> {
  try {
    return await withWorkspace(
      drizzle(context.pool),
      context.workspaceId,
      async (tx) => {
        const rows = await tx
          .select({ name: workspaceMembers.name })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, context.workspaceId),
              eq(workspaceMembers.id, memberId),
            ),
          );
        const name = rows[0]?.name?.trim();
        return name ? name : null;
      },
    );
  } catch {
    return null;
  }
}

/** Asks, grounds, answers and records, waiting for the whole answer. */
export async function answerQuestion(
  context: ActionCallContext,
  input: AnswerQuestionInput,
): Promise<AnswerQuestionResult> {
  const groundedFirst = await prepare(context, input, (drafter) =>
    Boolean(drafter.answerGrounded),
  );
  // The read loop, which leaves the passages as they were when it cannot run.
  const reading = await drainReading(readLiveData(context, groundedFirst));
  const prepared = reading?.prepared ?? groundedFirst;
  const nothing = (reason: string): AnswerQuestionResult => ({
    threadId: prepared.threadId,
    questionMessageId: prepared.questionMessageId,
    answerMessageId: null,
    answer: null,
    sources: prepared.sources,
    unavailableReason: reason,
  });

  // Called through the drafter, never as a detached function. A host's drafter
  // is very often a class instance, and `const f = drafter.answerGrounded`
  // loses `this`: the call throws, the catch below turns it into "the provider
  // did not answer", and a working provider reads as an absent one. Cost an
  // afternoon once.
  const drafter = context.drafter;
  if (reading?.blockedReason) {
    return nothing(reading.blockedReason);
  }
  if (!prepared.ask || !drafter?.answerGrounded) {
    return nothing(
      prepared.unavailableReason ??
        aiOffSentence(context.aiOff ?? "no_provider", "answer"),
    );
  }

  let answer: Awaited<ReturnType<NonNullable<AgentDrafter["answerGrounded"]>>>;
  try {
    answer = await drafter.answerGrounded(prepared.ask);
  } catch {
    // A model having a bad minute leaves the question recorded and the passages
    // on screen, which is the same place a provider-off workspace stands.
    return nothing(
      "The provider did not answer. These are the passages that match your question.",
    );
  }
  if (!answer || answer.text.trim() === "") {
    return nothing(
      "The copilot had nothing to add. These are the passages that match your question.",
    );
  }

  const spent = withReadingCost(answer, reading);
  const recorded = await callAction(context, "copilot.recordAnswer", {
    threadId: prepared.threadId,
    text: answer.text,
    citations: citationsFrom(prepared.cite, answer.usedSourceIndexes),
    model: answer.model,
    tokensIn: spent.tokensIn,
    tokensOut: spent.tokensOut,
    cost: spent.costUsd,
    stopped: false,
  });

  return {
    threadId: prepared.threadId,
    questionMessageId: prepared.questionMessageId,
    answerMessageId: recorded.messageId,
    answer: answer.text,
    sources: prepared.sources,
    unavailableReason: null,
  };
}

/**
 * The step a run is on, as a reader is told it (plan 0.8.1 W2).
 *
 * Fixed keys, each a thing the run really does, so the panel words them from
 * its own catalogue and never shows a model's text as progress. Live only:
 * nothing stores them (W2-Q), and the finished answer's sources and card say
 * the same thing after a reload. L2's read tools (0.9.0) add their own.
 */
export type CopilotStep =
  | { readonly step: "searching" }
  | { readonly step: "found"; readonly count: number }
  /**
   * One read the loop ran (plan 0.9.0 L2b). `tool` is one of the copilot's
   * dotted read names, and `subject` is the title of the one record a read of
   * a single record opened, so the panel can say "Reading <title>".
   */
  | {
      readonly step: "reading";
      readonly tool: string;
      readonly subject?: string;
    }
  | { readonly step: "proposing" }
  | { readonly step: "writing" };

/**
 * A published step, checked, or null. The routes forward what a background
 * run published, and a payload off the wire is checked before it is sent on.
 */
export function copilotStepFrom(
  data: Readonly<Record<string, unknown>>,
): CopilotStep | null {
  switch (data.step) {
    case "searching":
    case "proposing":
    case "writing":
      return { step: data.step };
    case "found":
      return typeof data.count === "number" &&
        Number.isInteger(data.count) &&
        data.count >= 0
        ? { step: "found", count: data.count }
        : null;
    case "reading": {
      // Bounded, and only the tools the copilot has: a payload off the wire
      // never puts its own words on a reader's screen.
      if (
        typeof data.tool !== "string" ||
        !(COPILOT_READS as readonly string[]).includes(data.tool)
      ) {
        return null;
      }
      const subject =
        typeof data.subject === "string" && data.subject.trim() !== ""
          ? data.subject.slice(0, 120)
          : undefined;
      return {
        step: "reading",
        tool: data.tool,
        ...(subject === undefined ? {} : { subject }),
      };
    }
    default:
      return null;
  }
}

/** What a streamed answer sends, in the order it sends it. */
export type CopilotEvent =
  /** First, always: where the question was written. */
  | {
      readonly kind: "thread";
      readonly threadId: string;
      readonly questionMessageId: string;
      /**
       * The answer a background run writes into, so the panel can stop it
       * (plan 0.8.1 W4). Absent inline, where stopping is cancelling the
       * request.
       */
      readonly answerMessageId?: string;
    }
  /** What retrieval found. Sent before any prose, and sent when there is none. */
  | { readonly kind: "sources"; readonly sources: readonly AnswerSource[] }
  /** The step the run is on now (plan 0.8.1 W2). */
  | ({ readonly kind: "step" } & CopilotStep)
  /**
   * A change card was made for this question, before the answer (plan 0.8.1
   * A2). The panel reads the thread's proposals when it arrives, so the card
   * is on screen while the answer is still being written.
   */
  | { readonly kind: "proposal"; readonly proposalId: string }
  /** No prose is coming, and this is why, in words for the reader. */
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "text"; readonly text: string }
  /** Last: what was recorded, and whether the reader cut it short. */
  | {
      readonly kind: "done";
      readonly answerMessageId: string | null;
      readonly stopped: boolean;
    };

/**
 * The same answer, streamed, recording what arrived even when it is stopped.
 *
 * **The recording is in a `finally`.** A reader pressing stop, or closing the
 * tab, stops the consumer pulling from this generator, and the runtime then
 * finalises it. A `finally` is the only place that runs in both endings, so it is
 * where the write goes. Nothing can be yielded from there, which is why the
 * `done` event may not arrive on a stop: the reader who stopped it already knows.
 *
 * A stop before the first token records nothing, and the question stays
 * unanswered so it can be asked again. Recording an empty answer would be
 * recording that the copilot said nothing, which is not what happened.
 */
export async function* streamAnswer(
  context: ActionCallContext,
  input: AnswerQuestionInput,
  signal?: AbortSignal,
): AsyncGenerator<CopilotEvent> {
  // Recorded first, as `prepare` does, and split from the retrieval here so
  // the reader is told the search has started while it runs (plan 0.8.1 W2).
  const asked = await callAction(context, "copilot.ask", {
    threadId: input.threadId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    question: input.question,
    background: false,
  });
  yield {
    kind: "thread",
    threadId: asked.threadId,
    questionMessageId: asked.messageId,
  };
  yield { kind: "step", step: "searching" };
  const groundedFirst = await groundQuestion(
    context,
    {
      threadId: asked.threadId,
      questionMessageId: asked.messageId,
      question: input.question,
    },
    (drafter) => Boolean(drafter.streamGrounded),
  );
  yield { kind: "step", step: "found", count: groundedFirst.sources.length };
  yield { kind: "sources", sources: groundedFirst.sources };

  // The read loop: one step per read, then the records it read replace the
  // passages as the sources. It leaves the passages when it cannot run.
  // `proceed` ends the loop when the reader has gone, before the next round.
  const readingRun = readLiveData(context, groundedFirst, {
    proceed: async () => !signal?.aborted,
  });
  let readingNext = await readingRun.next();
  while (!readingNext.done) {
    yield { kind: "step", ...readingNext.value };
    readingNext = await readingRun.next();
  }
  const reading = readingNext.value;
  const prepared = reading?.prepared ?? groundedFirst;
  if (prepared !== groundedFirst) {
    yield { kind: "sources", sources: prepared.sources };
  }

  // Through the drafter, for the reason `answerQuestion` records above.
  const drafter = context.drafter;
  if (reading?.blockedReason || !prepared.ask || !drafter?.streamGrounded) {
    yield {
      kind: "unavailable",
      reason:
        reading?.blockedReason ??
        prepared.unavailableReason ??
        aiOffSentence(context.aiOff ?? "no_provider", "answer"),
    };
    yield { kind: "done", answerMessageId: null, stopped: false };
    return;
  }

  // The proposal first, so the answer is told whether a card exists (A2).
  const offers = await offersToPropose(context);
  if (offers !== null) {
    yield { kind: "step", step: "proposing" };
  }
  const proposal = await proposeBeforeAnswering(
    context,
    { threadId: prepared.threadId, request: input.question },
    offers,
  );
  if (proposal.proposalId !== null) {
    yield { kind: "proposal", proposalId: proposal.proposalId };
  }
  const ask = { ...prepared.ask, proposal: proposal.note };
  yield { kind: "step", step: "writing" };

  let text = "";
  let cited: readonly number[] | null = null;
  let model: string | undefined;
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;
  let cost: number | undefined;
  let recorded = false;
  let answerMessageId: string | null = null;

  /** Writes what arrived. Runs once, whether the stream ended or was stopped. */
  const record = async (): Promise<void> => {
    if (recorded) {
      return;
    }
    recorded = true;
    if (text.trim() === "") {
      return;
    }
    const spent = withReadingCost(
      { costUsd: cost, tokensIn, tokensOut },
      reading,
    );
    const written = await callAction(context, "copilot.recordAnswer", {
      threadId: prepared.threadId,
      text,
      // No `done` chunk means no citation list: the model never said which
      // passages its unfinished sentence rested on, and guessing would be
      // inventing the one thing this feature promises not to invent.
      citations: cited ? citationsFrom(prepared.cite, cited) : [],
      model,
      tokensIn: spent.tokensIn,
      tokensOut: spent.tokensOut,
      cost: spent.costUsd,
      stopped: cited === null,
    });
    answerMessageId = written.messageId;
  };

  try {
    for await (const chunk of drafter.streamGrounded(ask, signal)) {
      if (chunk.kind === "text") {
        text += chunk.text;
        yield { kind: "text", text: chunk.text };
        continue;
      }
      text = chunk.answer.text;
      cited = [...chunk.answer.usedSourceIndexes];
      model = chunk.answer.model;
      tokensIn = chunk.answer.tokensIn;
      tokensOut = chunk.answer.tokensOut;
      cost = chunk.answer.costUsd;
    }
  } catch {
    // The provider fell over mid-answer. What arrived is still what the reader
    // saw, so it is recorded and marked as stopped rather than discarded.
  } finally {
    await record();
  }

  if (text.trim() === "") {
    yield {
      kind: "unavailable",
      reason:
        "The copilot had nothing to add. These are the passages that match your question.",
    };
  }
  yield { kind: "done", answerMessageId, stopped: cited === null };
}

/** The last few turns of the thread, oldest first, excluding this question. */
async function recentTurns(
  context: ActionCallContext,
  threadId: string,
  excludeMessageId: string,
): Promise<
  readonly { readonly role: "member" | "assistant"; readonly content: string }[]
> {
  const thread = await callAction(context, "copilot.thread", { threadId });
  return thread.messages
    .filter((message) => message.id !== excludeMessageId)
    .slice(-HISTORY_TURNS)
    .map((message) => ({ role: message.role, content: message.content }));
}
