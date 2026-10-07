/**
 * Drafts that wait for a person (METHOD.md §2.9, P9-T13-b-b).
 *
 * "A workspace may instead make new objectives start as drafts that their
 * owner publishes, or that their reviewer approves." Under either setting an
 * objective added mid-cycle is stored as `draft`; its owner publishes it, and
 * it goes live, or to `awaiting_approval` where its reviewer approves.
 *
 * **Who may is the policy's to say**, citing "New objectives mid-cycle start
 * as", so the list, the API and the command line refuse alike. Access is
 * asked first and separately: both need `edit` on the objective, which its
 * champion and its reviewer hold through their role bindings.
 *
 * **A waiting draft owes no check-in.** It is created without a due date, so
 * no reminder and no staleness sweep reaches it, and its rhythm starts from
 * the moment it goes live, as a reopened objective's does.
 */
import { activeOnly, goals, workspaceMembers } from "@openokr/db";
import { draftOnPublish } from "@openokr/method";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { stampFirstDue } from "../cadence/service.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow } from "../cycles/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { requirePolicy } from "../practice/policy.ts";
import { practiceFromRow } from "../practice/settings.ts";
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

/** The objective, read after access has been checked on it. */
async function waitingGoal(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  goalId: string,
) {
  await getAccessScoped(tx, {
    workspaceId,
    memberId,
    resourceType: "goal",
    resourceId: goalId,
    requires: ACCESS_LEVELS.edit,
  });
  const [goal] = await tx
    .select({
      title: goals.title,
      draftState: goals.draftState,
      championId: goals.championId,
      reviewerId: goals.reviewerId,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.id, goalId),
      ),
    )
    .limit(1);
  if (!goal) {
    throw new OperationError("not_found", "No such objective.");
  }
  return goal;
}

/** Moves the draft on, and starts its rhythm when it goes live. */
async function moveDraft(
  tx: OperationTx,
  workspaceId: string,
  goalId: string,
  next: "awaiting_approval" | null,
  thresholds: ReturnType<typeof resolveRhythm>["thresholds"],
): Promise<void> {
  const now = new Date();
  // openokr:allow-mutation: called only from the two actions below, inside
  // the Operation each opened, so the state, its activity, its audit row and
  // the due date commit together.
  await tx
    .update(goals)
    .set({ draftState: next, updatedAt: now })
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.id, goalId),
      ),
    );
  if (next === null) {
    await stampFirstDue(tx, workspaceId, goalId, thresholds, now);
  }
}

export const publishDraft = defineWriteAction({
  name: "goals.publishDraft",
  summary:
    "Publishes an objective that waits as a draft (METHOD.md §2.9). Its owner publishes it, and it goes live, or to its reviewer where the workspace asks the reviewer to approve.",
  input: z.object({ id: z.uuid() }),
  output: z.object({
    goal: treeGoal,
    /** True when it now waits for its reviewer rather than being live. */
    awaitingApproval: z.boolean(),
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
      const goal = await waitingGoal(tx, workspaceId, memberId, input.id);
      if (goal.draftState !== "draft") {
        throw new OperationError(
          "conflict",
          goal.draftState === "awaiting_approval"
            ? "This draft is already published and waits for its reviewer."
            : "This objective is not a draft, so there is nothing to publish.",
        );
      }
      await requirePolicy(
        tx,
        { workspaceId, bulk: context.bulk },
        {
          kind: "draft.publish",
          actorIsOwner: goal.championId === memberId,
          hasReviewer: goal.reviewerId !== null,
        },
      );

      const row = await readRhythmRow(tx, workspaceId);
      const awaitingApproval =
        draftOnPublish(practiceFromRow(row).practice) === "awaitingApproval";
      await moveDraft(
        tx,
        workspaceId,
        input.id,
        awaitingApproval ? "awaiting_approval" : null,
        resolveRhythm(row).thresholds,
      );

      return {
        result: {
          goal: await treeNode(tx, workspaceId, input.id),
          awaitingApproval,
        },
        activity: {
          kind: "goal.draft_published",
          subjectType: "goal",
          subjectId: input.id,
          payload: { title: goal.title, awaitingApproval },
        },
        audit: {
          action: "goals.publishDraft",
          targetType: "goal",
          targetId: input.id,
          payload: { awaitingApproval },
        },
      };
    },
  }),
});

export const approveDraft = defineWriteAction({
  name: "goals.approveDraft",
  summary:
    "Approves a published draft, which only its reviewer does (METHOD.md §2.9). It goes live, and its check-in rhythm starts.",
  input: z.object({ id: z.uuid() }),
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
      const goal = await waitingGoal(tx, workspaceId, memberId, input.id);
      if (goal.draftState !== "awaiting_approval") {
        throw new OperationError(
          "conflict",
          goal.draftState === "draft"
            ? "Its owner has not published this draft yet, so there is nothing to approve."
            : "This objective does not wait for approval.",
        );
      }
      await requirePolicy(
        tx,
        { workspaceId, bulk: context.bulk },
        {
          kind: "draft.approve",
          actorIsReviewer: goal.reviewerId === memberId,
        },
      );

      await moveDraft(
        tx,
        workspaceId,
        input.id,
        null,
        resolveRhythm(await readRhythmRow(tx, workspaceId)).thresholds,
      );

      return {
        result: { goal: await treeNode(tx, workspaceId, input.id) },
        activity: {
          kind: "goal.draft_approved",
          subjectType: "goal",
          subjectId: input.id,
          payload: { title: goal.title },
        },
        audit: {
          action: "goals.approveDraft",
          targetType: "goal",
          targetId: input.id,
          payload: {},
        },
      };
    },
  }),
});
