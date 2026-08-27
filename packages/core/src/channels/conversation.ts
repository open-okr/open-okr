/**
 * A chat command collected across turns (design §8, P5-T06b).
 *
 * Slack and Teams have modals. WhatsApp and Telegram do not, so a check-in is
 * three or four questions in a row, and the state between them is a row in the
 * database rather than anything in a process: either process can restart
 * between two messages, and a deploy must not lose somebody's half-finished
 * check-in.
 *
 * **Nothing partial is ever stored as a check-in.** The answers live in
 * `channel_conversations.collected`, which nothing else in the product reads.
 * The registry action runs once, when every required field is in, in one
 * transaction. A draft check-in somebody did not know they had created is worse
 * than starting again, and §8.1 says so.
 *
 * **The order of the questions is METHOD.md §3.2's order**, which is the
 * browser composer's order: status, then confidence, then one line of
 * narrative, then each key result's value. A member who answers the first two
 * and stops has told the product what it most needs.
 */
import {
  activeOnly,
  CHECK_IN_STATUSES,
  channelConversations,
  keyResults,
  type WorkspaceTx,
  withWorkspace,
} from "@openokr/db";
import { and, asc, eq, gt } from "drizzle-orm";
import type { ChannelConnectionKey } from "./capabilities.ts";

/** One question, and how to read its answer. */
export interface ConversationField {
  readonly name: string;
  /** What the member is asked, in words. */
  readonly question: string;
  /**
   * Reads one reply, or says why it is not an answer.
   *
   * A reply that does not parse ends the conversation rather than asking
   * again: §8.1's rule is that anything which is not an answer abandons it,
   * and a machine that kept re-asking would trap somebody in a loop they did
   * not start.
   */
  readonly parse: (
    reply: string,
  ) => { ok: true; value: unknown } | { ok: false };
}

const statusField: ConversationField = {
  name: "status",
  question: `How is it going? Answer one of: ${CHECK_IN_STATUSES.join(", ")}.`,
  parse: (reply) => {
    const value = reply
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    return (CHECK_IN_STATUSES as readonly string[]).includes(value)
      ? { ok: true, value }
      : { ok: false };
  },
};

const confidenceField: ConversationField = {
  name: "confidence",
  question:
    "How confident are you it lands, from 0 to 10? A number on its own.",
  parse: (reply) => {
    const number = Number(reply.trim());
    if (!Number.isFinite(number) || number < 0 || number > 10) {
      return { ok: false };
    }
    // The action takes 0 to 1, and a person says 0 to 10. Converted here,
    // once, rather than asking somebody to type 0.7.
    return { ok: true, value: number / 10 };
  },
};

const narrativeField: ConversationField = {
  name: "narrative",
  question: "One line on why. Anything you would say out loud.",
  parse: (reply) => {
    const text = reply.trim();
    return text === "" ? { ok: false } : { ok: true, value: text };
  },
};

/** A key result's new value. One field per key result, asked last. */
const valueField = (
  keyResultId: string,
  title: string,
  unit: string | null,
): ConversationField => ({
  name: `value:${keyResultId}`,
  question: `What is "${title}" at now${unit ? ` (${unit})` : ""}? A number, or "skip".`,
  parse: (reply) => {
    const text = reply.trim().toLowerCase();
    if (text === "skip" || text === "-") {
      // Skipping is an answer. §3.2 asks for the values last precisely because
      // a member who cannot look one up should still be able to finish.
      return { ok: true, value: null };
    }
    const number = Number(text.replace(/[, ]/g, ""));
    return Number.isFinite(number)
      ? { ok: true, value: number }
      : { ok: false };
  },
});

/**
 * The questions a check-in asks, for one goal.
 *
 * Computed when the conversation starts rather than declared, because the
 * number of questions depends on how many key results the goal has.
 */
export async function checkInFields(
  tx: WorkspaceTx,
  input: { readonly workspaceId: string; readonly goalId: string },
): Promise<readonly ConversationField[]> {
  const rows = await tx
    .select({
      id: keyResults.id,
      title: keyResults.title,
      unit: keyResults.unit,
    })
    .from(keyResults)
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, input.workspaceId),
        eq(keyResults.goalId, input.goalId),
      ),
    )
    .orderBy(asc(keyResults.createdAt));

  return [
    statusField,
    confidenceField,
    narrativeField,
    ...rows.map((row) => valueField(row.id, row.title, row.unit)),
  ];
}

export interface Conversation {
  readonly id: string;
  readonly command: string;
  readonly subjectId: string | null;
  readonly collected: Record<string, unknown>;
  readonly awaiting: string;
}

/** The live conversation for this member and provider, or null. */
export async function findConversation(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly provider: ChannelConnectionKey;
    readonly now: Date;
  },
): Promise<Conversation | null> {
  const [row] = await tx
    .select({
      id: channelConversations.id,
      command: channelConversations.command,
      subjectId: channelConversations.subjectId,
      collected: channelConversations.collected,
      awaiting: channelConversations.awaiting,
    })
    .from(channelConversations)
    .where(
      and(
        eq(channelConversations.workspaceId, input.workspaceId),
        eq(channelConversations.memberId, input.memberId),
        eq(channelConversations.provider, input.provider),
        // An expired row is not a conversation. It is left to be replaced by
        // the next `start`, which is cheaper than a sweep and means an
        // abandoned conversation costs one row rather than a job.
        gt(channelConversations.expiresAt, input.now),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }
  return {
    id: row.id,
    command: row.command,
    subjectId: row.subjectId,
    collected: (row.collected ?? {}) as Record<string, unknown>,
    awaiting: row.awaiting,
  };
}

/**
 * Starts one, replacing whatever was there.
 *
 * A second live conversation would make "the next message continues it"
 * ambiguous, and the product cannot ask which of two half-finished check-ins
 * somebody meant. The unique index enforces that; this is the upsert that
 * respects it.
 */
export async function startConversation(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly provider: ChannelConnectionKey;
    readonly command: string;
    readonly subjectId: string | null;
    readonly awaiting: string;
    readonly now: Date;
    readonly minutes: number;
    readonly threadId?: string;
  },
): Promise<void> {
  // openokr:allow-mutation: runs on the transaction the calling Operation
  // opened. A conversation is not domain state: nothing reads it but the state
  // machine, and it holds no answer anybody has committed to.
  await tx
    .delete(channelConversations)
    .where(
      and(
        eq(channelConversations.workspaceId, input.workspaceId),
        eq(channelConversations.memberId, input.memberId),
        eq(channelConversations.provider, input.provider),
      ),
    );

  // openokr:allow-mutation: same reason as the delete above.
  await tx.insert(channelConversations).values({
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    provider: input.provider,
    command: input.command,
    subjectId: input.subjectId,
    collected: {},
    awaiting: input.awaiting,
    expiresAt: new Date(input.now.getTime() + input.minutes * 60_000),
    ...(input.threadId ? { externalThreadId: input.threadId } : {}),
  });
}

/** Records one answer and moves to the next question. */
export async function advanceConversation(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly id: string;
    readonly collected: Record<string, unknown>;
    readonly awaiting: string;
    readonly now: Date;
    readonly minutes: number;
  },
): Promise<void> {
  // openokr:allow-mutation: the calling Operation's own transaction, on a row
  // that is not domain state.
  await tx
    .update(channelConversations)
    .set({
      collected: input.collected,
      awaiting: input.awaiting,
      // The clock restarts on every answer. Thirty minutes is per question,
      // not per conversation: somebody answering slowly is still answering.
      expiresAt: new Date(input.now.getTime() + input.minutes * 60_000),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(channelConversations.workspaceId, input.workspaceId),
        eq(channelConversations.id, input.id),
      ),
    );
}

/**
 * Ends one, writing nothing.
 *
 * Called when it completes and when it is abandoned, because those differ in
 * what happened before, not in what is left behind. §8.1: nothing partial is
 * ever stored.
 */
export async function endConversation(
  tx: WorkspaceTx,
  input: { readonly workspaceId: string; readonly id: string },
): Promise<void> {
  // openokr:allow-mutation: the calling Operation's own transaction, on a row
  // that is not domain state.
  await tx
    .delete(channelConversations)
    .where(
      and(
        eq(channelConversations.workspaceId, input.workspaceId),
        eq(channelConversations.id, input.id),
      ),
    );
}
