/**
 * The check-in, collected across turns (design §8, P5-T06b).
 *
 * The state machine in `conversation.ts` holds the answers. This decides what
 * to ask, reads the replies, and runs the two registry actions once every
 * required field is in.
 *
 * **Two transactions, and the boundary is deliberate.** The conversation row is
 * read and advanced in its own transaction; the check-in is written by
 * `goals.startCheckIn` and `goals.publishCheckIn` in theirs. That is what §8.1
 * asks for, "one registry action, one transaction", and the alternative would be
 * a conversation row inside the pipeline, which would make a chat interaction a
 * domain write. If the row fails to clear after a published check-in, the
 * conversation expires on its own and the next message starts a new one; the
 * check-in is already committed and correct.
 */
import { withWorkspace } from "@openokr/db";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { type ActionName, callAction } from "../actions/registry.ts";
import { OperationError } from "../operations/operation.ts";
import { richTextFromPlainText } from "../rich-text/from-text.ts";
import type { ChannelConnectionKey } from "./capabilities.ts";
import {
  advanceConversation,
  type Conversation,
  type ConversationField,
  checkInFields,
  endConversation,
  findConversation,
  startConversation,
} from "./conversation.ts";

/** The verb this flow answers to, in the command catalogue. */
export const CHECK_IN_COMMAND = "checkin";

export interface FlowRequest {
  readonly pool: Pool;
  readonly workspaceId: string;
  readonly provider: ChannelConnectionKey;
  readonly memberId: string;
  readonly userId: string;
  readonly now: Date;
  /** How long a half-finished conversation waits, from §4.14's setting. */
  readonly minutes: number;
  readonly threadId?: string;
}

export type FlowOutcome =
  /** Nothing was in progress and this was not a start. */
  | { readonly kind: "none" }
  /** A question to send back. */
  | { readonly kind: "asking"; readonly text: string }
  /** Abandoned, because the reply was not an answer or the goal is gone. */
  | { readonly kind: "abandoned"; readonly text: string }
  /** Published. */
  | { readonly kind: "done"; readonly text: string };

/**
 * Starts a check-in for one goal.
 *
 * The access check is the action's, not this file's: `goals.startCheckIn`
 * requires edit on the goal, so a member who may not check it in is refused
 * before a single question is asked. Asking three questions and then refusing
 * would waste somebody's time and teach them the product does not know its own
 * rules.
 */
export async function beginCheckIn(
  request: FlowRequest,
  goalId: string,
): Promise<FlowOutcome> {
  try {
    await callAction(
      {
        pool: request.pool,
        workspaceId: request.workspaceId,
        actor: { kind: "human", userId: request.userId },
        channel: request.provider,
      },
      "goals.startCheckIn" as ActionName,
      { goalId } as never,
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { kind: "abandoned", text: error.message };
    }
    throw error;
  }

  const db = drizzle(request.pool);
  const fields = await withWorkspace(db, request.workspaceId, (tx) =>
    checkInFields(tx, { workspaceId: request.workspaceId, goalId }),
  );
  const first = fields[0];
  if (!first) {
    return { kind: "abandoned", text: "That goal has nothing to check in." };
  }

  await withWorkspace(db, request.workspaceId, (tx) =>
    startConversation(tx, {
      workspaceId: request.workspaceId,
      memberId: request.memberId,
      provider: request.provider,
      command: CHECK_IN_COMMAND,
      subjectId: goalId,
      awaiting: first.name,
      now: request.now,
      minutes: request.minutes,
      ...(request.threadId ? { threadId: request.threadId } : {}),
    }),
  );

  return { kind: "asking", text: first.question };
}

/**
 * Reads one reply into whatever is in progress.
 *
 * Returns `none` when nothing is in progress, which is what tells the router to
 * treat the message as a command instead.
 */
export async function continueCheckIn(
  request: FlowRequest,
  reply: string,
): Promise<FlowOutcome> {
  const db = drizzle(request.pool);
  const conversation = await withWorkspace(db, request.workspaceId, (tx) =>
    findConversation(tx, {
      workspaceId: request.workspaceId,
      memberId: request.memberId,
      provider: request.provider,
      now: request.now,
    }),
  );
  if (!conversation || conversation.command !== CHECK_IN_COMMAND) {
    return { kind: "none" };
  }

  const goalId = conversation.subjectId;
  if (!goalId) {
    await withWorkspace(db, request.workspaceId, (tx) =>
      endConversation(tx, {
        workspaceId: request.workspaceId,
        id: conversation.id,
      }),
    );
    return { kind: "abandoned", text: "I lost track of which goal that was." };
  }

  const fields = await withWorkspace(db, request.workspaceId, (tx) =>
    checkInFields(tx, { workspaceId: request.workspaceId, goalId }),
  );
  const field = fields.find((entry) => entry.name === conversation.awaiting);
  if (!field) {
    // The goal's key results changed while somebody was answering. Starting
    // again is the honest answer: the questions are no longer the ones asked.
    await withWorkspace(db, request.workspaceId, (tx) =>
      endConversation(tx, {
        workspaceId: request.workspaceId,
        id: conversation.id,
      }),
    );
    return {
      kind: "abandoned",
      text: "That goal changed while we were talking. Start the check-in again.",
    };
  }

  const parsed = field.parse(reply);
  if (!parsed.ok) {
    // §8.1: anything that is not an answer ends it. Re-asking would trap
    // somebody in a loop they did not start, and nothing partial is stored.
    await withWorkspace(db, request.workspaceId, (tx) =>
      endConversation(tx, {
        workspaceId: request.workspaceId,
        id: conversation.id,
      }),
    );
    return {
      kind: "abandoned",
      text: [
        "That was not one of the answers, so I have stopped.",
        "Nothing was saved. Start the check-in again when you are ready.",
      ].join(" "),
    };
  }

  const collected = { ...conversation.collected, [field.name]: parsed.value };
  const next = nextField(fields, field.name);

  if (next) {
    await withWorkspace(db, request.workspaceId, (tx) =>
      advanceConversation(tx, {
        workspaceId: request.workspaceId,
        id: conversation.id,
        collected,
        awaiting: next.name,
        now: request.now,
        minutes: request.minutes,
      }),
    );
    return { kind: "asking", text: next.question };
  }

  return publish(request, conversation, goalId, collected);
}

function nextField(
  fields: readonly ConversationField[],
  after: string,
): ConversationField | undefined {
  const index = fields.findIndex((field) => field.name === after);
  return index < 0 ? undefined : fields[index + 1];
}

/**
 * Every field is in. One action, one transaction, and the row is cleared.
 *
 * `goals.startCheckIn` was already called when the conversation began, and it
 * reopens rather than duplicating, so re-reading the draft here would be a
 * second call for no gain: publishing needs the draft's id, which is what the
 * lookup below is for.
 */
async function publish(
  request: FlowRequest,
  conversation: Conversation,
  goalId: string,
  collected: Record<string, unknown>,
): Promise<FlowOutcome> {
  const db = drizzle(request.pool);
  const context = {
    pool: request.pool,
    workspaceId: request.workspaceId,
    actor: { kind: "human" as const, userId: request.userId },
    channel: request.provider,
  };

  const clear = () =>
    withWorkspace(db, request.workspaceId, (tx) =>
      endConversation(tx, {
        workspaceId: request.workspaceId,
        id: conversation.id,
      }),
    );

  try {
    // Reopens the same draft rather than creating a second one, which is what
    // makes calling it twice safe and why the id is read from here.
    const draft = (await callAction(
      context,
      "goals.startCheckIn" as ActionName,
      { goalId } as never,
    )) as { id: string };

    const values = Object.entries(collected)
      .filter(([name, value]) => name.startsWith("value:") && value !== null)
      .map(([name, value]) => ({
        keyResultId: name.slice("value:".length),
        value: value as number,
      }));

    await callAction(
      context,
      "goals.publishCheckIn" as ActionName,
      {
        id: draft.id,
        status: collected.status,
        confidence: collected.confidence,
        // One line, through the shared rich-text module rather than hand-built
        // JSON: rich text is editor JSON everywhere in this product, and a
        // second way of making one is a second thing that can be malformed.
        narrative: richTextFromPlainText(String(collected.narrative ?? "")),
        values,
      } as never,
    );
  } catch (error) {
    await clear();
    if (error instanceof OperationError) {
      return { kind: "abandoned", text: error.message };
    }
    return {
      kind: "abandoned",
      text: "Something went wrong on our side. Nothing was saved.",
    };
  }

  await clear();
  return {
    kind: "done",
    text: "Checked in. Your reviewer has been asked to acknowledge it.",
  };
}
