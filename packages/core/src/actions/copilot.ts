/**
 * The copilot's threads, messages and grounded answers (AI-NATIVE-PLAN.md §2.4
 * and §7, screen S-39, P4-T14a-a).
 *
 * **Asking and answering are two writes, not one.** A single `copilot.answer`
 * action would be simpler for every projection to call, and it would hold a
 * database transaction open for the length of a model call: `defineWriteAction`
 * builds its handler from an operation spec, and an operation spec's `execute`
 * runs inside the transaction. Ten people asking the copilot a question at once
 * would then be ten connections idle in transaction, waiting on a provider, and
 * the pool has ten. So the question is recorded, the model is called with
 * nothing open, and the answer is recorded second. `answerQuestion` in
 * `copilot/answer.ts` is the orchestration, and it is a plain function for the
 * same reason `resolveAICredential` is.
 *
 * The split is also what P4-T14a-b needs: tokens stream to the browser and are
 * persisted when the stream ends, which no single transactional write can do.
 *
 * **A thread belongs to one member.** §2.4 answers "across everything the user
 * may see", so the same question has different answers for two readers and a
 * shared thread would show one of them the other's. Every action here refuses a
 * thread that is not the caller's, with not-found rather than forbidden.
 */
import {
  type AiCitation,
  activeOnly,
  aiMessages,
  aiThreads,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { checkFeatureAvailability } from "../ai/budgets.ts";
import { readableCitations } from "../copilot/citations.ts";
import { isEmbeddableType } from "../embeddings/subjects.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import {
  type ActionCallContext,
  defineReadAction,
  defineWriteAction,
} from "./define.ts";

/**
 * The feature key the copilot's own switch and budgets hang off.
 *
 * P2-T15's registry has no fixed list of keys, so this is the string, in one
 * place, rather than typed at four call sites. `resolveFeatureTier` treats a
 * missing row as enabled, which is AI-NATIVE-PLAN §4's "on by default where a
 * provider is configured".
 */
export const COPILOT_FEATURE_KEY = "copilot.ask";

/** The tier a grounded answer asks for when no admin has overridden it. */
export const COPILOT_DEFAULT_TIER = "balanced" as const;

/**
 * The acting member, or not-found.
 *
 * A third copy of the same fifteen lines that `actions/sessions.ts` and
 * `actions/alignment.ts` both keep privately. Left local rather than extracted,
 * because moving it means editing two files this task has no other reason to
 * touch, and recorded on the P4-T14a-a row as the extraction to do.
 */
async function actingMember(
  tx: OperationTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string> {
  if (!userId) {
    throw new OperationError("not_found", "No such workspace.");
  }
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError("not_found", "No such workspace.");
  }
  return member.id;
}

/**
 * The acting member's id, for a caller that has a context and no transaction.
 *
 * Exported for `answerQuestion`, which needs the asking member to filter
 * retrieval and has nowhere else to get it: a write action resolves its own
 * actor inside the pipeline and does not hand the id back.
 */
export async function askingMemberId(
  context: ActionCallContext,
): Promise<string> {
  const userId = context.actor.userId;
  if (context.actor.memberId) {
    return context.actor.memberId;
  }
  return withContext(
    drizzle(context.pool),
    { workspaceId: context.workspaceId, userId: userId ?? "" },
    async (rawTx) =>
      actingMember(
        rawTx as unknown as OperationTx,
        context.workspaceId,
        userId,
      ),
  );
}

/** The caller's own thread, or not-found. Somebody else's is not theirs to see. */
async function ownThread(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  threadId: string,
) {
  const [thread] = await tx
    .select({
      id: aiThreads.id,
      memberId: aiThreads.memberId,
      subjectType: aiThreads.subjectType,
      subjectId: aiThreads.subjectId,
      title: aiThreads.title,
      createdAt: aiThreads.createdAt,
      updatedAt: aiThreads.updatedAt,
    })
    .from(aiThreads)
    .where(
      activeOnly(
        aiThreads,
        eq(aiThreads.workspaceId, workspaceId),
        eq(aiThreads.id, threadId),
        eq(aiThreads.memberId, memberId),
      ),
    )
    .limit(1);
  if (!thread) {
    throw new OperationError("not_found", "No such conversation.");
  }
  return thread;
}

/** How much of the question becomes the thread's title. */
const TITLE_LENGTH = 80;

const titleFrom = (question: string) =>
  question.length <= TITLE_LENGTH
    ? question
    : `${question.slice(0, TITLE_LENGTH - 1).trimEnd()}…`;

const citationSchema = z.object({
  entityType: z.string().trim().min(1).max(40),
  entityId: z.uuid(),
});

/**
 * Records a question, opening a thread when there is not one yet.
 *
 * `comment`, not `edit`, and not `view` either.
 *
 * Not `edit`, because the write is the member's own conversation and nothing in
 * the workspace: a member who may read a space but not change it should still be
 * able to ask about it, and what they are answered from is decided by retrieval,
 * which filters by their own access. That is `nudges.snooze`'s reasoning, and
 * this follows it.
 *
 * Not `view`, because `registry.test.ts` holds one absolute line, that no write
 * is ever reachable at `view`, and a conversation is still a write. The cost is
 * that a guest at `view` cannot ask the copilot. That is the narrower grant, and
 * every ordinary member reaches `comment` through P3-T01's workspace binding.
 */
export const ask = defineWriteAction({
  name: "copilot.ask",
  summary:
    "Records a question for the copilot, starting a conversation if this is the first one.",
  input: z.object({
    /** Omit to start a new conversation. */
    threadId: z.uuid().optional(),
    /** What the conversation is anchored to. Ignored when continuing a thread. */
    subjectType: z.string().trim().min(1).max(40).optional(),
    subjectId: z.uuid().optional(),
    question: z.string().trim().min(1).max(4000),
  }),
  output: z.object({
    threadId: z.uuid(),
    messageId: z.uuid(),
  }),
  access: ACCESS_LEVELS.comment,
  operation: (_context, input) => ({
    requires: ACCESS_LEVELS.comment,
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }
      // Half an anchor is a thread nothing can resolve, and the table's own
      // check constraint refuses it. Refused here so the message names the
      // input rather than the constraint.
      if (
        (input.subjectType === undefined) !==
        (input.subjectId === undefined)
      ) {
        throw new OperationError(
          "forbidden",
          "An anchored conversation needs both a subject type and a subject id.",
        );
      }

      let threadId = input.threadId;
      if (threadId) {
        await ownThread(tx, workspaceId, memberId, threadId);
        // The thread moves to the top of the member's list on every turn.
        await tx
          .update(aiThreads)
          .set({ updatedAt: new Date() })
          .where(
            activeOnly(
              aiThreads,
              eq(aiThreads.workspaceId, workspaceId),
              eq(aiThreads.id, threadId),
            ),
          );
      } else {
        const [created] = await tx
          .insert(aiThreads)
          .values({
            workspaceId,
            memberId,
            subjectType: input.subjectType ?? null,
            subjectId: input.subjectId ?? null,
            // The question, shortened. A model could write a better title and
            // this one is right with the provider off, which is the point.
            title: titleFrom(input.question),
          })
          .returning({ id: aiThreads.id });
        if (!created) {
          throw new OperationError("not_found", "That did not save.");
        }
        threadId = created.id;
      }

      const [message] = await tx
        .insert(aiMessages)
        .values({
          workspaceId,
          threadId,
          role: "member",
          content: input.question,
        })
        .returning({ id: aiMessages.id });
      if (!message) {
        throw new OperationError("not_found", "That did not save.");
      }

      return {
        result: { threadId, messageId: message.id },
        activity: {
          kind: "copilot.asked",
          subjectType: "workspace",
          subjectId: workspaceId,
          // Not embedded. A copilot thread is one member's conversation, and
          // indexing it would put their questions into everybody else's
          // retrieval results through the space they were asked about.
          //
          // The question itself is not on the payload either, for the same
          // reason: the activity feed is the workspace's, and "what did they
          // ask the copilot" is not the workspace's business.
          payload: { threadId },
        },
        audit: {
          action: "copilot.ask",
          targetType: "ai_thread",
          targetId: threadId,
          payload: { messageId: message.id },
        },
      };
    },
  }),
});

/**
 * Records the answer to the thread's last question.
 *
 * **Citations are stored as the answer's claim about what it used**, filtered
 * against the reader's access every time the thread is read. Anything outside
 * the embeddable set is dropped here rather than stored: a type the citation
 * resolver cannot label is a citation nothing can ever show.
 */
export const recordAnswer = defineWriteAction({
  name: "copilot.recordAnswer",
  summary:
    "Records the copilot's answer to the last question in a conversation.",
  input: z.object({
    threadId: z.uuid(),
    text: z.string().trim().min(1).max(20000),
    citations: z.array(citationSchema).max(50).default([]),
    model: z.string().trim().min(1).max(120).optional(),
    tokensIn: z.number().int().min(0).optional(),
    tokensOut: z.number().int().min(0).optional(),
    /** What the turn cost. Omitted when the model has no price on record. */
    cost: z.number().min(0).optional(),
    /** True when a reader stopped the stream before it finished. */
    stopped: z.boolean().default(false),
  }),
  output: z.object({ messageId: z.uuid() }),
  access: ACCESS_LEVELS.comment,
  operation: (_context, input) => ({
    requires: ACCESS_LEVELS.comment,
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }
      await ownThread(tx, workspaceId, memberId, input.threadId);

      const [last] = await tx
        .select({ role: aiMessages.role })
        .from(aiMessages)
        .where(
          activeOnly(
            aiMessages,
            eq(aiMessages.workspaceId, workspaceId),
            eq(aiMessages.threadId, input.threadId),
          ),
        )
        .orderBy(desc(aiMessages.createdAt), desc(aiMessages.id))
        .limit(1);
      // One answer per question. A retry that lost its first response would
      // otherwise leave two answers to one question and no way to tell which
      // the reader saw.
      if (!last || last.role !== "member") {
        throw new OperationError(
          "forbidden",
          "There is no unanswered question in this conversation.",
        );
      }

      const citations: AiCitation[] = input.citations.filter((citation) =>
        isEmbeddableType(citation.entityType),
      );

      const [message] = await tx
        .insert(aiMessages)
        .values({
          workspaceId,
          threadId: input.threadId,
          role: "assistant",
          content: input.text,
          citations,
          model: input.model ?? null,
          tokensIn: input.tokensIn ?? null,
          tokensOut: input.tokensOut ?? null,
          cost: input.cost === undefined ? null : String(input.cost),
          stoppedAt: input.stopped ? new Date() : null,
        })
        .returning({ id: aiMessages.id });
      if (!message) {
        throw new OperationError("not_found", "That did not save.");
      }

      await tx
        .update(aiThreads)
        .set({ updatedAt: new Date() })
        .where(
          activeOnly(
            aiThreads,
            eq(aiThreads.workspaceId, workspaceId),
            eq(aiThreads.id, input.threadId),
          ),
        );

      return {
        result: { messageId: message.id },
        activity: {
          kind: "copilot.answered",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { threadId: input.threadId, stopped: input.stopped },
        },
        audit: {
          action: "copilot.recordAnswer",
          targetType: "ai_message",
          targetId: message.id,
          // The cost of the turn, which is what an auditor asks about. Not the
          // answer's words.
          payload: {
            threadId: input.threadId,
            model: input.model ?? null,
            tokensIn: input.tokensIn ?? null,
            tokensOut: input.tokensOut ?? null,
            cost: input.cost ?? null,
            citations: citations.length,
            stopped: input.stopped,
          },
        },
      };
    },
  }),
});

const messageOutput = z.object({
  id: z.uuid(),
  role: z.enum(["member", "assistant"]),
  content: z.string(),
  /** Only the citations this reader may read, in the answer's own order. */
  citations: z.array(
    z.object({
      entityType: z.string(),
      entityId: z.uuid(),
      label: z.string(),
    }),
  ),
  model: z.string().nullable(),
  tokensIn: z.number().int().nullable(),
  tokensOut: z.number().int().nullable(),
  /** What the turn cost, as a decimal string so no precision is lost. */
  cost: z.string().nullable(),
  /** Set when the reader stopped this answer before it finished. */
  stopped: z.boolean(),
  createdAt: z.string(),
});

/** One conversation, with its citations resolved against the reader's access now. */
export const readThread = defineReadAction({
  name: "copilot.thread",
  summary: "One copilot conversation, with the citations this reader may see.",
  input: z.object({ threadId: z.uuid() }),
  output: z.object({
    id: z.uuid(),
    subjectType: z.string().nullable(),
    subjectId: z.uuid().nullable(),
    title: z.string().nullable(),
    messages: z.array(messageOutput),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const userId = context.actor.userId;
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId: userId ?? "" },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        const thread = await ownThread(
          tx,
          context.workspaceId,
          memberId,
          input.threadId,
        );

        const rows = await tx
          .select({
            id: aiMessages.id,
            role: aiMessages.role,
            content: aiMessages.content,
            citations: aiMessages.citations,
            model: aiMessages.model,
            tokensIn: aiMessages.tokensIn,
            tokensOut: aiMessages.tokensOut,
            cost: aiMessages.cost,
            stoppedAt: aiMessages.stoppedAt,
            createdAt: aiMessages.createdAt,
          })
          .from(aiMessages)
          .where(
            activeOnly(
              aiMessages,
              eq(aiMessages.workspaceId, context.workspaceId),
              eq(aiMessages.threadId, input.threadId),
            ),
          )
          .orderBy(aiMessages.createdAt, aiMessages.id);

        const messages = [];
        for (const row of rows) {
          messages.push({
            id: row.id,
            role: row.role,
            content: row.content,
            citations: await readableCitations(tx, {
              workspaceId: context.workspaceId,
              memberId,
              citations: row.citations,
            }),
            model: row.model,
            tokensIn: row.tokensIn,
            tokensOut: row.tokensOut,
            cost: row.cost,
            stopped: row.stoppedAt !== null,
            createdAt: row.createdAt.toISOString(),
          });
        }

        return {
          id: thread.id,
          subjectType: thread.subjectType,
          subjectId: thread.subjectId,
          title: thread.title,
          messages,
        };
      },
    );
  },
});

/** The reader's own conversations, most recently used first. */
export const readThreads = defineReadAction({
  name: "copilot.threads",
  summary: "The reader's own copilot conversations, most recent first.",
  input: z.object({
    subjectType: z.string().trim().min(1).max(40).optional(),
    subjectId: z.uuid().optional(),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  output: z.array(
    z.object({
      id: z.uuid(),
      subjectType: z.string().nullable(),
      subjectId: z.uuid().nullable(),
      title: z.string().nullable(),
      updatedAt: z.string(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const userId = context.actor.userId;
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId: userId ?? "" },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        const rows = await tx
          .select({
            id: aiThreads.id,
            subjectType: aiThreads.subjectType,
            subjectId: aiThreads.subjectId,
            title: aiThreads.title,
            updatedAt: aiThreads.updatedAt,
          })
          .from(aiThreads)
          .where(
            activeOnly(
              aiThreads,
              eq(aiThreads.workspaceId, context.workspaceId),
              eq(aiThreads.memberId, memberId),
              ...(input.subjectId
                ? [eq(aiThreads.subjectId, input.subjectId)]
                : []),
              ...(input.subjectType
                ? [eq(aiThreads.subjectType, input.subjectType)]
                : []),
            ),
          )
          .orderBy(desc(aiThreads.updatedAt), desc(aiThreads.id))
          .limit(input.limit);

        return rows.map((row) => ({
          id: row.id,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          title: row.title,
          updatedAt: row.updatedAt.toISOString(),
        }));
      },
    );
  },
});

/**
 * Whether the copilot can answer at all, and in plain words why not.
 *
 * The surface asks this before it offers a box to type in, so an AI-off
 * workspace explains itself instead of accepting a question and then saying
 * nothing. Three separate reasons, because they are three separate fixes:
 * no provider is wired at all, an admin turned the feature off, or the workspace
 * has spent its budget.
 */
export const readAvailability = defineReadAction({
  name: "copilot.availability",
  summary: "Whether the copilot can answer, and why not when it cannot.",
  input: z.object({}),
  output: z.object({
    /** True only when a question asked now would get prose back. */
    available: z.boolean(),
    /** True when the deployment has no answering provider wired at all. */
    providerConfigured: z.boolean(),
    /** Null when available. Shown to the reader as it is. */
    reason: z.string().nullable(),
    /**
     * True when retrieval can still find sources without a provider, which is
     * §2.4's own degradation and is worth offering on its own.
     */
    searchAvailable: z.boolean(),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const providerConfigured = Boolean(context.drafter?.answerGrounded);
    if (!providerConfigured) {
      return {
        available: false,
        providerConfigured: false,
        reason:
          "No AI provider is configured, so the copilot can find sources but cannot write an answer.",
        // Full-text retrieval needs no provider at all (P4-T13b).
        searchAvailable: true,
      };
    }

    const memberId = await askingMemberId(context);

    const availability = await checkFeatureAvailability(context.pool, {
      workspaceId: context.workspaceId,
      featureKey: COPILOT_FEATURE_KEY,
      defaultTier: COPILOT_DEFAULT_TIER,
      memberId,
    });

    return {
      available: availability.available,
      providerConfigured: true,
      reason: availability.available ? null : (availability.reason ?? null),
      searchAvailable: true,
    };
  },
});
