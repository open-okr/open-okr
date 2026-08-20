/**
 * Check-in actions (TECHNICAL-PLAN §4.4, §14, METHOD.md §7.2, P3-T07).
 *
 * Authorisation resolves through the goal that owns the check-in: a check-in is a
 * sub-resource, and §4.1 says sub-resources inherit. So there is no `check_in`
 * entry in the subject resolver, and every action here looks the goal up first.
 *
 * Two refusals are worth reading in full because they are rules, not validation.
 * Only the reviewer of record may acknowledge, and an administrator is refused
 * like anybody else: closing somebody else's loop is not an administrative
 * convenience, and an admin who wants it reassigns the reviewer first, which is
 * audited. And a vote stays private until the reveal, which is one write over the
 * whole set so no client can see half of it.
 */
import {
  activeOnly,
  CHECK_IN_STATUSES,
  checkInSnapshots,
  checkIns,
  checkInVotes,
  keyResults,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import {
  deleteCheckInInTx,
  editWindowOpen,
  publishCheckInInTx,
  startDraftInTx,
} from "../check-ins/service.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow } from "../cycles/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";
import { isValidRichText } from "../rich-text/validate.ts";
import { recomputeForGoal } from "../scoring/recompute.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const richText = z
  .unknown()
  .refine(
    (value) =>
      value === null || isValidRichText(value, RICH_TEXT_SCHEMA_VERSION),
    { message: "not valid editor JSON for the current rich text schema" },
  );

const composerValue = z.object({
  keyResultId: z.uuid(),
  value: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

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

/** The goal a check-in hangs off, and the level the actor holds on it. */
async function requireCheckInAccess(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  checkInId: string,
  requires: number,
): Promise<{ goalId: string }> {
  const [checkIn] = await tx
    .select({ subjectId: checkIns.subjectId })
    .from(checkIns)
    .where(
      activeOnly(
        checkIns,
        eq(checkIns.workspaceId, workspaceId),
        eq(checkIns.id, checkInId),
      ),
    )
    .limit(1);
  if (!checkIn) {
    throw new OperationError("not_found", "No such check-in.");
  }
  await getAccessScoped(tx, {
    workspaceId,
    memberId,
    resourceType: "goal",
    resourceId: checkIn.subjectId,
    requires: requires as never,
  });
  return { goalId: checkIn.subjectId };
}

async function requireGoalAccess(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  goalId: string,
  requires: number,
): Promise<void> {
  await getAccessScoped(tx, {
    workspaceId,
    memberId,
    resourceType: "goal",
    resourceId: goalId,
    requires: requires as never,
  });
}

export const startCheckIn = defineWriteAction({
  name: "goals.startCheckIn",
  summary:
    "Opens or reopens the author's draft check-in on a goal. Completely silent.",
  input: z.object({ goalId: z.uuid() }),
  output: z.object({ id: z.uuid(), reopened: z.boolean() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      await requireGoalAccess(
        tx,
        workspaceId,
        memberId,
        input.goalId,
        ACCESS_LEVELS.edit,
      );

      // One draft per author per goal, in `startDraftInTx` since P4-T05c-a
      // needed the same three lines to publish a proposed check-in.
      const draft = await startDraftInTx(tx, {
        workspaceId,
        goalId: input.goalId,
        authorMemberId: memberId,
      });

      return {
        result: { id: draft.checkInId, reopened: draft.reopened },
        // A draft emits nothing, so the activity row records the act of opening
        // the composer rather than anything about the goal. `test.*` is not an
        // option here: this is a real product event, just a quiet one.
        activity: {
          kind: "check_in.draft_opened",
          subjectType: "goal",
          subjectId: input.goalId,
          payload: { reopened: draft.reopened },
        },
        audit: {
          action: "goals.startCheckIn",
          targetType: "check_in",
          targetId: draft.checkInId,
          payload: { reopened: draft.reopened },
        },
      };
    },
  }),
});

/**
 * Publishes a check-in whose draft does not exist yet (P4-T05c-a).
 *
 * **Why this exists rather than reusing `goals.publishCheckIn`.** That action
 * takes a draft id, and the Champion cannot produce one: it holds `view` on its
 * spaces and nothing more, which is the least-privilege rule P4-T05a asserts
 * with a test. So a proposed check-in cannot be a draft the agent opened and a
 * publish the human confirms; it has to be one action, carrying the content,
 * that opens the draft and publishes it **as the applying member**.
 *
 * One action is also what §6.4's acceptance asks for in as many words: a drafted
 * check-in the champion can "review and publish in one action". A proposal row
 * holds exactly one action and one payload, so anything needing three calls
 * could not be proposed at all.
 *
 * The publication itself is `publishCheckInInTx`, the same function
 * `goals.publishCheckIn` calls. Nothing about the snapshot, the value history,
 * the cadence advance or the reviewer of record is re-implemented here: a second
 * publish path that forgot the reviewer stamp would leave the review inbox with
 * an obligation it could not attribute.
 */
export const publishDraftedCheckIn = defineWriteAction({
  name: "goals.publishDraftedCheckIn",
  summary:
    "Opens the author's draft check-in on a goal and publishes it in one action, for a proposal a human applies.",
  input: z.object({
    goalId: z.uuid(),
    status: z.enum(CHECK_IN_STATUSES),
    confidence: z.number().min(0).max(1),
    narrative: richText,
    values: z.array(composerValue).default([]),
  }),
  output: z.object({
    id: z.uuid(),
    goalId: z.uuid(),
    valuesWritten: z.number().int(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      // The goal's own access, checked before anything is written. A proposal
      // being applied is an ordinary write by the member who applied it, so it
      // earns no exemption: an applying member without `edit` is refused here
      // exactly as they would be in the composer.
      await requireGoalAccess(
        tx,
        workspaceId,
        memberId,
        input.goalId,
        ACCESS_LEVELS.edit,
      );

      const draft = await startDraftInTx(tx, {
        workspaceId,
        goalId: input.goalId,
        authorMemberId: memberId,
      });

      const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
      const now = new Date();
      const published = await publishCheckInInTx(tx, {
        workspaceId,
        checkInId: draft.checkInId,
        authorMemberId: memberId,
        status: input.status,
        confidence: input.confidence,
        narrative: input.narrative,
        values: input.values,
        thresholds: rhythm.thresholds,
        now,
      });

      await recomputeForGoal(
        tx,
        workspaceId,
        published.goalId,
        rhythm.thresholds,
        now,
      );

      return {
        result: {
          id: draft.checkInId,
          goalId: published.goalId,
          valuesWritten: published.valuesWritten,
        },
        // The same activity kind a composed check-in emits. A separate kind
        // would split one thing across two feeds and make the goal's history
        // depend on which surface posted it.
        activity: {
          kind: "check_in.published",
          subjectType: "goal",
          subjectId: published.goalId,
          payload: {
            status: input.status,
            valuesWritten: published.valuesWritten,
          },
        },
        audit: {
          action: "goals.publishDraftedCheckIn",
          targetType: "check_in",
          targetId: draft.checkInId,
          payload: { status: input.status, fromProposal: true },
        },
      };
    },
  }),
});

export const publishCheckIn = defineWriteAction({
  name: "goals.publishCheckIn",
  summary:
    "Publishes a check-in: snapshot, value history, cadence, and the reviewer's obligation.",
  input: z.object({
    id: z.uuid(),
    status: z.enum(CHECK_IN_STATUSES),
    confidence: z.number().min(0).max(1),
    narrative: richText,
    values: z.array(composerValue).default([]),
  }),
  output: z.object({
    id: z.uuid(),
    goalId: z.uuid(),
    valuesWritten: z.number().int(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      await requireCheckInAccess(
        tx,
        workspaceId,
        memberId,
        input.id,
        ACCESS_LEVELS.edit,
      );

      const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
      const now = new Date();
      const published = await publishCheckInInTx(tx, {
        workspaceId,
        checkInId: input.id,
        authorMemberId: memberId,
        status: input.status,
        confidence: input.confidence,
        narrative: input.narrative,
        values: input.values,
        thresholds: rhythm.thresholds,
        now,
      });

      // Health rule 3 now has a status to read, so the recompute after this is
      // what turns a published `caution` into the goal's own health.
      await recomputeForGoal(
        tx,
        workspaceId,
        published.goalId,
        rhythm.thresholds,
        now,
      );

      return {
        result: {
          id: input.id,
          goalId: published.goalId,
          valuesWritten: published.valuesWritten,
        },
        activity: {
          kind: "check_in.published",
          subjectType: "goal",
          subjectId: published.goalId,
          payload: {
            status: input.status,
            valuesWritten: published.valuesWritten,
          },
        },
        audit: {
          action: "goals.publishCheckIn",
          targetType: "check_in",
          targetId: input.id,
          payload: { status: input.status },
        },
      };
    },
  }),
});

export const editCheckIn = defineWriteAction({
  name: "goals.editCheckIn",
  summary:
    "Edits a published check-in inside its window, writing a new snapshot rather than rewriting the old one.",
  input: z.object({
    id: z.uuid(),
    status: z.enum(CHECK_IN_STATUSES).optional(),
    confidence: z.number().min(0).max(1).optional(),
    narrative: richText.optional(),
    values: z.array(composerValue).default([]),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const { goalId } = await requireCheckInAccess(
        tx,
        workspaceId,
        memberId,
        input.id,
        ACCESS_LEVELS.edit,
      );

      const now = new Date();
      const window = await editWindowOpen(tx, workspaceId, input.id, now);
      if (!window.open) {
        throw new OperationError(
          "forbidden",
          window.because ?? "This check-in can no longer be edited.",
        );
      }

      const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));

      // Re-publication over the same row: it re-snapshots, re-applies the values
      // and moves the cadence from the current due date, which is what §6.3 means
      // by an edit inside the window.
      await tx
        .update(checkIns)
        .set({ state: "draft", updatedAt: now })
        .where(activeOnly(checkIns, eq(checkIns.id, input.id)));

      const [current] = await tx
        .select({
          status: checkIns.status,
          confidence: checkIns.confidence,
          narrative: checkIns.narrative,
        })
        .from(checkIns)
        .where(activeOnly(checkIns, eq(checkIns.id, input.id)))
        .limit(1);

      const published = await publishCheckInInTx(tx, {
        workspaceId,
        checkInId: input.id,
        authorMemberId: memberId,
        status: input.status ?? (current?.status as never),
        confidence: input.confidence ?? Number(current?.confidence ?? 0),
        narrative: input.narrative ?? current?.narrative,
        values: input.values,
        thresholds: rhythm.thresholds,
        now,
      });

      await recomputeForGoal(
        tx,
        workspaceId,
        published.goalId,
        rhythm.thresholds,
        now,
      );

      return {
        result: { id: input.id },
        activity: {
          kind: "check_in.edited",
          subjectType: "goal",
          subjectId: goalId,
          payload: {},
        },
        audit: {
          action: "goals.editCheckIn",
          targetType: "check_in",
          targetId: input.id,
          payload: {},
        },
      };
    },
  }),
});

export const deleteCheckIn = defineWriteAction({
  name: "goals.deleteCheckIn",
  summary:
    "Deletes a check-in, rolling the goal's pointers and values back when it was the latest.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid(), rolledBack: z.boolean() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      await requireCheckInAccess(
        tx,
        workspaceId,
        memberId,
        input.id,
        ACCESS_LEVELS.edit,
      );

      const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
      const now = new Date();
      const result = await deleteCheckInInTx(
        tx,
        workspaceId,
        input.id,
        rhythm.thresholds,
        now,
      );
      await recomputeForGoal(
        tx,
        workspaceId,
        result.goalId,
        rhythm.thresholds,
        now,
      );

      return {
        result: { id: input.id, rolledBack: result.rolledBack },
        activity: {
          kind: "check_in.deleted",
          subjectType: "goal",
          subjectId: result.goalId,
          payload: { rolledBack: result.rolledBack },
        },
        audit: {
          action: "goals.deleteCheckIn",
          targetType: "check_in",
          targetId: input.id,
          payload: { rolledBack: result.rolledBack },
        },
      };
    },
  }),
});

export const acknowledgeCheckIn = defineWriteAction({
  name: "goals.acknowledgeCheckIn",
  summary: "The reviewer of record closes the loop. Nobody else can.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid(), alreadyAcknowledged: z.boolean() }),
  // Edit, because acknowledging is a write and §14 requires edit for every write.
  // That is why the reviewer holds edit on the goal they review rather than
  // comment: the alternative was an action that writes on view-level terms, and
  // the registry rule exists to stop exactly that.
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const { goalId } = await requireCheckInAccess(
        tx,
        workspaceId,
        memberId,
        input.id,
        ACCESS_LEVELS.edit,
      );

      const [checkIn] = await tx
        .select({
          state: checkIns.state,
          acknowledgedAt: checkIns.acknowledgedAt,
          reviewerMemberId: checkIns.reviewerMemberId,
        })
        .from(checkIns)
        .where(activeOnly(checkIns, eq(checkIns.id, input.id)))
        .limit(1);

      // §6.5, and an administrator is refused like anybody else. Closing
      // somebody else's loop is not an administrative convenience.
      //
      // The reviewer **of record** on the check-in, not `goals.reviewer_id`
      // (P3-T08). Those two agree while an obligation is open, because
      // reassignment moves both, and they part company the moment the loop is
      // closed: the acknowledged row keeps the member who actually closed it,
      // which is what makes the trail readable a year later.
      if (checkIn && checkIn.reviewerMemberId !== memberId) {
        throw new OperationError(
          "forbidden",
          "Only this goal's reviewer can acknowledge its check-ins. Reassign the reviewer first if that needs to change.",
        );
      }
      if (checkIn?.state !== "published") {
        throw new OperationError(
          "forbidden",
          "A draft has nothing to acknowledge yet.",
        );
      }
      if (checkIn.acknowledgedAt) {
        // Idempotent, not an error (§6.5).
        return {
          result: { id: input.id, alreadyAcknowledged: true },
          activity: {
            kind: "check_in.acknowledged",
            subjectType: "goal",
            subjectId: goalId,
            payload: { repeat: true },
          },
          audit: {
            action: "goals.acknowledgeCheckIn",
            targetType: "check_in",
            targetId: input.id,
            payload: { repeat: true },
          },
        };
      }

      const now = new Date();
      await tx
        .update(checkIns)
        .set({
          acknowledgedById: memberId,
          acknowledgedAt: now,
          updatedAt: now,
        })
        .where(activeOnly(checkIns, eq(checkIns.id, input.id)));

      // Acknowledgement never changes health (§6.5). It closes a loop; it is not
      // a second opinion on the status, so there is no recompute here.
      return {
        result: { id: input.id, alreadyAcknowledged: false },
        activity: {
          kind: "check_in.acknowledged",
          subjectType: "goal",
          subjectId: goalId,
          payload: { repeat: false },
        },
        audit: {
          action: "goals.acknowledgeCheckIn",
          targetType: "check_in",
          targetId: input.id,
          payload: {},
        },
      };
    },
  }),
});

export const castConfidenceVote = defineWriteAction({
  name: "goals.vote",
  summary:
    "A private confidence vote on one key result. Readable only by its author until the reveal.",
  input: z.object({
    keyResultId: z.uuid(),
    confidence: z.number().min(0).max(1),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const [owner] = await tx
        .select({ goalId: keyResults.goalId })
        .from(keyResults)
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.id, input.keyResultId),
          ),
        )
        .limit(1);
      if (!owner) {
        throw new OperationError("not_found", "No such key result.");
      }
      await requireGoalAccess(
        tx,
        workspaceId,
        memberId,
        owner.goalId,
        ACCESS_LEVELS.edit,
      );

      const now = new Date();
      const [existing] = await tx
        .select({ id: checkInVotes.id })
        .from(checkInVotes)
        .where(
          activeOnly(
            checkInVotes,
            eq(checkInVotes.workspaceId, workspaceId),
            eq(checkInVotes.keyResultId, input.keyResultId),
            eq(checkInVotes.memberId, memberId),
            isNull(checkInVotes.revealedAt),
          ),
        )
        .limit(1);

      if (existing) {
        // Changing your mind before the reveal updates the vote rather than
        // stacking a second one.
        await tx
          .update(checkInVotes)
          .set({ confidence: String(input.confidence), updatedAt: now })
          .where(activeOnly(checkInVotes, eq(checkInVotes.id, existing.id)));
        return {
          result: { id: existing.id },
          activity: {
            kind: "check_in.vote_cast",
            subjectType: "goal",
            subjectId: owner.goalId,
            payload: { changed: true },
          },
          audit: {
            action: "goals.vote",
            targetType: "key_result",
            targetId: input.keyResultId,
            payload: { changed: true },
          },
        };
      }

      const [created] = await tx
        .insert(checkInVotes)
        .values({
          workspaceId,
          keyResultId: input.keyResultId,
          memberId,
          confidence: String(input.confidence),
        })
        .returning({ id: checkInVotes.id });
      if (!created) {
        throw new Error("The vote insert returned no row.");
      }

      return {
        result: { id: created.id },
        activity: {
          kind: "check_in.vote_cast",
          subjectType: "goal",
          subjectId: owner.goalId,
          payload: { changed: false },
        },
        audit: {
          action: "goals.vote",
          targetType: "key_result",
          targetId: input.keyResultId,
          payload: {},
        },
      };
    },
  }),
});

export const revealConfidenceVotes = defineWriteAction({
  name: "goals.revealVotes",
  summary:
    "Reveals every vote on a key result in one write, so no client sees a partial reveal.",
  input: z.object({ keyResultId: z.uuid() }),
  output: z.object({ revealed: z.number().int() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const [owner] = await tx
        .select({ goalId: keyResults.goalId })
        .from(keyResults)
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.id, input.keyResultId),
          ),
        )
        .limit(1);
      if (!owner) {
        throw new OperationError("not_found", "No such key result.");
      }
      await requireGoalAccess(
        tx,
        workspaceId,
        memberId,
        owner.goalId,
        ACCESS_LEVELS.edit,
      );

      const now = new Date();
      // One statement over the whole set. §6.6: the reveal is one write, so there
      // is no instant at which one client can see three of four numbers.
      const revealed = await tx
        .update(checkInVotes)
        .set({ revealedAt: now, updatedAt: now })
        .where(
          activeOnly(
            checkInVotes,
            eq(checkInVotes.workspaceId, workspaceId),
            eq(checkInVotes.keyResultId, input.keyResultId),
            isNull(checkInVotes.revealedAt),
          ),
        )
        .returning({ id: checkInVotes.id });

      return {
        result: { revealed: revealed.length },
        activity: {
          kind: "check_in.votes_revealed",
          subjectType: "goal",
          subjectId: owner.goalId,
          payload: { revealed: revealed.length },
        },
        audit: {
          action: "goals.revealVotes",
          targetType: "key_result",
          targetId: input.keyResultId,
          payload: { revealed: revealed.length },
        },
      };
    },
  }),
});

export const listCheckIns = defineReadAction({
  name: "goals.checkIns",
  summary:
    "One goal's check-in timeline, newest first, with each one's snapshot differences.",
  input: z.object({
    goalId: z.uuid(),
    includeDrafts: z.boolean().default(true),
  }),
  output: z.object({
    checkIns: z.array(
      z.object({
        id: z.uuid(),
        state: z.enum(["draft", "published"]),
        status: z.enum(CHECK_IN_STATUSES).nullable(),
        confidence: z.number().nullable(),
        narrative: z.unknown().nullable(),
        publishedAt: z.string().nullable(),
        acknowledgedAt: z.string().nullable(),
        author: z.object({ id: z.uuid(), name: z.string() }),
        editable: z.boolean(),
        entries: z.array(
          z.object({
            keyResultId: z.uuid(),
            title: z.string(),
            value: z.number(),
            previousValue: z.number().nullable(),
            progressPct: z.number(),
            confidence: z.number().nullable(),
            previousConfidence: z.number().nullable(),
          }),
        ),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such goal.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        await requireGoalAccess(
          tx,
          context.workspaceId,
          memberId,
          input.goalId,
          ACCESS_LEVELS.view,
        );

        const rows = await tx
          .select({
            id: checkIns.id,
            state: checkIns.state,
            status: checkIns.status,
            confidence: checkIns.confidence,
            narrative: checkIns.narrative,
            publishedAt: checkIns.publishedAt,
            acknowledgedAt: checkIns.acknowledgedAt,
            authorMemberId: checkIns.authorMemberId,
            snapshotId: checkIns.snapshotId,
          })
          .from(checkIns)
          .where(
            activeOnly(
              checkIns,
              eq(checkIns.workspaceId, context.workspaceId),
              eq(checkIns.subjectId, input.goalId),
              // A draft is visible only to its own author. Nobody else is meant
              // to read a thought somebody has not published.
              input.includeDrafts
                ? sql`(${checkIns.state} = 'published' or ${checkIns.authorMemberId} = ${memberId})`
                : eq(checkIns.state, "published"),
            ),
          )
          .orderBy(desc(checkIns.publishedAt), desc(checkIns.createdAt));

        const snapshotIds = rows
          .map((row) => row.snapshotId)
          .filter((id): id is string => id !== null);
        const snapshots =
          snapshotIds.length === 0
            ? []
            : await tx
                .select({
                  id: checkInSnapshots.id,
                  entries: checkInSnapshots.entries,
                })
                .from(checkInSnapshots)
                .where(
                  activeOnly(
                    checkInSnapshots,
                    eq(checkInSnapshots.workspaceId, context.workspaceId),
                    inArray(checkInSnapshots.id, snapshotIds),
                  ),
                );
        const byId = new Map(snapshots.map((row) => [row.id, row.entries]));

        const names = await tx
          .select({ id: workspaceMembers.id, name: workspaceMembers.name })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, context.workspaceId),
            ),
          );
        const nameOf = new Map(names.map((row) => [row.id, row.name]));

        const now = new Date();
        const result = [];
        for (const row of rows) {
          const window = await editWindowOpen(
            tx,
            context.workspaceId,
            row.id,
            now,
          );
          result.push({
            id: row.id,
            state: row.state,
            status: row.status,
            confidence: row.confidence === null ? null : Number(row.confidence),
            narrative: row.narrative,
            publishedAt: row.publishedAt
              ? new Date(row.publishedAt).toISOString()
              : null,
            acknowledgedAt: row.acknowledgedAt
              ? new Date(row.acknowledgedAt).toISOString()
              : null,
            author: {
              id: row.authorMemberId,
              name: nameOf.get(row.authorMemberId) ?? "Unknown",
            },
            editable: window.open,
            entries: row.snapshotId ? (byId.get(row.snapshotId) ?? []) : [],
          });
        }

        return { checkIns: result };
      },
    );
  },
});

export const readConfidenceVotes = defineReadAction({
  name: "goals.readVotes",
  summary:
    "The votes on one key result: only your own until the reveal, all of them and the average after it.",
  input: z.object({ keyResultId: z.uuid() }),
  output: z.object({
    revealed: z.boolean(),
    count: z.number().int(),
    own: z.number().nullable(),
    average: z.number().nullable(),
    votes: z.array(z.object({ memberId: z.uuid(), confidence: z.number() })),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such key result.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        const [owner] = await tx
          .select({ goalId: keyResults.goalId })
          .from(keyResults)
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, context.workspaceId),
              eq(keyResults.id, input.keyResultId),
            ),
          )
          .limit(1);
        if (!owner) {
          throw new OperationError("not_found", "No such key result.");
        }
        await requireGoalAccess(
          tx,
          context.workspaceId,
          memberId,
          owner.goalId,
          ACCESS_LEVELS.view,
        );

        const rows = await tx
          .select({
            memberId: checkInVotes.memberId,
            confidence: checkInVotes.confidence,
            revealedAt: checkInVotes.revealedAt,
          })
          .from(checkInVotes)
          .where(
            activeOnly(
              checkInVotes,
              eq(checkInVotes.workspaceId, context.workspaceId),
              eq(checkInVotes.keyResultId, input.keyResultId),
            ),
          );

        const revealed = rows.length > 0 && rows.every((row) => row.revealedAt);
        const own = rows.find((row) => row.memberId === memberId);

        // Before the reveal the response count is the only shared fact. Handing
        // back the numbers and asking a browser not to draw them would make the
        // privacy a rendering choice.
        if (!revealed) {
          return {
            revealed: false,
            count: rows.length,
            own: own ? Number(own.confidence) : null,
            average: null,
            votes: [],
          };
        }

        const values = rows.map((row) => Number(row.confidence));
        return {
          revealed: true,
          count: rows.length,
          own: own ? Number(own.confidence) : null,
          average:
            values.length === 0
              ? null
              : Math.round(
                  (values.reduce((sum, value) => sum + value, 0) /
                    values.length) *
                    100,
                ) / 100,
          votes: rows.map((row) => ({
            memberId: row.memberId,
            confidence: Number(row.confidence),
          })),
        };
      },
    );
  },
});
