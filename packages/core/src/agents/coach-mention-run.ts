/**
 * Delivering a mention of the Coach (plan 0.7.0 A8).
 *
 * The relay calls this for `agents.coach.mentioned`. It finds the workspace's
 * Coach and calls `agents.answerMention` as that agent, so the review reads
 * through the Coach's bindings and the audit row names it.
 *
 * Kept apart from `coach-mention.ts` because this one imports the action
 * registry, and the comment actions, which the registry imports, need the
 * other half.
 *
 * **A refusal is a skip, not a failure.** The Coach turned off or in sandbox,
 * a goal it cannot see, a comment deleted or already answered: none changes by
 * being retried, and each is the arrangement working. The relay records the
 * reason in its log, and nothing is written in the workspace, so a goal the
 * Coach cannot see is never named to anybody.
 */
import { withWorkspace } from "@openokr/db";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { callAction } from "../actions/registry.ts";
import { OperationError } from "../operations/operation.ts";
import { coachInTx } from "./coach.ts";
import type { CoachMentionJob } from "./coach-mention.ts";

export type CoachMentionOutcome =
  | { readonly kind: "answered"; readonly commentId: string }
  | { readonly kind: "skipped"; readonly reason: string };

export async function runCoachMention(
  deps: {
    readonly pool: Pool;
    readonly baseUrl?: string;
    readonly instanceName?: string;
  },
  job: CoachMentionJob,
): Promise<CoachMentionOutcome> {
  const coach = await withWorkspace(drizzle(deps.pool), job.workspaceId, (tx) =>
    coachInTx(tx, job.workspaceId),
  );
  if (!coach) {
    return { kind: "skipped", reason: "this workspace has no Coach" };
  }
  try {
    const answered = await callAction(
      {
        pool: deps.pool,
        workspaceId: job.workspaceId,
        actor: { kind: "agent", memberId: coach.memberId },
        ...(deps.baseUrl ? { baseUrl: deps.baseUrl } : {}),
        ...(deps.instanceName ? { instanceName: deps.instanceName } : {}),
      },
      "agents.answerMention",
      { commentId: job.commentId, goalId: job.goalId, spaceId: job.spaceId },
    );
    return { kind: "answered", commentId: answered.commentId };
  } catch (error) {
    if (error instanceof OperationError) {
      return { kind: "skipped", reason: error.message };
    }
    throw error;
  }
}
