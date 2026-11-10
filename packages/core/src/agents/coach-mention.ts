/**
 * A mention of the Coach on a goal, as an outbox row (plan 0.7.0 A8).
 *
 * The comment that mentions the Coach enqueues this in its own write
 * transaction, so the trigger commits with the comment or not at all, and the
 * relay delivers it after the commit (`coach-mention-run.ts`). The review is
 * never run inside somebody else's comment write: it reads as the Coach, and
 * that is a different principal from the person typing.
 *
 * Identifiers only on the row, like every other topic.
 */
import {
  activeOnly,
  goals,
  newId,
  type OutboxMessage,
  type WorkspaceTx,
} from "@openokr/db";
import { and, eq } from "drizzle-orm";
import { coachInTx } from "./coach.ts";

export const COACH_MENTION_TOPIC = "agents.coach.mentioned";

/** What one row carries. */
export interface CoachMentionJob {
  readonly workspaceId: string;
  /** The comment that mentioned the Coach, which the reply answers. */
  readonly commentId: string;
  /** The goal the comment is on. */
  readonly goalId: string;
  /**
   * The goal's space, or null for a goal in none. Read here, in the
   * commenter's transaction, because the Coach's floor is measured on it: the
   * Coach is bound to spaces, and a goal in one is reached through it.
   */
  readonly spaceId: string | null;
}

/**
 * The outbox row a comment owes the Coach, or none.
 *
 * Only a comment on a goal: §6.5 names the goal, and a key result, a check-in
 * or a task has no review of its own to give. Only one that mentions the
 * workspace's own Coach, and never one the Coach wrote, so its reply cannot
 * answer itself.
 *
 * `edited` is an edit that newly mentions the Coach. Its key carries a fresh
 * suffix, because the outbox refuses a second row under one key and the
 * comment's first row may already be there; the action refuses a second
 * answer to one comment, which is what keeps that safe.
 */
export async function coachMentionOutboxInTx(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly subjectType: string;
    readonly subjectId: string;
    readonly commentId: string;
    readonly authorMemberId: string;
    readonly mentionIds: readonly string[];
    readonly edited?: boolean;
  },
): Promise<readonly OutboxMessage[]> {
  if (input.subjectType !== "goal" || input.mentionIds.length === 0) {
    return [];
  }
  const coach = await coachInTx(tx, input.workspaceId);
  if (
    !coach ||
    coach.memberId === input.authorMemberId ||
    !input.mentionIds.includes(coach.memberId)
  ) {
    return [];
  }
  const [goal] = await tx
    .select({ spaceId: goals.spaceId })
    .from(goals)
    .where(
      activeOnly(
        goals,
        and(
          eq(goals.workspaceId, input.workspaceId),
          eq(goals.id, input.subjectId),
        ),
      ),
    )
    .limit(1);
  if (!goal) {
    return [];
  }
  const job: CoachMentionJob = {
    workspaceId: input.workspaceId,
    commentId: input.commentId,
    goalId: input.subjectId,
    spaceId: goal.spaceId,
  };
  return [
    {
      topic: COACH_MENTION_TOPIC,
      payload: { ...job },
      idempotencyKey: input.edited
        ? `${COACH_MENTION_TOPIC}:${input.commentId}:${newId()}`
        : `${COACH_MENTION_TOPIC}:${input.commentId}`,
    },
  ];
}

/** The row's payload as a job, or null when it is not one. */
export function parseCoachMentionJob(
  payload: Record<string, unknown>,
): CoachMentionJob | null {
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value : null;
  const workspaceId = text(payload.workspaceId);
  const commentId = text(payload.commentId);
  const goalId = text(payload.goalId);
  const spaceId = text(payload.spaceId);
  if (payload.spaceId !== null && spaceId === null) {
    return null;
  }
  return workspaceId && commentId && goalId
    ? { workspaceId, commentId, goalId, spaceId }
    : null;
}
