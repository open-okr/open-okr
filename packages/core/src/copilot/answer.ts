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
import { EmbeddingService, type RetrievalHit } from "../embeddings/service.ts";
import { citationLabel } from "./citations.ts";

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
const citationsFrom = (
  hits: readonly RetrievalHit[],
  indexes: readonly number[],
) =>
  [...new Set(indexes)]
    .filter(
      (index) => Number.isInteger(index) && index >= 0 && index < hits.length,
    )
    .map((index) => hits[index])
    .filter((hit): hit is RetrievalHit => hit !== undefined)
    .map((hit) => ({ entityType: hit.entityType, entityId: hit.entityId }));

interface Prepared {
  readonly threadId: string;
  readonly questionMessageId: string;
  readonly hits: readonly RetrievalHit[];
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
  const pool: Pool = context.pool;

  const asked = await callAction(context, "copilot.ask", {
    threadId: input.threadId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    question: input.question,
  });
  const memberId = await askingMemberId(context);

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
    questionMessageId: asked.messageId,
    hits,
    sources,
    ask: null,
    unavailableReason: reason,
  });

  const drafter = context.drafter;
  if (!drafter || !wants(drafter)) {
    return nothing(
      "No AI provider is configured, so these are the passages that match your question.",
    );
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
    questionMessageId: asked.messageId,
    hits,
    sources,
    ask: {
      question: input.question,
      history: await recentTurns(context, asked.threadId, asked.messageId),
      sources: hits.map(sourceFor),
    },
    unavailableReason: null,
  };
}

/** Asks, grounds, answers and records, waiting for the whole answer. */
export async function answerQuestion(
  context: ActionCallContext,
  input: AnswerQuestionInput,
): Promise<AnswerQuestionResult> {
  const prepared = await prepare(context, input, (drafter) =>
    Boolean(drafter.answerGrounded),
  );
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
  if (!prepared.ask || !drafter?.answerGrounded) {
    return nothing(
      prepared.unavailableReason ??
        "No AI provider is configured, so these are the passages that match your question.",
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

  const recorded = await callAction(context, "copilot.recordAnswer", {
    threadId: prepared.threadId,
    text: answer.text,
    citations: citationsFrom(prepared.hits, answer.usedSourceIndexes),
    model: answer.model,
    tokensIn: answer.tokensIn,
    tokensOut: answer.tokensOut,
    cost: answer.costUsd,
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

/** What a streamed answer sends, in the order it sends it. */
export type CopilotEvent =
  /** First, always: where the question was written. */
  | {
      readonly kind: "thread";
      readonly threadId: string;
      readonly questionMessageId: string;
    }
  /** What retrieval found. Sent before any prose, and sent when there is none. */
  | { readonly kind: "sources"; readonly sources: readonly AnswerSource[] }
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
  const prepared = await prepare(context, input, (drafter) =>
    Boolean(drafter.streamGrounded),
  );
  yield {
    kind: "thread",
    threadId: prepared.threadId,
    questionMessageId: prepared.questionMessageId,
  };
  yield { kind: "sources", sources: prepared.sources };

  // Through the drafter, for the reason `answerQuestion` records above.
  const drafter = context.drafter;
  if (!prepared.ask || !drafter?.streamGrounded) {
    yield {
      kind: "unavailable",
      reason:
        prepared.unavailableReason ??
        "No AI provider is configured, so these are the passages that match your question.",
    };
    yield { kind: "done", answerMessageId: null, stopped: false };
    return;
  }

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
    const written = await callAction(context, "copilot.recordAnswer", {
      threadId: prepared.threadId,
      text,
      // No `done` chunk means no citation list: the model never said which
      // passages its unfinished sentence rested on, and guessing would be
      // inventing the one thing this feature promises not to invent.
      citations: cited ? citationsFrom(prepared.hits, cited) : [],
      model,
      tokensIn,
      tokensOut,
      cost,
      stopped: cited === null,
    });
    answerMessageId = written.messageId;
  };

  try {
    for await (const chunk of drafter.streamGrounded(prepared.ask, signal)) {
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
