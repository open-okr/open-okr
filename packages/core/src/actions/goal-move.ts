/**
 * Moving an objective to another space (METHOD.md §2.9, P9-T13a, NW-Q3-07).
 *
 * "A team that merges, splits or is renamed takes its OKRs with it. An
 * objective can move to another space at any time: its key results,
 * check-ins, dependencies and alignment move with it, and the move is
 * recorded as a dated change." Before this, `goals.update` changed the level
 * and never the space, so a reorganisation stranded its objectives.
 *
 * **What moves is one column.** Key results, check-ins, dependencies and the
 * parent pointer all hang from the goal, and every space-scoped read finds a
 * goal through `goals.space_id`, the agents' sight included, so they read
 * from the new space the moment it changes. What has to follow is what is
 * computed per space: OBJ-5's count in both units, and the alignment score of
 * both spaces.
 *
 * **Edit on both spaces**, asked of the access model before anything is
 * written: a member who may change the objective but not add to the space it
 * is going to cannot move it there. A space member holds edit on their space;
 * an admin or an owner holds it on every one.
 *
 * **A company objective can be placed in a space** (P9-T22c-e-a, NW-Q4-01):
 * a modified objective carried as a draft can belong to the team that will
 * run it next, as C2 becomes Customer Success's CS3. It needs edit on the
 * objective and on the space; who may see or edit it does not change, because
 * neither depends on the space since P8-G13c. A person's objective stays
 * theirs.
 */
import { activeOnly, goals, spaces, workspaceMembers } from "@openokr/db";
import { eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { recomputeUnitQualityInTx } from "../quality/service.ts";
import { recomputeAlignmentFor } from "./alignment.ts";
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

/** A space's name, after `edit` on it has been asked for. */
async function editableSpace(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  spaceId: string,
): Promise<string> {
  await getAccessScoped(tx, {
    workspaceId,
    memberId,
    resourceType: "space",
    resourceId: spaceId,
    requires: ACCESS_LEVELS.edit,
  });
  const [space] = await tx
    .select({ name: spaces.name })
    // openokr:allow-raw-read: the access-aware getter above has just granted
    // edit on this very space; this reads its name for the activity.
    .from(spaces)
    .where(
      activeOnly(
        spaces,
        eq(spaces.workspaceId, workspaceId),
        eq(spaces.id, spaceId),
      ),
    )
    .limit(1);
  if (!space) {
    throw new OperationError("not_found", "No such space.");
  }
  return space.name;
}

export const moveGoalToSpace = defineWriteAction({
  name: "goals.moveToSpace",
  // openokr:policy-exempt: moving an objective between spaces changes one that exists, which stays open under every setting (METHOD.md §2.9); edit on both spaces is the access model's to ask, and it is asked.
  summary:
    "Moves an objective to another space, with its key results, check-ins, dependencies and alignment (METHOD.md §2.9). Needs edit on both spaces.",
  input: z.object({ id: z.uuid(), spaceId: z.uuid() }),
  output: z.object({ goal: treeGoal }),
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
        .select({
          title: goals.title,
          ownerKind: goals.ownerKind,
          spaceId: goals.spaceId,
          cycleId: goals.cycleId,
          level: goals.level,
          closedAt: goals.closedAt,
        })
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
      const company = goal.ownerKind === "workspace";
      if (!company && (goal.ownerKind !== "space" || goal.spaceId === null)) {
        throw new OperationError(
          "forbidden",
          "Only an objective a space or the company owns moves into a space. This one belongs to a person.",
        );
      }
      if (goal.spaceId === input.spaceId) {
        throw new OperationError(
          "conflict",
          "This objective is already in that space.",
        );
      }
      const fromName =
        goal.spaceId === null
          ? "the company"
          : await editableSpace(tx, workspaceId, memberId, goal.spaceId);
      const toName = await editableSpace(
        tx,
        workspaceId,
        memberId,
        input.spaceId,
      );

      // openokr:allow-mutation: the Operation's own transaction, so the move,
      // its activity, its audit row and the recomputes commit together.
      await tx
        .update(goals)
        .set({
          ownerKind: "space",
          spaceId: input.spaceId,
          updatedAt: new Date(),
        })
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            eq(goals.id, input.id),
          ),
        );

      // OBJ-5 counts the objectives in a unit, and the unit is the space, so
      // both the one it joined and the one it left are judged again.
      await recomputeUnitQualityInTx(tx, { workspaceId, goalId: input.id });
      const [left] = await tx
        .select({ id: goals.id })
        .from(goals)
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            goal.spaceId === null
              ? isNull(goals.spaceId)
              : eq(goals.spaceId, goal.spaceId),
            eq(goals.ownerKind, goal.ownerKind),
            eq(goals.level, goal.level),
            isNull(goals.closedAt),
            ne(goals.id, input.id),
          ),
        )
        .orderBy(goals.id)
        .limit(1);
      if (left) {
        await recomputeUnitQualityInTx(tx, { workspaceId, goalId: left.id });
      }
      // The alignment score is per space, so both pictures change.
      await recomputeAlignmentFor(tx, workspaceId, [
        { cycleId: goal.cycleId, spaceId: goal.spaceId },
        { cycleId: goal.cycleId, spaceId: input.spaceId },
      ]);

      const payload = {
        title: goal.title,
        fromSpaceId: goal.spaceId,
        fromSpace: fromName,
        toSpaceId: input.spaceId,
        toSpace: toName,
      };
      return {
        result: { goal: await treeNode(tx, workspaceId, input.id) },
        activity: {
          kind: "goal.moved_space",
          subjectType: "goal",
          subjectId: input.id,
          payload,
          notify: true,
        },
        audit: {
          action: "goals.moveToSpace",
          targetType: "goal",
          targetId: input.id,
          payload,
        },
      };
    },
  }),
});
