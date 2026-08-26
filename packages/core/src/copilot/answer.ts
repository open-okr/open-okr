/**
 * Grounded question answering (AI-NATIVE-PLAN.md §2.4, P4-T14a-a).
 *
 * **A plain function, not a registered action.** It runs two registered writes
 * with a retrieval and a model call between them, and the model call must happen
 * with no transaction open: `copilot.ts` explains why at length. Nothing escapes
 * the contract registry, because both writes are in it. The precedent is
 * `resolveAICredential`, which is also plain for a reason about what a single
 * action would have to hold.
 *
 * **The degradation is the product, not a fallback.** §2.4's own line is
 * "degrades to full-text search". With no provider, or with the feature switched
 * off, or with the budget spent, this returns the passages retrieval found and
 * no prose. Nothing is written but the question. That is a smaller answer and a
 * true one, and it is what a self-hosted instance with no API key gets.
 */
import type { Pool } from "pg";
import {
  askingMemberId,
  COPILOT_DEFAULT_TIER,
  COPILOT_FEATURE_KEY,
} from "../actions/copilot.ts";
import type { ActionCallContext } from "../actions/define.ts";
import { callAction } from "../actions/registry.ts";
import type { AgentDrafter, GroundingSource } from "../agents/drafter.ts";
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

export interface AnswerQuestionResult {
  readonly threadId: string;
  /** The member's own turn, always written. */
  readonly questionMessageId: string;
  /** The answer's message id, or null when there was no prose to record. */
  readonly answerMessageId: string | null;
  /** The prose, or null. */
  readonly answer: string | null;
  /** What retrieval found, whether or not a model used it. */
  readonly sources: readonly {
    readonly entityType: string;
    readonly entityId: string;
    readonly label: string;
    readonly excerpt: string;
  }[];
  /**
   * Why there is no prose, in words for the reader. Null when there is prose.
   */
  readonly unavailableReason: string | null;
}

/** What the model is shown of one hit. Never its identifier. */
const sourceFor = (hit: RetrievalHit): GroundingSource => ({
  label: citationLabel(hit.content),
  content: hit.content,
});

/**
 * Asks, grounds, answers and records.
 *
 * The question is written first and unconditionally. A run that then fails to
 * get an answer leaves a thread showing what was asked and nothing back, which
 * is what happened; writing the question last would lose it.
 */
export async function answerQuestion(
  context: ActionCallContext,
  input: AnswerQuestionInput,
): Promise<AnswerQuestionResult> {
  const pool: Pool = context.pool;

  const asked = await callAction(context, "copilot.ask", {
    threadId: input.threadId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    question: input.question,
  });

  const memberId = await askingMemberId(context);

  // Retrieval first, and it runs whether or not there is a model: with no
  // provider this is the whole answer.
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

  const nothing = (reason: string): AnswerQuestionResult => ({
    threadId: asked.threadId,
    questionMessageId: asked.messageId,
    answerMessageId: null,
    answer: null,
    sources,
    unavailableReason: reason,
  });

  const drafter: AgentDrafter | undefined = context.drafter;
  if (!drafter?.answerGrounded) {
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

  const history = await recentTurns(context, asked.threadId, asked.messageId);

  let answer: Awaited<ReturnType<NonNullable<AgentDrafter["answerGrounded"]>>>;
  try {
    answer = await drafter.answerGrounded({
      question: input.question,
      history,
      sources: hits.map(sourceFor),
    });
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

  // **Indexes, dropped when out of range.** The model is shown passages
  // positionally and never an identifier, so it cannot name an entity that was
  // not retrieved for this member. An index outside the list is a model
  // miscounting, and the citation it would have produced does not exist.
  const cited = [...new Set(answer.usedSourceIndexes)]
    .filter(
      (index) => Number.isInteger(index) && index >= 0 && index < hits.length,
    )
    .map((index) => hits[index])
    .filter((hit): hit is RetrievalHit => hit !== undefined)
    .map((hit) => ({ entityType: hit.entityType, entityId: hit.entityId }));

  const recorded = await callAction(context, "copilot.recordAnswer", {
    threadId: asked.threadId,
    text: answer.text,
    citations: cited,
    model: answer.model,
    tokensIn: answer.tokensIn,
    tokensOut: answer.tokensOut,
    cost: answer.costUsd,
    stopped: false,
  });

  return {
    threadId: asked.threadId,
    questionMessageId: asked.messageId,
    answerMessageId: recorded.messageId,
    answer: answer.text,
    sources,
    unavailableReason: null,
  };
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
