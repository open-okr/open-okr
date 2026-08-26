/**
 * Goal and key result actions (TECHNICAL-PLAN §4.4, §14, METHOD.md §2.5, §4,
 * P3-T04).
 *
 * Every read goes through the access getter on the goal's own context, so a goal
 * somebody cannot see reads as not found rather than as forbidden. Every write
 * goes through the Operation pipeline, which is what makes the change, the
 * activity row, the audit row and the outbox row one transaction.
 *
 * **Creating a goal asks for edit on the workspace, not on the goal.** The goal
 * does not exist yet, so there is no context to check. That is the same shape
 * `spaces.create` already uses.
 */
import {
  activeOnly,
  CAPACITY_VERDICTS,
  checkIns,
  cycles,
  GOAL_CLOSE_DECISIONS,
  GOAL_LEVELS,
  GOAL_OWNER_KINDS,
  GOAL_SUCCESS_STATUSES,
  goalRetrospectives,
  goals,
  INDICATOR_TYPES,
  KEY_RESULT_DIRECTIONS,
  keyResults,
  keyResultValues,
  okrSessions,
  reviewDecisions,
  type WorkspaceTx,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import {
  evaluateKeyResults,
  KEY_RESULT_CHECKS,
  type KeyResultInput,
} from "@openokr/method";
import { asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import {
  clearDue,
  daysPastDue,
  dueLocalDate,
  stampFirstDue,
} from "../cadence/service.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow, workspaceTimeZone } from "../cycles/service.ts";
import {
  asNumber,
  clampWeight,
  closeGoalInTx,
  createGoalInTx,
  createKeyResultInTx,
  type GoalRole,
  reassignRoleInTx,
  recordValueInTx,
  reopenGoalInTx,
  unlinkKpiInTx,
  wouldCloseAlignmentLoop,
} from "../goals/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import {
  recomputeGoalQualityInTx,
  recomputeUnitQualityInTx,
} from "../quality/service.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";
import { isValidRichText } from "../rich-text/validate.ts";
import { recomputeForGoal } from "../scoring/recompute.ts";
import { recomputeAlignmentFor } from "./alignment.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const richText = z
  .unknown()
  .refine(
    (value) =>
      value === null || isValidRichText(value, RICH_TEXT_SCHEMA_VERSION),
    { message: "not valid editor JSON for the current rich text schema" },
  );

const timeframe = z.object({
  startsOn: z.string(),
  endsOn: z.string(),
  label: z.string().optional(),
});

const keyResultOutput = z.object({
  /** Failing check ids for this row (P4-T02a stored them, P4-T06c reads them). */
  qualityFlags: z.array(z.string()),
  id: z.uuid(),
  goalId: z.uuid(),
  title: z.string(),
  unit: z.string().nullable(),
  direction: z.enum(KEY_RESULT_DIRECTIONS),
  indicatorType: z.enum(INDICATOR_TYPES),
  baselineValue: z.number(),
  targetValue: z.number(),
  currentValue: z.number(),
  dueOn: z.string().nullable(),
  ownerId: z.uuid().nullable(),
  weight: z.number(),
  kpiId: z.uuid().nullable(),
  capacity: z.enum(CAPACITY_VERDICTS).nullable(),
  progressPct: z.number(),
  confidence: z.number().nullable(),
  score: z.number().nullable(),
  carryForward: z.boolean(),
  position: z.number().int(),
});

const goalOutput = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.unknown().nullable(),
  cycleId: z.uuid().nullable(),
  timeframe: timeframe.nullable(),
  level: z.enum(GOAL_LEVELS),
  ownerKind: z.enum(GOAL_OWNER_KINDS),
  spaceId: z.uuid().nullable(),
  memberId: z.uuid().nullable(),
  champion: z.object({ id: z.uuid(), name: z.string() }),
  reviewer: z.object({ id: z.uuid(), name: z.string() }),
  parentGoalId: z.uuid().nullable(),
  parentKeyResultId: z.uuid().nullable(),
  weight: z.number(),
  contributionStatement: z.string().nullable(),
  closedAt: z.string().nullable(),
  successStatus: z.enum(GOAL_SUCCESS_STATUSES).nullable(),
  closeDecision: z.enum(GOAL_CLOSE_DECISIONS).nullable(),
  closeReason: z.string().nullable(),
  progressPct: z.number(),
  health: z.string(),
  /** The local date the next check-in is due, in the workspace calendar. */
  nextCheckInOn: z.string().nullable(),
  /** Negative before it, 0 on the day. Null when no cadence is set. */
  daysPastDue: z.number().int().nullable(),
  position: z.number().int(),
  keyResults: z.array(keyResultOutput),
  /**
   * §4's verdict on this goal, as P4-T02a stored it (P4-T06c).
   *
   * Read rather than recomputed: the score on the row is what the write path
   * committed to and what the quality panel already shows, and a second
   * evaluation here could disagree with it on the same screen.
   */
  quality: z.object({
    score: z.number().nullable(),
    /** Failing check ids, objective checks first. */
    flags: z.array(z.string()),
  }),
  /** Present once the goal has been closed at least once. Kept on reopen. */
  retrospective: z
    .object({ id: z.uuid(), body: z.unknown(), updatedAt: z.string() })
    .nullable(),
});

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

/**
 * Recomputes the derived columns after a write, in the same transaction.
 *
 * Every write below that can move a number calls this, and nothing else writes
 * `progress_pct`, `health` or `forecast` (P3-T05). It is a function rather than a
 * line repeated eleven times, so a write added later cannot leave the cascade
 * stale above it.
 */
async function recompute(
  tx: OperationTx,
  workspaceId: string,
  goalId: string,
): Promise<void> {
  const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
  await recomputeForGoal(tx, workspaceId, goalId, rhythm.thresholds);
}

/**
 * Recomputes the alignment score for every scope this goal sits in (P3-T09).
 *
 * Deliberately separate from `recompute` above, and called from fewer places.
 * METHOD.md §5.2 measures structure: who hangs off whom, who has key results at
 * all, who is linked sideways. A score that moved when a value moved would be
 * measuring something else, so publishing a check-in and recording a value do
 * not call this and must not start.
 *
 * The design document drives this from the outbox. There is still no relay host,
 * so it runs in the writing transaction, which is the same call P3-T05 made and
 * the stronger guarantee besides.
 */
async function realign(
  tx: OperationTx,
  workspaceId: string,
  goalId: string,
  alsoCycleId?: string | null,
): Promise<void> {
  const [goal] = await tx
    .select({ cycleId: goals.cycleId, spaceId: goals.spaceId })
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
    return;
  }
  const touched = [goal];
  if (alsoCycleId && alsoCycleId !== goal.cycleId) {
    // Moving a goal between cycles changes two pictures, not one: the cycle it
    // left has one goal fewer to hang together.
    touched.push({ cycleId: alsoCycleId, spaceId: goal.spaceId });
  }
  await recomputeAlignmentFor(tx, workspaceId, touched);
}

/** The level the acting member holds on one goal, or not-found. */
async function requireGoalAccess(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  goalId: string,
  requires: number,
): Promise<{ contextId: string; level: number }> {
  return getAccessScoped(tx, {
    workspaceId,
    memberId,
    resourceType: "goal",
    resourceId: goalId,
    requires: requires as never,
  });
}

function keyResultRow(row: {
  id: string;
  goalId: string;
  title: string;
  unit: string | null;
  direction: (typeof KEY_RESULT_DIRECTIONS)[number];
  indicatorType: (typeof INDICATOR_TYPES)[number];
  baselineValue: string;
  targetValue: string;
  currentValue: string;
  dueOn: string | null;
  ownerId: string | null;
  weight: string;
  kpiId: string | null;
  capacity: (typeof CAPACITY_VERDICTS)[number] | null;
  progressPct: string;
  confidence: string | null;
  qualityFlags: string[];
  score: string | null;
  carryForward: boolean;
  position: number;
}) {
  return {
    ...row,
    baselineValue: asNumber(row.baselineValue) ?? 0,
    targetValue: asNumber(row.targetValue) ?? 0,
    currentValue: asNumber(row.currentValue) ?? 0,
    weight: asNumber(row.weight) ?? 0,
    progressPct: asNumber(row.progressPct) ?? 0,
    confidence: asNumber(row.confidence),
    score: asNumber(row.score),
  };
}

const GOAL_COLUMNS = {
  id: goals.id,
  title: goals.title,
  description: goals.description,
  cycleId: goals.cycleId,
  timeframe: goals.timeframe,
  level: goals.level,
  ownerKind: goals.ownerKind,
  spaceId: goals.spaceId,
  memberId: goals.memberId,
  championId: goals.championId,
  reviewerId: goals.reviewerId,
  parentGoalId: goals.parentGoalId,
  parentKeyResultId: goals.parentKeyResultId,
  weight: goals.weight,
  contributionStatement: goals.contributionStatement,
  closedAt: goals.closedAt,
  successStatus: goals.successStatus,
  closeDecision: goals.closeDecision,
  closeReason: goals.closeReason,
  progressPct: goals.progressPct,
  health: goals.health,
  nextCheckInAt: goals.nextCheckInAt,
  position: goals.position,
  qualityScore: goals.qualityScore,
  qualityFlags: goals.qualityFlags,
} as const;

const KEY_RESULT_COLUMNS = {
  id: keyResults.id,
  goalId: keyResults.goalId,
  title: keyResults.title,
  unit: keyResults.unit,
  direction: keyResults.direction,
  indicatorType: keyResults.indicatorType,
  baselineValue: keyResults.baselineValue,
  targetValue: keyResults.targetValue,
  currentValue: keyResults.currentValue,
  dueOn: keyResults.dueOn,
  ownerId: keyResults.ownerId,
  weight: keyResults.weight,
  kpiId: keyResults.kpiId,
  capacity: keyResults.capacity,
  progressPct: keyResults.progressPct,
  confidence: keyResults.confidence,
  score: keyResults.score,
  carryForward: keyResults.carryForward,
  position: keyResults.position,
  qualityFlags: keyResults.qualityFlags,
} as const;

/** Names for the two roles, so a card reads as a sentence without a second query. */
async function memberNames(
  tx: OperationTx,
  workspaceId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await tx
    .select({ id: workspaceMembers.id, name: workspaceMembers.name })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.id, [...ids]),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.name]));
}

export const listGoals = defineReadAction({
  name: "goals.list",
  summary:
    "Goals in a cycle, or the whole workspace, with their key results attached.",
  input: z.object({
    cycleId: z.uuid().optional(),
    /** Closed goals are excluded unless asked for: a set is what is live in it. */
    includeClosed: z.boolean().default(false),
    level: z.enum(GOAL_LEVELS).optional(),
    /**
     * One space's goals. Not an access control: the getter below still decides
     * what the reader may see, and a space they cannot read returns nothing
     * rather than refusing. This is the scope tab the Work Map and the explorer
     * both need (S-01, S-13).
     */
    spaceId: z.uuid().optional(),
  }),
  output: z.object({ goals: z.array(goalOutput) }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);

        const filters = [eq(goals.workspaceId, context.workspaceId)];
        if (input.cycleId) {
          filters.push(eq(goals.cycleId, input.cycleId));
        }
        if (input.level) {
          filters.push(eq(goals.level, input.level));
        }
        if (input.spaceId) {
          filters.push(eq(goals.spaceId, input.spaceId));
        }
        if (!input.includeClosed) {
          filters.push(isNull(goals.closedAt));
        }

        const rows = await tx
          .select(GOAL_COLUMNS)
          .from(goals)
          .where(activeOnly(goals, ...filters))
          .orderBy(asc(goals.position), asc(goals.createdAt));

        // Every goal is filtered through the getter rather than trusted from the
        // list query. A list is a read of many protected aggregates, and §4.1
        // does not exempt it from the one chokepoint.
        const visible = [];
        for (const row of rows) {
          try {
            await requireGoalAccess(
              tx,
              context.workspaceId,
              memberId,
              row.id,
              ACCESS_LEVELS.view,
            );
            visible.push(row);
          } catch (error) {
            if (error instanceof OperationError && error.code === "not_found") {
              continue;
            }
            throw error;
          }
        }

        const ids = visible.map((row) => row.id);
        const children =
          ids.length === 0
            ? []
            : await tx
                .select(KEY_RESULT_COLUMNS)
                .from(keyResults)
                .where(
                  activeOnly(
                    keyResults,
                    eq(keyResults.workspaceId, context.workspaceId),
                    inArray(keyResults.goalId, ids),
                  ),
                )
                .orderBy(asc(keyResults.position));

        const names = await memberNames(
          tx,
          context.workspaceId,
          visible.flatMap((row) => [row.championId, row.reviewerId]),
        );
        // The due date is a date in the workspace calendar, so it is read in the
        // workspace timezone rather than the reader's.
        const timeZone = await workspaceTimeZone(tx, context.workspaceId);
        const now = new Date();

        return {
          goals: visible.map((row) => ({
            ...row,
            weight: asNumber(row.weight) ?? 0,
            progressPct: asNumber(row.progressPct) ?? 0,
            closedAt: row.closedAt
              ? new Date(row.closedAt).toISOString()
              : null,
            nextCheckInOn: dueLocalDate(row.nextCheckInAt, timeZone),
            daysPastDue: daysPastDue(row.nextCheckInAt, now, timeZone),
            champion: {
              id: row.championId,
              name: names.get(row.championId) ?? "Unknown",
            },
            reviewer: {
              id: row.reviewerId,
              name: names.get(row.reviewerId) ?? "Unknown",
            },
            keyResults: children
              .filter((child) => child.goalId === row.id)
              .map(keyResultRow),
            // The same stored verdict the read returns, so a list and a card
            // cannot show a different score for one goal.
            quality: {
              score: asNumber(row.qualityScore),
              flags: [...row.qualityFlags],
            },
            retrospective: null,
          })),
        };
      },
    );
  },
});

export const readGoal = defineReadAction({
  name: "goals.read",
  summary:
    "One goal with its key results and its retrospective, if it has one.",
  input: z.object({ id: z.uuid() }),
  output: goalOutput,
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
          input.id,
          ACCESS_LEVELS.view,
        );

        const [row] = await tx
          .select(GOAL_COLUMNS)
          .from(goals)
          .where(
            activeOnly(
              goals,
              eq(goals.workspaceId, context.workspaceId),
              eq(goals.id, input.id),
            ),
          )
          .limit(1);
        if (!row) {
          throw new OperationError("not_found", "No such goal.");
        }

        const children = await tx
          .select(KEY_RESULT_COLUMNS)
          .from(keyResults)
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, context.workspaceId),
              eq(keyResults.goalId, input.id),
            ),
          )
          .orderBy(asc(keyResults.position));

        const [retro] = await tx
          .select({
            id: goalRetrospectives.id,
            body: goalRetrospectives.body,
            updatedAt: goalRetrospectives.updatedAt,
          })
          .from(goalRetrospectives)
          .where(
            activeOnly(
              goalRetrospectives,
              eq(goalRetrospectives.workspaceId, context.workspaceId),
              eq(goalRetrospectives.goalId, input.id),
            ),
          )
          .limit(1);

        const names = await memberNames(tx, context.workspaceId, [
          row.championId,
          row.reviewerId,
        ]);
        const timeZone = await workspaceTimeZone(tx, context.workspaceId);
        const now = new Date();

        return {
          ...row,
          weight: asNumber(row.weight) ?? 0,
          progressPct: asNumber(row.progressPct) ?? 0,
          closedAt: row.closedAt ? new Date(row.closedAt).toISOString() : null,
          nextCheckInOn: dueLocalDate(row.nextCheckInAt, timeZone),
          daysPastDue: daysPastDue(row.nextCheckInAt, now, timeZone),
          champion: {
            id: row.championId,
            name: names.get(row.championId) ?? "Unknown",
          },
          reviewer: {
            id: row.reviewerId,
            name: names.get(row.reviewerId) ?? "Unknown",
          },
          keyResults: children.map(keyResultRow),
          // Read, never recomputed here: the score on the row is what the
          // write path committed to and what the quality panel already shows,
          // and a second evaluation on this screen could disagree with it.
          quality: {
            score: asNumber(row.qualityScore),
            flags: [...row.qualityFlags],
          },
          retrospective: retro
            ? {
                id: retro.id,
                body: retro.body,
                updatedAt: new Date(retro.updatedAt).toISOString(),
              }
            : null,
        };
      },
    );
  },
});

export const listDueGoals = defineReadAction({
  name: "goals.due",
  summary:
    "The goals this member champions that are due a check-in, soonest first. Drives the session walker.",
  input: z.object({
    /** Days ahead to count as due soon. 0 is "due or overdue only". */
    withinDays: z.number().int().min(0).max(30).default(2),
  }),
  output: z.object({
    goals: z.array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        level: z.enum(GOAL_LEVELS),
        health: z.string(),
        progressPct: z.number(),
        nextCheckInOn: z.string().nullable(),
        daysPastDue: z.number().int().nullable(),
        keyResultCount: z.number().int(),
        hasOpenDraft: z.boolean(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        const timeZone = await workspaceTimeZone(tx, context.workspaceId);
        const now = new Date();

        // The champion's own goals. METHOD.md §2.5: the champion posts the
        // check-ins, so a walker that offered somebody else's goals would be
        // asking the wrong person.
        const rows = await tx
          .select({
            id: goals.id,
            title: goals.title,
            level: goals.level,
            health: goals.health,
            progressPct: goals.progressPct,
            nextCheckInAt: goals.nextCheckInAt,
          })
          .from(goals)
          .where(
            activeOnly(
              goals,
              eq(goals.workspaceId, context.workspaceId),
              eq(goals.championId, memberId),
              isNull(goals.closedAt),
              isNotNull(goals.nextCheckInAt),
            ),
          )
          .orderBy(asc(goals.nextCheckInAt));

        const visible = [];
        for (const row of rows) {
          const days = daysPastDue(row.nextCheckInAt, now, timeZone);
          // Due, overdue, or due inside the lead the caller asked for.
          if (days === null || days < -input.withinDays) {
            continue;
          }
          try {
            await requireGoalAccess(
              tx,
              context.workspaceId,
              memberId,
              row.id,
              ACCESS_LEVELS.view,
            );
          } catch (error) {
            if (error instanceof OperationError && error.code === "not_found") {
              continue;
            }
            throw error;
          }
          visible.push({ row, days });
        }

        const ids = visible.map((entry) => entry.row.id);
        const counts =
          ids.length === 0
            ? []
            : await tx
                .select({ id: keyResults.id, goalId: keyResults.goalId })
                .from(keyResults)
                .where(
                  activeOnly(
                    keyResults,
                    eq(keyResults.workspaceId, context.workspaceId),
                    inArray(keyResults.goalId, ids),
                  ),
                );
        const drafts =
          ids.length === 0
            ? []
            : await tx
                .select({ subjectId: checkIns.subjectId })
                .from(checkIns)
                .where(
                  activeOnly(
                    checkIns,
                    eq(checkIns.workspaceId, context.workspaceId),
                    eq(checkIns.authorMemberId, memberId),
                    eq(checkIns.state, "draft"),
                    inArray(checkIns.subjectId, ids),
                  ),
                );
        const withDraft = new Set(drafts.map((row) => row.subjectId));

        return {
          goals: visible.map(({ row, days }) => ({
            id: row.id,
            title: row.title,
            level: row.level,
            health: row.health,
            progressPct: asNumber(row.progressPct) ?? 0,
            nextCheckInOn: dueLocalDate(row.nextCheckInAt, timeZone),
            daysPastDue: days,
            keyResultCount: counts.filter((entry) => entry.goalId === row.id)
              .length,
            hasOpenDraft: withDraft.has(row.id),
          })),
        };
      },
    );
  },
});

export const readKeyResultHistory = defineReadAction({
  name: "goals.keyResultHistory",
  summary:
    "One key result's value history, newest first. Drives the sparkline.",
  input: z.object({
    keyResultId: z.uuid(),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  output: z.object({
    values: z.array(
      z.object({
        id: z.uuid(),
        value: z.number(),
        at: z.string(),
        source: z.string(),
        note: z.string().nullable(),
      }),
    ),
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

        // A key result is a sub-resource: authorisation resolves through the
        // goal that owns it (§4.1, "sub-resources inherit").
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
            id: keyResultValues.id,
            value: keyResultValues.value,
            at: keyResultValues.at,
            source: keyResultValues.source,
            note: keyResultValues.note,
          })
          .from(keyResultValues)
          .where(
            activeOnly(
              keyResultValues,
              eq(keyResultValues.workspaceId, context.workspaceId),
              eq(keyResultValues.keyResultId, input.keyResultId),
            ),
          )
          .orderBy(desc(keyResultValues.at))
          .limit(input.limit);

        return {
          values: rows.map((row) => ({
            id: row.id,
            value: asNumber(row.value) ?? 0,
            at: new Date(row.at).toISOString(),
            source: row.source,
            note: row.note,
          })),
        };
      },
    );
  },
});

export const createGoal = defineWriteAction({
  name: "goals.create",
  summary:
    "Creates a goal with its champion, its reviewer and its access context.",
  input: z
    .object({
      title: z.string().trim().min(1).max(500),
      description: richText.optional(),
      cycleId: z.uuid().optional(),
      timeframe: timeframe.optional(),
      level: z.enum(GOAL_LEVELS),
      ownerKind: z.enum(GOAL_OWNER_KINDS).default("workspace"),
      spaceId: z.uuid().optional(),
      memberId: z.uuid().optional(),
      championId: z.uuid(),
      reviewerId: z.uuid(),
      parentGoalId: z.uuid().optional(),
      parentKeyResultId: z.uuid().optional(),
      weight: z.number().default(1),
      contributionStatement: z.string().trim().max(1000).optional(),
      /**
       * True when a model wrote the words (P4-T15a).
       *
       * The caller's claim, not something inferred: only the surface that ran
       * the assist knows whether the reader kept the draft or rewrote it. A
       * reader who replaces every word should not have their objective marked
       * as written by a model, and one who accepts it verbatim should.
       */
      aiGenerated: z.boolean().optional(),
    })
    // OBJ-3 as a boundary check, so the refusal is a sentence rather than a
    // constraint violation. The database enforces the same thing underneath.
    .refine((value) => Boolean(value.cycleId) !== Boolean(value.timeframe), {
      message:
        "A goal sits in a cycle or carries its own timeframe, not both and not neither.",
    })
    .refine((value) => !(value.parentGoalId && value.parentKeyResultId), {
      message: "A goal aligns to one parent, not two.",
    }),
  output: z.object({ id: z.uuid(), title: z.string() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );

      // A parent has to be one this writer can actually see, resolved through
      // the getter so an invisible parent reads as not found (§4.2).
      if (input.parentGoalId) {
        await requireGoalAccess(
          tx,
          workspaceId,
          memberId,
          input.parentGoalId,
          ACCESS_LEVELS.view,
        );
      }
      if (input.parentKeyResultId) {
        const [owner] = await tx
          .select({ goalId: keyResults.goalId })
          .from(keyResults)
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, workspaceId),
              eq(keyResults.id, input.parentKeyResultId),
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
          ACCESS_LEVELS.view,
        );
      }

      if (input.cycleId) {
        const [cycle] = await tx
          .select({ status: cycles.status })
          .from(cycles)
          .where(
            activeOnly(
              cycles,
              eq(cycles.workspaceId, workspaceId),
              eq(cycles.id, input.cycleId),
            ),
          )
          .limit(1);
        if (!cycle) {
          throw new OperationError("not_found", "No such cycle.");
        }
        if (cycle.status === "closed") {
          throw new OperationError(
            "forbidden",
            "That cycle is closed. Its set does not change after the archive.",
          );
        }
      }

      const created = await createGoalInTx(tx, {
        workspaceId,
        title: input.title,
        description: input.description,
        cycleId: input.cycleId ?? null,
        timeframe: input.timeframe ?? null,
        level: input.level,
        ownerKind: input.ownerKind,
        spaceId: input.spaceId ?? null,
        memberId: input.memberId ?? null,
        championId: input.championId,
        reviewerId: input.reviewerId,
        parentGoalId: input.parentGoalId ?? null,
        parentKeyResultId: input.parentKeyResultId ?? null,
        weight: input.weight,
        contributionStatement: input.contributionStatement ?? null,
        aiGenerated: input.aiGenerated ?? false,
      });

      // The rhythm starts at creation (§8 of the cadence design), and the
      // recompute below reads the due date this stamps.
      const rhythmSettings = resolveRhythm(
        await readRhythmRow(tx, workspaceId),
      );
      await stampFirstDue(
        tx,
        workspaceId,
        created.id,
        rhythmSettings.thresholds,
        new Date(),
      );
      await recompute(tx, workspaceId, created.id);
      await realign(tx, workspaceId, created.id);
      // The whole unit, not just this goal: OBJ-5 is a property of the set, so
      // a fourth objective changes the verdict on the three already there.
      await recomputeUnitQualityInTx(tx, { workspaceId, goalId: created.id });

      return {
        result: { id: created.id, title: created.title },
        activity: {
          kind: "goal.created",
          subjectType: "goal",
          subjectId: created.id,
          payload: { title: created.title, level: input.level },
        },
        audit: {
          action: "goals.create",
          targetType: "goal",
          targetId: created.id,
          payload: { title: created.title, level: input.level },
        },
      };
    },
  }),
});

export const updateGoal = defineWriteAction({
  name: "goals.update",
  summary: "Edits a goal's own fields, including its alignment pointer.",
  input: z.object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(500).optional(),
    description: richText.optional(),
    level: z.enum(GOAL_LEVELS).optional(),
    weight: z.number().optional(),
    contributionStatement: z.string().trim().max(1000).nullable().optional(),
    /** Null clears the alignment. A goal with no parent is an island, not an error. */
    parentGoalId: z.uuid().nullable().optional(),
    parentKeyResultId: z.uuid().nullable().optional(),
    checkInFrequency: z
      .enum(["daily", "weekly", "biweekly", "monthly"])
      .nullable()
      .optional(),
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
      await requireGoalAccess(
        tx,
        workspaceId,
        memberId,
        input.id,
        ACCESS_LEVELS.edit,
      );

      if (input.parentGoalId && input.parentKeyResultId) {
        throw new OperationError(
          "forbidden",
          "A goal aligns to one parent, not two.",
        );
      }

      if (input.parentGoalId) {
        await requireGoalAccess(
          tx,
          workspaceId,
          memberId,
          input.parentGoalId,
          ACCESS_LEVELS.view,
        );
        if (input.parentGoalId === input.id) {
          throw new OperationError(
            "forbidden",
            "That would make the alignment circular.",
          );
        }
        if (
          await wouldCloseAlignmentLoop(
            tx,
            workspaceId,
            input.id,
            input.parentGoalId,
          )
        ) {
          throw new OperationError(
            "forbidden",
            "That would make the alignment circular.",
          );
        }
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.title !== undefined) {
        patch.title = input.title;
      }
      if (input.description !== undefined) {
        patch.description = input.description;
        patch.descriptionVersion =
          input.description === null ? null : RICH_TEXT_SCHEMA_VERSION;
      }
      if (input.level !== undefined) {
        patch.level = input.level;
      }
      if (input.weight !== undefined) {
        patch.weight = String(clampWeight(input.weight));
      }
      if (input.contributionStatement !== undefined) {
        patch.contributionStatement =
          input.contributionStatement?.trim() || null;
      }
      if (input.checkInFrequency !== undefined) {
        patch.checkInFrequency = input.checkInFrequency;
      }
      // Setting either pointer clears the other, because at most one can hold.
      if (input.parentGoalId !== undefined) {
        patch.parentGoalId = input.parentGoalId;
        patch.parentKeyResultId = null;
      }
      if (input.parentKeyResultId !== undefined) {
        patch.parentKeyResultId = input.parentKeyResultId;
        patch.parentGoalId = null;
      }

      const [updated] = await tx
        .update(goals)
        .set(patch)
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            eq(goals.id, input.id),
          ),
        )
        .returning({ id: goals.id, title: goals.title });
      if (!updated) {
        throw new OperationError("not_found", "No such goal.");
      }

      if (input.checkInFrequency !== undefined) {
        // §8: a frequency change counts from today, so changing it never makes a
        // goal instantly overdue.
        const changed = resolveRhythm(await readRhythmRow(tx, workspaceId));
        await stampFirstDue(
          tx,
          workspaceId,
          updated.id,
          changed.thresholds,
          new Date(),
        );
      }
      await recompute(tx, workspaceId, updated.id);
      // An update can retitle, recycle, or move the level or owning space, and
      // every one of those changes a verdict. The unit rather than the goal,
      // because a level move changes the count on both units it touches.
      await recomputeUnitQualityInTx(tx, { workspaceId, goalId: updated.id });
      // An update can move the parent, the level or the owning space, and all
      // three are what the score reads. It can also move only a title, and
      // recomputing then costs one query set and keeps this honest without a
      // list of fields to forget to extend.
      await realign(tx, workspaceId, updated.id);

      return {
        result: { id: updated.id },
        activity: {
          kind: "goal.updated",
          subjectType: "goal",
          subjectId: updated.id,
          payload: { title: updated.title },
        },
        audit: {
          action: "goals.update",
          targetType: "goal",
          targetId: updated.id,
          payload: {
            keys: Object.keys(patch).filter((key) => key !== "updatedAt"),
          },
        },
      };
    },
  }),
});

/**
 * What the last quarterly review decided about this objective (P4-T11c-b).
 *
 * **This is what "written back to the goal on close" means.** §8.8 has the room
 * deciding keep, modify or abandon with a one-line why, and P4-T11c-a found that
 * the decision cannot be written onto the goal on its own: `goals_close_is_complete`
 * holds that `closed_at`, `success_status` and `close_decision` are present
 * together or not at all, and the review collects no retrospective to close with.
 *
 * So the decision stays in `review_decisions` and the close screen reads it here
 * as its default. Agung settled that on 26 August 2026. Closing an objective
 * stays a deliberate act with a retrospective behind it; what the review
 * contributes is the decision the room already reached, so nobody has to
 * remember it or type it twice.
 *
 * The most recent review wins. A goal reviewed twice was discussed twice, and
 * the later conversation is the one that stands.
 */
export const goalReviewDecision = defineReadAction({
  name: "goals.reviewDecision",
  summary:
    "The keep/modify/abandon decision the last quarterly review reached for this goal.",
  input: z.object({ id: z.uuid() }),
  output: z.object({
    decision: z.enum(GOAL_CLOSE_DECISIONS).nullable(),
    why: z.string().nullable(),
    /** When the review that decided it was held, so a stale one reads as stale. */
    decidedAt: z.string().nullable(),
    sessionTitle: z.string().nullable(),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId: context.actor.userId },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const memberId = await actingMember(
          tx,
          context.workspaceId,
          context.actor.userId,
        );
        // Through the access getter, like every other read of a goal: a
        // non-member reads not-found rather than a decision.
        await requireGoalAccess(
          tx,
          context.workspaceId,
          memberId,
          input.id,
          ACCESS_LEVELS.view,
        );

        const [row] = await tx
          .select({
            decision: reviewDecisions.decision,
            why: reviewDecisions.why,
            decidedAt: reviewDecisions.updatedAt,
            sessionTitle: okrSessions.title,
          })
          .from(reviewDecisions)
          .innerJoin(okrSessions, eq(okrSessions.id, reviewDecisions.sessionId))
          .where(
            activeOnly(
              reviewDecisions,
              eq(reviewDecisions.workspaceId, context.workspaceId),
              eq(reviewDecisions.goalId, input.id),
            ),
          )
          .orderBy(desc(reviewDecisions.updatedAt))
          .limit(1);

        return {
          decision: row?.decision ?? null,
          why: row?.why ?? null,
          decidedAt: row?.decidedAt?.toISOString() ?? null,
          sessionTitle: row?.sessionTitle ?? null,
        };
      },
    );
  },
});

export const closeGoal = defineWriteAction({
  name: "goals.close",
  summary:
    "Closes a goal with an outcome, a keep/modify/abandon decision and a retrospective.",
  input: z.object({
    id: z.uuid(),
    successStatus: z.enum(GOAL_SUCCESS_STATUSES),
    closeDecision: z.enum(GOAL_CLOSE_DECISIONS),
    closeReason: z.string().trim().max(2000).optional(),
    retrospectiveBody: richText,
  }),
  output: z.object({ id: z.uuid(), successStatus: z.string() }),
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
        input.id,
        ACCESS_LEVELS.edit,
      );

      // §4.3 will not close a goal with no account of what happened. Refused
      // here in words rather than left to the not-null column.
      if (input.retrospectiveBody === null) {
        throw new OperationError(
          "forbidden",
          "Closing a goal needs a retrospective. What happened, and what would you do differently?",
        );
      }

      await closeGoalInTx(tx, {
        workspaceId,
        goalId: input.id,
        closedById: memberId,
        successStatus: input.successStatus,
        closeDecision: input.closeDecision,
        closeReason: input.closeReason ?? null,
        retrospectiveBody: input.retrospectiveBody,
      });

      // A closed goal is never due. Leaving a date on it would make the sweep
      // report an archive as neglected.
      await clearDue(tx, workspaceId, input.id);
      await recompute(tx, workspaceId, input.id);
      // OBJ-5 counts the open objectives in a unit, so closing one changes the
      // verdict on every sibling that is still open.
      await recomputeUnitQualityInTx(tx, { workspaceId, goalId: input.id });
      // A closed goal still counts (decision D-11), so the score does not climb
      // as a cycle ends. It is recomputed anyway because closing can change what
      // the surface shows beside it.
      await realign(tx, workspaceId, input.id);

      return {
        result: { id: input.id, successStatus: input.successStatus },
        activity: {
          kind: "goal.closed",
          subjectType: "goal",
          subjectId: input.id,
          payload: {
            successStatus: input.successStatus,
            closeDecision: input.closeDecision,
          },
        },
        audit: {
          action: "goals.close",
          targetType: "goal",
          targetId: input.id,
          payload: {
            successStatus: input.successStatus,
            closeDecision: input.closeDecision,
          },
        },
      };
    },
  }),
});

export const reopenGoal = defineWriteAction({
  name: "goals.reopen",
  summary:
    "Reopens a closed goal, clearing its outcome and keeping its retrospective.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
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
        input.id,
        ACCESS_LEVELS.edit,
      );

      await reopenGoalInTx(tx, { workspaceId, goalId: input.id });
      // §8: a reopened goal is never instantly overdue.
      const reopenRhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
      await stampFirstDue(
        tx,
        workspaceId,
        input.id,
        reopenRhythm.thresholds,
        new Date(),
      );
      await recompute(tx, workspaceId, input.id);
      await realign(tx, workspaceId, input.id);
      // Rejoining the open set is the closing rule in reverse.
      await recomputeUnitQualityInTx(tx, { workspaceId, goalId: input.id });

      return {
        result: { id: input.id },
        activity: {
          kind: "goal.reopened",
          subjectType: "goal",
          subjectId: input.id,
          payload: {},
        },
        audit: {
          action: "goals.reopen",
          targetType: "goal",
          targetId: input.id,
          payload: {},
        },
      };
    },
  }),
});

export const reassignGoalRole = defineWriteAction({
  name: "goals.reassignRole",
  summary:
    "Moves the champion or the reviewer to another member, rebinding access with it.",
  input: z.object({
    id: z.uuid(),
    role: z.enum(["champion", "reviewer"]),
    memberId: z.uuid(),
  }),
  output: z.object({ id: z.uuid(), role: z.string() }),
  // Full, not edit: naming who owns and who reviews a goal is administering it,
  // and the champion is the one who holds full on their own goal.
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const actor = await actingMember(tx, workspaceId, context.actor.userId);
      const { contextId } = await requireGoalAccess(
        tx,
        workspaceId,
        actor,
        input.id,
        ACCESS_LEVELS.full,
      );

      const [goal] = await tx
        .select({
          championId: goals.championId,
          reviewerId: goals.reviewerId,
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
        throw new OperationError("not_found", "No such goal.");
      }

      const role = input.role as GoalRole;
      const fromMemberId =
        role === "champion" ? goal.championId : goal.reviewerId;

      await reassignRoleInTx(tx, {
        workspaceId,
        goalId: input.id,
        contextId,
        role,
        fromMemberId,
        toMemberId: input.memberId,
      });

      // OBJ-4 names the champion and the reviewer, so a rebind changes it.
      await recomputeGoalQualityInTx(tx, { workspaceId, goalId: input.id });

      return {
        result: { id: input.id, role },
        activity: {
          kind: "goal.role_reassigned",
          subjectType: "goal",
          subjectId: input.id,
          payload: { role },
        },
        audit: {
          action: "goals.reassignRole",
          targetType: "goal",
          targetId: input.id,
          payload: { role, from: fromMemberId, to: input.memberId },
        },
      };
    },
  }),
});

export const moveGoalToCycle = defineWriteAction({
  name: "goals.moveToCycle",
  summary:
    "Moves a goal into another cycle, taking its check-in history with it.",
  input: z.object({ id: z.uuid(), cycleId: z.uuid() }),
  output: z.object({ id: z.uuid(), cycleId: z.uuid() }),
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
        input.id,
        ACCESS_LEVELS.edit,
      );

      const [target] = await tx
        .select({ status: cycles.status })
        .from(cycles)
        .where(
          activeOnly(
            cycles,
            eq(cycles.workspaceId, workspaceId),
            eq(cycles.id, input.cycleId),
          ),
        )
        .limit(1);
      if (!target) {
        throw new OperationError("not_found", "No such cycle.");
      }
      // §4.5: planning or active only. A closed cycle is a record.
      if (target.status !== "planning" && target.status !== "active") {
        throw new OperationError(
          "forbidden",
          "A goal cannot move into a cycle that is closing or closed.",
        );
      }

      // The cycle it is leaving, read before the update. `returning` gives the
      // new values, and the cycle it left has one goal fewer to hang together,
      // so its own score has to be recomputed too (P3-T09).
      const [before] = await tx
        .select({ cycleId: goals.cycleId })
        .from(goals)
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            eq(goals.id, input.id),
          ),
        )
        .limit(1);

      const [moved] = await tx
        .update(goals)
        .set({ cycleId: input.cycleId, timeframe: null, updatedAt: new Date() })
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            eq(goals.id, input.id),
          ),
        )
        .returning({ id: goals.id, title: goals.title });
      if (!moved) {
        throw new OperationError("not_found", "No such goal.");
      }

      await recompute(tx, workspaceId, moved.id);
      await realign(tx, workspaceId, moved.id, before?.cycleId ?? null);
      // OBJ-3 reads whether the goal is in a cycle at all, so a move can flip
      // it. The unit is untouched by a cycle move, so only this goal.
      await recomputeGoalQualityInTx(tx, { workspaceId, goalId: moved.id });

      return {
        result: { id: moved.id, cycleId: input.cycleId },
        activity: {
          kind: "goal.moved_to_cycle",
          subjectType: "goal",
          subjectId: moved.id,
          payload: { title: moved.title },
        },
        audit: {
          action: "goals.moveToCycle",
          targetType: "goal",
          targetId: moved.id,
          payload: { cycleId: input.cycleId },
        },
      };
    },
  }),
});

export const createKeyResult = defineWriteAction({
  name: "goals.addKeyResult",
  summary:
    "Adds a key result to a goal, with its baseline recorded as history.",
  input: z.object({
    goalId: z.uuid(),
    title: z.string().trim().min(1).max(500),
    unit: z.string().trim().max(60).optional(),
    direction: z.enum(KEY_RESULT_DIRECTIONS),
    indicatorType: z.enum(INDICATOR_TYPES),
    baselineValue: z.number(),
    targetValue: z.number(),
    currentValue: z.number().optional(),
    dueOn: z.string().optional(),
    ownerId: z.uuid().optional(),
    weight: z.number().default(1),
    kpiId: z.uuid().optional(),
    capacity: z.enum(CAPACITY_VERDICTS).optional(),
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
      await requireGoalAccess(
        tx,
        workspaceId,
        memberId,
        input.goalId,
        ACCESS_LEVELS.edit,
      );

      const created = await createKeyResultInTx(tx, {
        workspaceId,
        goalId: input.goalId,
        title: input.title,
        unit: input.unit ?? null,
        direction: input.direction,
        indicatorType: input.indicatorType,
        baselineValue: input.baselineValue,
        targetValue: input.targetValue,
        currentValue: input.currentValue,
        dueOn: input.dueOn ?? null,
        ownerId: input.ownerId ?? null,
        weight: input.weight,
        kpiId: input.kpiId ?? null,
        capacity: input.capacity ?? null,
        authorMemberId: memberId,
      });

      await recompute(tx, workspaceId, input.goalId);
      // The KR checks judge the set, so adding one rescores all of them.
      await recomputeGoalQualityInTx(tx, { workspaceId, goalId: input.goalId });

      // Only when the count crosses zero (design §7). KR-1 fires at none and at
      // nothing else, so the second key result changes no penalty and the third
      // changes no penalty, and recomputing the whole scope for them would be
      // work with no possible effect.
      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(keyResults)
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.goalId, input.goalId),
          ),
        );
      if (count === 1) {
        await realign(tx, workspaceId, input.goalId);
      }

      return {
        result: { id: created.id },
        activity: {
          kind: "key_result.created",
          subjectType: "goal",
          subjectId: input.goalId,
          payload: { title: input.title },
        },
        audit: {
          action: "goals.addKeyResult",
          targetType: "key_result",
          targetId: created.id,
          payload: { goalId: input.goalId, title: input.title },
        },
      };
    },
  }),
});

export const updateKeyResult = defineWriteAction({
  name: "goals.updateKeyResult",
  summary:
    "Edits a key result's definition. The current value has its own action, because it is history.",
  input: z.object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(500).optional(),
    unit: z.string().trim().max(60).nullable().optional(),
    direction: z.enum(KEY_RESULT_DIRECTIONS).optional(),
    indicatorType: z.enum(INDICATOR_TYPES).optional(),
    baselineValue: z.number().optional(),
    targetValue: z.number().optional(),
    dueOn: z.string().nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    weight: z.number().optional(),
    capacity: z.enum(CAPACITY_VERDICTS).nullable().optional(),
    carryForward: z.boolean().optional(),
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
            eq(keyResults.id, input.id),
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

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.title !== undefined) {
        patch.title = input.title;
      }
      if (input.unit !== undefined) {
        patch.unit = input.unit?.trim() || null;
      }
      if (input.direction !== undefined) {
        patch.direction = input.direction;
      }
      if (input.indicatorType !== undefined) {
        patch.indicatorType = input.indicatorType;
      }
      if (input.baselineValue !== undefined) {
        patch.baselineValue = String(input.baselineValue);
      }
      if (input.targetValue !== undefined) {
        patch.targetValue = String(input.targetValue);
      }
      if (input.dueOn !== undefined) {
        patch.dueOn = input.dueOn;
      }
      if (input.ownerId !== undefined) {
        patch.ownerId = input.ownerId;
      }
      if (input.weight !== undefined) {
        patch.weight = String(clampWeight(input.weight));
      }
      if (input.capacity !== undefined) {
        patch.capacity = input.capacity;
      }
      if (input.carryForward !== undefined) {
        patch.carryForward = input.carryForward;
      }

      await tx
        .update(keyResults)
        .set(patch)
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.id, input.id),
          ),
        );

      await recompute(tx, workspaceId, owner.goalId);
      // Editing a key result changes its own verdicts and the set's.
      await recomputeGoalQualityInTx(tx, {
        workspaceId,
        goalId: owner.goalId,
      });

      return {
        result: { id: input.id },
        activity: {
          kind: "key_result.updated",
          subjectType: "goal",
          subjectId: owner.goalId,
          payload: {},
        },
        audit: {
          action: "goals.updateKeyResult",
          targetType: "key_result",
          targetId: input.id,
          payload: {
            keys: Object.keys(patch).filter((key) => key !== "updatedAt"),
          },
        },
      };
    },
  }),
});

export const recordKeyResultValue = defineWriteAction({
  name: "goals.recordValue",
  summary: "Moves a key result's value and records the movement as history.",
  input: z.object({
    id: z.uuid(),
    value: z.number(),
    note: z.string().trim().max(500).optional(),
  }),
  output: z.object({ id: z.uuid(), value: z.number() }),
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
            eq(keyResults.id, input.id),
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

      await recordValueInTx(tx, {
        workspaceId,
        keyResultId: input.id,
        value: input.value,
        source: "manual",
        authorMemberId: memberId,
        note: input.note ?? null,
      });

      await recompute(tx, workspaceId, owner.goalId);

      return {
        result: { id: input.id, value: input.value },
        activity: {
          kind: "key_result.value_recorded",
          subjectType: "goal",
          subjectId: owner.goalId,
          payload: { value: input.value },
        },
        audit: {
          action: "goals.recordValue",
          targetType: "key_result",
          targetId: input.id,
          payload: { value: input.value },
        },
      };
    },
  }),
});

export const unlinkKeyResultKpi = defineWriteAction({
  name: "goals.unlinkKpi",
  summary: "Unlinks a KPI, keeping the value it last reported as a manual one.",
  input: z.object({ id: z.uuid() }),
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
            eq(keyResults.id, input.id),
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

      await unlinkKpiInTx(tx, {
        workspaceId,
        keyResultId: input.id,
        authorMemberId: memberId,
      });

      await recompute(tx, workspaceId, owner.goalId);

      return {
        result: { id: input.id },
        activity: {
          kind: "key_result.kpi_unlinked",
          subjectType: "goal",
          subjectId: owner.goalId,
          payload: {},
        },
        audit: {
          action: "goals.unlinkKpi",
          targetType: "key_result",
          targetId: input.id,
          payload: {},
        },
      };
    },
  }),
});

/**
 * Removes a goal (P4-T14b-a).
 *
 * **Not the same thing as closing one, and the difference matters.**
 * `goals.close` is the end of a cycle: an outcome, a keep-or-abandon decision
 * and a retrospective, all of which are a record of work that happened. This is
 * for a goal that should not exist, which until now the product had no way to
 * say. The column has always been there; nothing wrote it.
 *
 * The reason it exists now is undo. A copilot proposal that creates an
 * objective needs a reverse, and closing the objective would file a false
 * report about a quarter. Agung approved adding it on 26 August 2026, because
 * an action that removes something a person can see is a product decision and
 * not a mechanism.
 *
 * **Soft, and `full`.** Soft because that is this repository's default scope, so
 * the row stays where every audit and activity row that points at it can still
 * find it. `full` because removal is not an editing right: a champion may
 * change their objective and only an administrator may make it not have
 * existed. `destructive` in the registry, which is what the safety class is for.
 *
 * Its key results go with it. A key result whose goal is gone is a measure of
 * nothing, and leaving them behind would put orphans in every list that reads
 * key results without their goal.
 */
export const deleteGoal = defineWriteAction({
  name: "goals.delete",
  summary:
    "Removes a goal and its key results, which is not the same as closing one.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  safety: "destructive",
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      // Through the getter, so a goal this member cannot see reads as absent
      // rather than as refused.
      await requireGoalAccess(
        tx,
        workspaceId,
        memberId,
        input.id,
        ACCESS_LEVELS.full,
      );

      const [goal] = await tx
        .select({ title: goals.title, level: goals.level })
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
        throw new OperationError("not_found", "No such goal.");
      }

      const now = new Date();
      // openokr:allow-mutation: the operation's own execute.
      await tx
        .update(keyResults)
        .set({ deletedAt: now })
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.goalId, input.id),
          ),
        );
      await tx
        .update(goals)
        .set({ deletedAt: now })
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            eq(goals.id, input.id),
          ),
        );

      return {
        result: { id: input.id },
        activity: {
          kind: "goal.deleted",
          subjectType: "goal",
          subjectId: input.id,
          // The title travels because the feed entry has to read as a sentence
          // after the thing it names is gone, which is exactly this case.
          payload: { title: goal.title },
        },
        audit: {
          action: "goals.delete",
          targetType: "goal",
          targetId: input.id,
          payload: { title: goal.title, level: goal.level },
        },
      };
    },
  }),
});

/**
 * The rewrite assist (METHOD.md §4, P4-T06c).
 *
 * **A read action, so it commits nothing.** The whole point of an assist is
 * that a writer sees a suggestion and decides; a version that saved would be an
 * agent writing under somebody else's name, which is the line
 * propose-and-approve draws.
 *
 * **The product checks the rewrite; the model does not get to claim it.** A
 * model asked to fix KR-2 will say it fixed KR-2 whatever it wrote. So the
 * suggestion is run back through §4's own evaluation and the response reports
 * which previously-failing checks now pass, from the catalogue rather than from
 * the model. An assist that did not fix the rule says so.
 */
export const rewriteKeyResult = defineReadAction({
  name: "goals.rewriteKeyResult",
  summary:
    "Suggests a corrected key result for one failing check, and reports which checks the suggestion actually passes.",
  input: z.object({
    keyResultId: z.uuid(),
    /** The §4 check id to fix, for example `KR-2`. */
    ruleId: z.string().trim().min(1).max(20),
  }),
  output: z
    .object({
      /** The suggested sentence. */
      text: z.string(),
      /** Checks that failed before and pass now, by their §4 ids. */
      nowPassing: z.array(z.string()),
      /** True when the named rule is among them. */
      fixesTheRule: z.boolean(),
    })
    .nullable(),
  access: ACCESS_LEVELS.edit,
  async handler(context, input) {
    const userId = context.actor.userId;
    // Absent means the provider is off. Null rather than an error: the surface
    // explains the state instead of showing a failure.
    const drafter = context.drafter;
    if (!userId || !drafter) {
      return null;
    }

    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as WorkspaceTx;
        const [row] = await tx
          .select({
            id: keyResults.id,
            title: keyResults.title,
            goalId: keyResults.goalId,
            baselineValue: keyResults.baselineValue,
            targetValue: keyResults.targetValue,
            dueOn: keyResults.dueOn,
            ownerId: keyResults.ownerId,
            indicatorType: keyResults.indicatorType,
            direction: keyResults.direction,
            confidence: keyResults.confidence,
          })
          .from(keyResults)
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, context.workspaceId),
              eq(keyResults.id, input.keyResultId),
            ),
          )
          .limit(1);
        if (!row) {
          throw new OperationError("not_found", "No such key result.");
        }

        const [goal] = await tx
          .select({ title: goals.title })
          .from(goals)
          .where(activeOnly(goals, eq(goals.id, row.goalId)))
          .limit(1);

        const check = KEY_RESULT_CHECKS.find(
          (entry: { id: string }) => entry.id === input.ruleId,
        );
        if (!check) {
          throw new OperationError(
            "forbidden",
            `\`${input.ruleId}\` is not a check the method package defines.`,
          );
        }

        const thresholds = resolveRhythm(
          await readRhythmRow(tx, context.workspaceId),
        ).thresholds;
        const asInput = (text: string): KeyResultInput => ({
          text,
          baseline: Number(row.baselineValue),
          target: Number(row.targetValue),
          dueOn: row.dueOn,
          ownerId: row.ownerId,
          indicatorType: row.indicatorType,
          direction: row.direction,
          confidence: row.confidence === null ? null : Number(row.confidence),
        });

        const failingBefore = new Set(
          evaluateKeyResults({ keyResults: [asInput(row.title)] }, thresholds)
            .filter((verdict: { status: string }) => verdict.status !== "pass")
            .map((verdict: { id: string }) => verdict.id),
        );

        let suggestion: string | null = null;
        try {
          suggestion =
            (await drafter.rewriteForRule?.({
              text: row.title,
              ruleId: check.id,
              // The catalogue's own words for the failing condition, so the
              // model is told the rule rather than a paraphrase of it.
              rulePrompt:
                check.conditions.find(
                  (condition: { status: string }) =>
                    condition.status !== "pass",
                )?.prompt ?? check.title,
              goalTitle: goal?.title ?? "",
            })) ?? null;
        } catch {
          // A model having a bad minute is not a reason to show an error where
          // a suggestion would have been. The surface says nothing was
          // suggested, which is true.
          suggestion = null;
        }
        if (!suggestion) {
          return null;
        }

        // §4 run over the model's own output. This is the part that makes the
        // response honest rather than optimistic.
        const nowPassing = [...failingBefore].filter((id) =>
          evaluateKeyResults(
            { keyResults: [asInput(suggestion)] },
            thresholds,
          ).some(
            (verdict: { id: string; status: string }) =>
              verdict.id === id && verdict.status === "pass",
          ),
        );

        return {
          text: suggestion,
          nowPassing,
          fixesTheRule: nowPassing.includes(check.id),
        };
      },
    );
  },
});
