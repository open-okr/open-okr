/**
 * Changing the kind of promise an objective makes (METHOD.md §2.8,
 * P9-T11b-a).
 *
 * **Committed or aspirational, changeable until the close, and visibly.** The
 * change is an activity row carrying both kinds and the reason, because the
 * close reads what an objective was promised as and when that changed, and an
 * objective quietly re-labelled aspirational the week before scoring is the
 * miss nobody explains. A reason is asked for and not required: the method
 * says the change is visible, not that it needs permission.
 *
 * **A kind the workspace has turned off is refused** through the one policy,
 * citing "OKR kinds", the same way from every surface. A closed objective
 * keeps the kind it was closed as.
 */
import { activeOnly, GOAL_KINDS, goals, workspaceMembers } from "@openokr/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { requirePolicy } from "../practice/policy.ts";
import { recomputeGoalQualityInTx } from "../quality/service.ts";
import { defineWriteAction } from "./define.ts";
import { treeGoal, treeNode } from "./goal-tree.ts";

/** Resolves the acting member, refusing the way every other read does. */
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

export const setGoalKind = defineWriteAction({
  name: "goals.setKind",
  summary:
    "Marks an objective committed or aspirational (METHOD.md §2.8), recording the change and its reason in the objective's activity.",
  input: z.object({
    id: z.uuid(),
    kind: z.enum(GOAL_KINDS),
    /** Why the promise changed. Asked for, never required. */
    reason: z.string().trim().min(1).max(500).optional(),
  }),
  output: z.object({
    goal: treeGoal,
    /** False when the objective was already this kind. */
    changed: z.boolean(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    subject: { type: "goal", id: input.id },
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "goal",
        resourceId: input.id,
        requires: ACCESS_LEVELS.edit,
      });
      const [goal] = await tx
        .select({ kind: goals.kind, closedAt: goals.closedAt })
        .from(goals)
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            eq(goals.id, input.id),
          ),
        )
        .limit(1);
      if (!goal) {
        throw new OperationError("not_found", "No such objective.");
      }
      if (goal.closedAt !== null) {
        throw new OperationError(
          "forbidden",
          "A closed objective keeps the kind it was closed as. Reopen it to change what it promises.",
        );
      }
      await requirePolicy(
        tx,
        { workspaceId, bulk: context.bulk },
        { kind: "objective.kind", okrKind: input.kind },
      );

      const changed = goal.kind !== input.kind;
      if (changed) {
        await tx
          .update(goals)
          .set({ kind: input.kind, updatedAt: new Date() })
          .where(
            activeOnly(
              goals,
              eq(goals.workspaceId, workspaceId),
              eq(goals.id, input.id),
            ),
          );
        // KR-6 judges only the aspirational key results, so the stored
        // verdict moves with the kind.
        await recomputeGoalQualityInTx(tx, { workspaceId, goalId: input.id });
      }

      const payload = {
        from: goal.kind,
        to: input.kind,
        reason: input.reason ?? null,
      };
      return {
        result: {
          goal: await treeNode(tx, workspaceId, input.id),
          changed,
        },
        activity: {
          kind: "goal.kind_changed",
          subjectType: "goal",
          subjectId: input.id,
          payload,
        },
        audit: {
          action: "goals.setKind",
          targetType: "goal",
          targetId: input.id,
          payload,
        },
      };
    },
  }),
});
