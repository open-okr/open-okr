/**
 * One tree and one-field writes for the OKR list, drawer and diagram
 * (P9-T06a, docs/design/p9-t00-okr-writing.md §6).
 *
 * `goals.tree` reads a cycle's objectives, their key results, their alignment
 * and their dependencies in one call, shaped for both views, with every parent
 * that falls outside what it returns as read-only context: an annual objective
 * a quarter's objectives hang under, most often.
 *
 * `goals.patch` and `goals.patchKeyResult` change a few fields at once and
 * refuse a write made from a stale read. **The token is the values the caller
 * read**, sent beside the values it wants, field by field. A revision number on
 * the row was the alternative and was not taken: every write that changes a
 * field would have to bump it, and one that forgot would let an edit through
 * silently. `updated_at` was not usable either, because a value recorded or a
 * child's roll-up moves it, and a title edit would then fail for a reason that
 * has nothing to do with the title. Comparing what was read with what is
 * stored needs nothing of any other write path and conflicts only on the
 * fields that actually moved.
 */
import {
  activeOnly,
  activities,
  cycles,
  GOAL_HEALTH,
  GOAL_KINDS,
  GOAL_LEVELS,
  goalDependencies,
  goals,
  INDICATOR_TYPES,
  KEY_RESULT_DIRECTIONS,
  KEY_RESULT_KINDS,
  keyResults,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped, visibleResourceIds } from "../access/reads.ts";
import { daysPastDue, dueLocalDate } from "../cadence/service.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow, workspaceTimeZone } from "../cycles/service.ts";
import {
  asNumber,
  clampWeight,
  doneAtFor,
  reassignRoleInTx,
  requireActiveMember,
} from "../goals/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { policyDecisionInTx, requirePolicy } from "../practice/policy.ts";
import {
  recomputeGoalQualityInTx,
  recomputeUnitQualityInTx,
} from "../quality/service.ts";
import { recomputeForGoal } from "../scoring/recompute.ts";
import { recomputeAlignmentFor } from "./alignment.ts";
import { selectInChunks } from "./chunk.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date as YYYY-MM-DD.");

const person = z.object({ id: z.uuid(), name: z.string() });

const treeKeyResult = z.object({
  id: z.uuid(),
  goalId: z.uuid(),
  title: z.string(),
  unit: z.string().nullable(),
  /** Metric, maintain, milestone or baseline (METHOD.md §2.10, P9-T12b). */
  kind: z.enum(KEY_RESULT_KINDS),
  /** When a milestone was done or a baseline recorded, or null. */
  doneAt: z.string().nullable(),
  direction: z.enum(KEY_RESULT_DIRECTIONS),
  /** What KR-4 and KR-5 judge, so a screen can coach as the server does. */
  indicatorType: z.enum(INDICATOR_TYPES),
  baselineValue: z.number(),
  targetValue: z.number(),
  currentValue: z.number(),
  dueOn: z.string().nullable(),
  owner: person.nullable(),
  weight: z.number(),
  kpiId: z.uuid().nullable(),
  progressPct: z.number(),
  confidence: z.number().nullable(),
  qualityFlags: z.array(z.string()),
  position: z.number().int(),
});

export const treeGoal = z.object({
  id: z.uuid(),
  title: z.string(),
  cycleId: z.uuid().nullable(),
  level: z.enum(GOAL_LEVELS),
  /** Committed or aspirational (METHOD.md §2.8, P9-T11b-a). */
  kind: z.enum(GOAL_KINDS),
  spaceId: z.uuid().nullable(),
  champion: person,
  reviewer: person.nullable(),
  parentGoalId: z.uuid().nullable(),
  parentKeyResultId: z.uuid().nullable(),
  weight: z.number(),
  contributionStatement: z.string().nullable(),
  progressPct: z.number(),
  health: z.enum(GOAL_HEALTH),
  closedAt: z.string().nullable(),
  nextCheckInOn: z.string().nullable(),
  daysPastDue: z.number().int().nullable(),
  position: z.number().int(),
  quality: z.object({
    score: z.number().nullable(),
    flags: z.array(z.string()),
  }),
  keyResults: z.array(treeKeyResult),
});

/** A parent outside the set the tree returns. Read-only on both views. */
const contextGoal = z.object({
  id: z.uuid(),
  title: z.string(),
  level: z.enum(GOAL_LEVELS),
  cycleId: z.uuid().nullable(),
  /** The cycle's own name, so "Annual 2027" can head the band it draws. */
  cycleName: z.string().nullable(),
  /** False for a parent in this cycle that the scope left out. */
  otherCycle: z.boolean(),
  progressPct: z.number(),
  keyResults: z.array(z.object({ id: z.uuid(), title: z.string() })),
});

type TreeGoal = z.infer<typeof treeGoal>;

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

async function memberNames(
  tx: OperationTx,
  workspaceId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const rows = await selectInChunks([...new Set(ids)], (batch) =>
    tx
      .select({ id: workspaceMembers.id, name: workspaceMembers.name })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.workspaceId, workspaceId),
          inArray(workspaceMembers.id, batch),
        ),
      ),
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}

const GOAL_COLUMNS = {
  id: goals.id,
  title: goals.title,
  cycleId: goals.cycleId,
  level: goals.level,
  kind: goals.kind,
  spaceId: goals.spaceId,
  championId: goals.championId,
  reviewerId: goals.reviewerId,
  parentGoalId: goals.parentGoalId,
  parentKeyResultId: goals.parentKeyResultId,
  weight: goals.weight,
  contributionStatement: goals.contributionStatement,
  progressPct: goals.progressPct,
  health: goals.health,
  closedAt: goals.closedAt,
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
  kind: keyResults.kind,
  doneAt: keyResults.doneAt,
  direction: keyResults.direction,
  indicatorType: keyResults.indicatorType,
  baselineValue: keyResults.baselineValue,
  targetValue: keyResults.targetValue,
  currentValue: keyResults.currentValue,
  dueOn: keyResults.dueOn,
  ownerId: keyResults.ownerId,
  weight: keyResults.weight,
  kpiId: keyResults.kpiId,
  progressPct: keyResults.progressPct,
  confidence: keyResults.confidence,
  qualityFlags: keyResults.qualityFlags,
  position: keyResults.position,
} as const;

/**
 * Shapes goal rows, already access-filtered, into tree nodes with their key
 * results and names. Shared by the read and by both patches, so a patch hands
 * back exactly the node the tree would have, recomputed numbers included.
 */
async function treeNodes(
  tx: OperationTx,
  workspaceId: string,
  rows: readonly {
    readonly id: string;
    readonly title: string;
    readonly cycleId: string | null;
    readonly level: (typeof GOAL_LEVELS)[number];
    readonly kind: (typeof GOAL_KINDS)[number];
    readonly spaceId: string | null;
    readonly championId: string;
    readonly reviewerId: string | null;
    readonly parentGoalId: string | null;
    readonly parentKeyResultId: string | null;
    readonly weight: string;
    readonly contributionStatement: string | null;
    readonly progressPct: string;
    readonly health: (typeof GOAL_HEALTH)[number];
    readonly closedAt: Date | null;
    readonly nextCheckInAt: Date | null;
    readonly position: number;
    readonly qualityScore: string | number | null;
    readonly qualityFlags: string[];
  }[],
): Promise<TreeGoal[]> {
  const ids = rows.map((row) => row.id);
  const children = await selectInChunks(ids, (batch) =>
    tx
      .select(KEY_RESULT_COLUMNS)
      .from(keyResults)
      .where(
        activeOnly(
          keyResults,
          eq(keyResults.workspaceId, workspaceId),
          inArray(keyResults.goalId, batch),
        ),
      )
      .orderBy(asc(keyResults.position), asc(keyResults.id)),
  );
  const names = await memberNames(tx, workspaceId, [
    ...rows.flatMap((row) =>
      row.reviewerId ? [row.championId, row.reviewerId] : [row.championId],
    ),
    ...children.flatMap((child) => (child.ownerId ? [child.ownerId] : [])),
  ]);
  const named = (id: string) => ({ id, name: names.get(id) ?? "Unknown" });
  const timeZone = await workspaceTimeZone(tx, workspaceId);
  const now = new Date();

  const byGoal = new Map<string, (typeof children)[number][]>();
  for (const child of children) {
    byGoal.set(child.goalId, [...(byGoal.get(child.goalId) ?? []), child]);
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    cycleId: row.cycleId,
    level: row.level,
    kind: row.kind,
    spaceId: row.spaceId,
    champion: named(row.championId),
    reviewer: row.reviewerId ? named(row.reviewerId) : null,
    parentGoalId: row.parentGoalId,
    parentKeyResultId: row.parentKeyResultId,
    weight: asNumber(row.weight) ?? 0,
    contributionStatement: row.contributionStatement,
    progressPct: asNumber(row.progressPct) ?? 0,
    health: row.health,
    closedAt: row.closedAt ? new Date(row.closedAt).toISOString() : null,
    nextCheckInOn: dueLocalDate(row.nextCheckInAt, timeZone),
    daysPastDue: daysPastDue(row.nextCheckInAt, now, timeZone),
    position: row.position,
    quality: {
      score: asNumber(row.qualityScore),
      flags: [...row.qualityFlags],
    },
    keyResults: (byGoal.get(row.id) ?? []).map((child) => ({
      id: child.id,
      goalId: child.goalId,
      title: child.title,
      unit: child.unit,
      kind: child.kind,
      doneAt: child.doneAt ? new Date(child.doneAt).toISOString() : null,
      direction: child.direction,
      indicatorType: child.indicatorType,
      baselineValue: asNumber(child.baselineValue) ?? 0,
      targetValue: asNumber(child.targetValue) ?? 0,
      currentValue: asNumber(child.currentValue) ?? 0,
      dueOn: child.dueOn,
      owner: child.ownerId ? named(child.ownerId) : null,
      weight: asNumber(child.weight) ?? 0,
      kpiId: child.kpiId,
      progressPct: asNumber(child.progressPct) ?? 0,
      confidence: asNumber(child.confidence),
      qualityFlags: [...child.qualityFlags],
      position: child.position,
    })),
  }));
}

/** One goal's node, read after a write so the caller can merge it. */
export async function treeNode(
  tx: OperationTx,
  workspaceId: string,
  goalId: string,
): Promise<TreeGoal> {
  const rows = await tx
    .select(GOAL_COLUMNS)
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.id, goalId),
      ),
    )
    .limit(1);
  const [node] = await treeNodes(tx, workspaceId, rows);
  if (!node) {
    throw new OperationError("not_found", "No such goal.");
  }
  return node;
}

export const readGoalTree = defineReadAction({
  name: "goals.tree",
  summary:
    "One cycle's objectives with their key results, alignment and dependencies, shaped for the OKR list and diagram, with parents outside the set as read-only context.",
  input: z.object({
    cycleId: z.uuid(),
    /**
     * "mine" is the objectives this member champions or reviews, or owns a key
     * result under. Always about the person asking, never an id in the URL.
     */
    scope: z.enum(["all", "mine"]).optional(),
    /** One space's objectives. A filter, not an access control. */
    spaceId: z.uuid().optional(),
    /** Closed objectives are left out unless asked for. */
    includeClosed: z.boolean().optional(),
  }),
  output: z.object({
    cycle: z.object({
      id: z.uuid(),
      name: z.string(),
      mode: z.string(),
      startsOn: z.string(),
      endsOn: z.string(),
    }),
    goals: z.array(treeGoal),
    context: z.array(contextGoal),
    dependencies: z.array(
      z.object({ id: z.uuid(), fromGoalId: z.uuid(), toGoalId: z.uuid() }),
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
        const workspaceId = context.workspaceId;
        const memberId = await actingMember(tx, workspaceId, userId);

        const [cycle] = await tx
          .select({
            id: cycles.id,
            name: cycles.name,
            mode: cycles.mode,
            startsOn: cycles.startsOn,
            endsOn: cycles.endsOn,
          })
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

        const filters = [
          eq(goals.workspaceId, workspaceId),
          eq(goals.cycleId, input.cycleId),
        ];
        if (input.spaceId) {
          filters.push(eq(goals.spaceId, input.spaceId));
        }
        if (!input.includeClosed) {
          filters.push(isNull(goals.closedAt));
        }
        if (input.scope === "mine") {
          // Owning a key result under an objective is answering for part of
          // it, so it counts as much as championing or reviewing it.
          const owned = tx
            .select({ goalId: keyResults.goalId })
            .from(keyResults)
            .where(
              activeOnly(
                keyResults,
                eq(keyResults.workspaceId, workspaceId),
                eq(keyResults.ownerId, memberId),
              ),
            );
          filters.push(
            or(
              eq(goals.championId, memberId),
              eq(goals.reviewerId, memberId),
              inArray(goals.id, owned),
            ) as never,
          );
        }

        const rows = await tx
          .select(GOAL_COLUMNS)
          .from(goals)
          .where(activeOnly(goals, ...filters))
          .orderBy(asc(goals.position), asc(goals.id));
        // The one chokepoint, applied to the whole set in one statement, as
        // `goals.list` does (P7-T01b).
        const allowed = await visibleResourceIds(tx, {
          workspaceId,
          memberId,
          resourceType: "goal",
          ids: rows.map((row) => row.id),
          requires: ACCESS_LEVELS.view,
        });
        const visible = rows.filter((row) => allowed.has(row.id));
        const nodes = await treeNodes(tx, workspaceId, visible);
        const inSet = new Set(nodes.map((node) => node.id));

        // Parents outside the set: through a key result too, because aligning
        // to an annual key result hangs the objective under its goal.
        const parentKeyResultIds = [
          ...new Set(
            nodes.flatMap((node) =>
              node.parentKeyResultId ? [node.parentKeyResultId] : [],
            ),
          ),
        ];
        const viaKeyResult = await selectInChunks(parentKeyResultIds, (batch) =>
          tx
            .select({ goalId: keyResults.goalId })
            .from(keyResults)
            .where(
              activeOnly(
                keyResults,
                eq(keyResults.workspaceId, workspaceId),
                inArray(keyResults.id, batch),
              ),
            ),
        );
        const outside = [
          ...new Set([
            ...nodes.flatMap((node) =>
              node.parentGoalId ? [node.parentGoalId] : [],
            ),
            ...viaKeyResult.map((row) => row.goalId),
          ]),
        ].filter((id) => !inSet.has(id));
        const parentRows = await selectInChunks(outside, (batch) =>
          tx
            .select({
              id: goals.id,
              title: goals.title,
              level: goals.level,
              cycleId: goals.cycleId,
              progressPct: goals.progressPct,
              cycleName: cycles.name,
            })
            .from(goals)
            .leftJoin(cycles, eq(cycles.id, goals.cycleId))
            .where(
              activeOnly(
                goals,
                eq(goals.workspaceId, workspaceId),
                inArray(goals.id, batch),
              ),
            ),
        );
        // A parent the reader cannot see stays unseen; the child still says
        // it has one, as it does everywhere else.
        const parentsAllowed = await visibleResourceIds(tx, {
          workspaceId,
          memberId,
          resourceType: "goal",
          ids: parentRows.map((row) => row.id),
          requires: ACCESS_LEVELS.view,
        });
        const parents = parentRows.filter((row) => parentsAllowed.has(row.id));
        const parentKeyResults = await selectInChunks(
          parents.map((row) => row.id),
          (batch) =>
            tx
              .select({
                id: keyResults.id,
                title: keyResults.title,
                goalId: keyResults.goalId,
              })
              .from(keyResults)
              .where(
                activeOnly(
                  keyResults,
                  eq(keyResults.workspaceId, workspaceId),
                  inArray(keyResults.goalId, batch),
                ),
              )
              .orderBy(asc(keyResults.position), asc(keyResults.id)),
        );

        const dependencies = await selectInChunks([...inSet], (batch) =>
          tx
            .select({
              id: goalDependencies.id,
              fromGoalId: goalDependencies.fromGoalId,
              toGoalId: goalDependencies.toGoalId,
            })
            .from(goalDependencies)
            .where(
              activeOnly(
                goalDependencies,
                eq(goalDependencies.workspaceId, workspaceId),
                or(
                  inArray(goalDependencies.fromGoalId, batch),
                  inArray(goalDependencies.toGoalId, batch),
                ) as never,
              ),
            ),
        );
        // Drawn only between two objectives on screen or in the context, so
        // an edge never points at something the reader cannot see.
        const drawn = new Set([...inSet, ...parents.map((row) => row.id)]);
        const seenDependency = new Set<string>();

        return {
          cycle,
          goals: nodes,
          context: parents.map((row) => ({
            id: row.id,
            title: row.title,
            level: row.level,
            cycleId: row.cycleId,
            cycleName: row.cycleName,
            otherCycle: row.cycleId !== input.cycleId,
            progressPct: asNumber(row.progressPct) ?? 0,
            keyResults: parentKeyResults
              .filter((child) => child.goalId === row.id)
              .map((child) => ({ id: child.id, title: child.title })),
          })),
          dependencies: dependencies.filter((row) => {
            if (seenDependency.has(row.id)) {
              return false;
            }
            seenDependency.add(row.id);
            return drawn.has(row.fromGoalId) && drawn.has(row.toGoalId);
          }),
        };
      },
    );
  },
});

/**
 * Whether a new objective may be written in a cycle now, and why not
 * (P9-T07b-a, design §3 "+ New objective"). The same decision the write asks
 * for, read ahead of it, so a screen opens a panel naming the reason rather
 * than a field the server will refuse, and the button is never inert.
 */
export const readCreationPolicy = defineReadAction({
  name: "goals.creationPolicy",
  summary:
    "Whether a new objective may be written in a cycle now, with the practice's reasons and the settings behind them when it may not.",
  input: z.object({ cycleId: z.uuid() }),
  output: z.object({
    allowed: z.boolean(),
    reasons: z.array(z.string()),
    rules: z.array(z.string()),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        await getAccessScoped(tx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });
        const decision = await policyDecisionInTx(tx, context.workspaceId, {
          kind: "objective.create",
          cycleId: input.cycleId,
        });
        return {
          allowed: decision.outcome === "allow",
          reasons: [...decision.reasons],
          rules: [...decision.rules],
        };
      },
    );
  },
});

/** Who last changed a goal or one of its key results, for a conflict. */
async function lastChange(
  tx: OperationTx,
  workspaceId: string,
  goalId: string,
): Promise<{ changedBy: string | null; changedAt: string | null }> {
  const [row] = await tx
    .select({ at: activities.at, name: workspaceMembers.name })
    .from(activities)
    .leftJoin(
      workspaceMembers,
      eq(workspaceMembers.id, activities.actorMemberId),
    )
    .where(
      and(
        eq(activities.workspaceId, workspaceId),
        eq(activities.subjectType, "goal"),
        eq(activities.subjectId, goalId),
      ),
    )
    .orderBy(desc(activities.at))
    .limit(1);
  return {
    changedBy: row?.name ?? null,
    changedAt: row?.at ? new Date(row.at).toISOString() : null,
  };
}

/** Boolean for a milestone's done (P9-T12b), compared as it is. */
type Comparable = string | number | boolean | null;

/** Equal as the screen means it: numbers by value, blank text as nothing. */
function sameField(read: Comparable, stored: Comparable): boolean {
  if (typeof read === "number" || typeof stored === "number") {
    return Number(read) === Number(stored);
  }
  const blank = (value: Comparable) =>
    typeof value === "string" && value.trim() === "" ? null : value;
  return blank(read) === blank(stored);
}

/**
 * Refuses when any field the caller changes has moved since it read it.
 *
 * Only the fields being changed are compared. Somebody else renaming the
 * objective does not stop this caller moving its weight, which is the point
 * of comparing values rather than a row version.
 */
async function requireUnchanged(
  tx: OperationTx,
  workspaceId: string,
  goalId: string,
  read: Readonly<Record<string, Comparable>>,
  stored: Readonly<Record<string, Comparable>>,
): Promise<void> {
  const moved = Object.keys(read).filter(
    (key) => !sameField(read[key] ?? null, stored[key] ?? null),
  );
  if (moved.length === 0) {
    return;
  }
  const { changedBy, changedAt } = await lastChange(tx, workspaceId, goalId);
  const current = Object.fromEntries(moved.map((key) => [key, stored[key]]));
  const now = moved
    .map((key) => `${key} is now ${JSON.stringify(stored[key])}`)
    .join(", ");
  throw new OperationError(
    "conflict",
    `${changedBy ?? "Somebody"} changed this since you read it: ${now}. Nothing was saved; keep yours by sending it again with the current value.`,
    { current, changedBy, changedAt },
  );
}

const goalFields = z.object({
  title: z.string().trim().min(1).max(500),
  contributionStatement: z.string().trim().max(1000).nullable(),
  weight: z.number(),
  championId: z.uuid(),
});

const keyResultFields = z.object({
  title: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(60).nullable(),
  baselineValue: z.number(),
  dueOn: localDate.nullable(),
  ownerId: z.uuid().nullable(),
  weight: z.number(),
  /** Metric, maintain, milestone or baseline (METHOD.md §2.10, P9-T12b). */
  kind: z.enum(KEY_RESULT_KINDS),
  /** A milestone done or a baseline recorded; false undoes it. */
  done: z.boolean(),
});

/**
 * `set` and the `read` it was made from, with every changed field read.
 *
 * Read values are loose on purpose: a value is compared with what is stored,
 * not validated as input, and a title read before a length rule tightened
 * must still be comparable.
 */
function patchInput<T extends z.ZodRawShape>(fields: z.ZodObject<T>) {
  const readable = z.union([z.string(), z.number(), z.boolean(), z.null()]);
  return z
    .object({
      id: z.uuid(),
      set: fields.partial(),
      read: z.record(z.string(), readable),
    })
    .refine((value) => Object.keys(value.set).length > 0, {
      message: "Name at least one field to change.",
      path: ["set"],
    })
    .refine(
      (value) => Object.keys(value.set).every((key) => key in value.read),
      {
        message:
          "Send the value you read for every field you change, so a change made since can be found.",
        path: ["read"],
      },
    );
}

export const patchGoal = defineWriteAction({
  name: "goals.patch",
  // openokr:policy-exempt: changing an objective that exists stays open under every setting (METHOD.md §2.9), and its target changes go through goals.changeTarget.
  summary:
    "Changes some of an objective's fields, refused with the current values if any of them changed since the caller read them.",
  input: patchInput(goalFields),
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
      // Naming the champion is administering the goal, as goals.reassignRole
      // says; every other field here is editing it.
      const { contextId } = await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "goal",
        resourceId: input.id,
        requires:
          input.set.championId === undefined
            ? ACCESS_LEVELS.edit
            : ACCESS_LEVELS.full,
      });

      const [row] = await tx
        .select({
          title: goals.title,
          contributionStatement: goals.contributionStatement,
          weight: goals.weight,
          championId: goals.championId,
        })
        .from(goals)
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            eq(goals.id, input.id),
          ),
        )
        .for("update")
        .limit(1);
      if (!row) {
        throw new OperationError("not_found", "No such goal.");
      }
      await requireUnchanged(
        tx,
        workspaceId,
        input.id,
        Object.fromEntries(
          Object.keys(input.set).map((key) => [key, input.read[key] ?? null]),
        ),
        {
          title: row.title,
          contributionStatement: row.contributionStatement,
          weight: asNumber(row.weight),
          championId: row.championId,
        },
      );

      const patch: Record<string, unknown> = {};
      if (input.set.title !== undefined) {
        patch.title = input.set.title;
      }
      if (input.set.contributionStatement !== undefined) {
        patch.contributionStatement =
          input.set.contributionStatement?.trim() || null;
      }
      if (input.set.weight !== undefined) {
        patch.weight = String(clampWeight(input.set.weight));
      }
      if (Object.keys(patch).length > 0) {
        await tx
          .update(goals)
          .set({ ...patch, updatedAt: new Date() })
          .where(
            activeOnly(
              goals,
              eq(goals.workspaceId, workspaceId),
              eq(goals.id, input.id),
            ),
          );
      }
      if (
        input.set.championId !== undefined &&
        input.set.championId !== row.championId
      ) {
        await reassignRoleInTx(tx, {
          workspaceId,
          goalId: input.id,
          contextId,
          role: "champion",
          fromMemberId: row.championId,
          toMemberId: input.set.championId,
        });
      }

      const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
      await recomputeForGoal(tx, workspaceId, input.id, rhythm.thresholds);
      await recomputeUnitQualityInTx(tx, { workspaceId, goalId: input.id });
      const [placed] = await tx
        .select({ cycleId: goals.cycleId, spaceId: goals.spaceId })
        .from(goals)
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            eq(goals.id, input.id),
          ),
        )
        .limit(1);
      if (placed) {
        // The contribution statement is part of what alignment reads.
        await recomputeAlignmentFor(tx, workspaceId, [placed]);
      }

      const keys = Object.keys(input.set);
      return {
        result: { goal: await treeNode(tx, workspaceId, input.id) },
        activity: {
          kind: "goal.updated",
          subjectType: "goal",
          subjectId: input.id,
          payload: { title: input.set.title ?? row.title, keys },
        },
        audit: {
          action: "goals.patch",
          targetType: "goal",
          targetId: input.id,
          payload: { keys },
        },
      };
    },
  }),
});

export const patchKeyResult = defineWriteAction({
  name: "goals.patchKeyResult",
  // openokr:policy-exempt: changing a key result that exists stays open under every setting (METHOD.md §2.9); its target is not among these fields and goes through goals.changeTarget, and a kind it is given asks the policy here (P9-T12b).
  summary:
    "Changes some of a key result's fields, refused with the current values if any of them changed since the caller read them. The target and the current value have their own actions.",
  input: patchInput(keyResultFields),
  output: z.object({ goal: treeGoal }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const [row] = await tx
        .select({
          goalId: keyResults.goalId,
          title: keyResults.title,
          unit: keyResults.unit,
          baselineValue: keyResults.baselineValue,
          dueOn: keyResults.dueOn,
          ownerId: keyResults.ownerId,
          weight: keyResults.weight,
          kind: keyResults.kind,
          doneAt: keyResults.doneAt,
        })
        .from(keyResults)
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.id, input.id),
          ),
        )
        .for("update")
        .limit(1);
      if (!row) {
        throw new OperationError("not_found", "No such key result.");
      }
      await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "goal",
        resourceId: row.goalId,
        requires: ACCESS_LEVELS.edit,
      });
      if (input.set.ownerId) {
        await requireActiveMember(
          tx,
          workspaceId,
          input.set.ownerId,
          "key result owner",
        );
      }
      await requireUnchanged(
        tx,
        workspaceId,
        row.goalId,
        Object.fromEntries(
          Object.keys(input.set).map((key) => [key, input.read[key] ?? null]),
        ),
        {
          title: row.title,
          unit: row.unit,
          baselineValue: asNumber(row.baselineValue),
          dueOn: row.dueOn,
          ownerId: row.ownerId,
          weight: asNumber(row.weight),
          kind: row.kind,
          done: row.doneAt !== null,
        },
      );
      if (input.set.kind !== undefined && input.set.kind !== row.kind) {
        await requirePolicy(
          tx,
          { workspaceId, bulk: context.bulk },
          { kind: "keyResult.kind", keyResultKind: input.set.kind },
        );
      }
      const doneAt = doneAtFor(
        input.set.kind ?? row.kind,
        row.doneAt,
        input.set.done,
      );

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.set.kind !== undefined) {
        patch.kind = input.set.kind;
      }
      if (doneAt !== row.doneAt) {
        patch.doneAt = doneAt;
      }
      if (input.set.title !== undefined) {
        patch.title = input.set.title;
      }
      if (input.set.unit !== undefined) {
        patch.unit = input.set.unit?.trim() || null;
      }
      if (input.set.baselineValue !== undefined) {
        patch.baselineValue = String(input.set.baselineValue);
      }
      if (input.set.dueOn !== undefined) {
        patch.dueOn = input.set.dueOn;
      }
      if (input.set.ownerId !== undefined) {
        patch.ownerId = input.set.ownerId;
      }
      if (input.set.weight !== undefined) {
        patch.weight = String(clampWeight(input.set.weight));
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

      const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
      await recomputeForGoal(tx, workspaceId, row.goalId, rhythm.thresholds);
      await recomputeGoalQualityInTx(tx, { workspaceId, goalId: row.goalId });

      const keys = Object.keys(input.set);
      return {
        result: { goal: await treeNode(tx, workspaceId, row.goalId) },
        activity: {
          kind: "key_result.updated",
          subjectType: "goal",
          subjectId: row.goalId,
          payload: { keys },
        },
        audit: {
          action: "goals.patchKeyResult",
          targetType: "key_result",
          targetId: input.id,
          payload: { keys },
        },
      };
    },
  }),
});

/**
 * Puts `id` straight after `afterId` in an ordered set, or first when
 * `afterId` is null. A missing `afterId`, which a stale screen can send,
 * also puts it first rather than refusing a move the reader can see worked.
 */
function placedOrder(
  ids: readonly string[],
  id: string,
  afterId: string | null,
): string[] {
  const rest = ids.filter((entry) => entry !== id);
  const at = afterId === null ? -1 : rest.indexOf(afterId);
  return [...rest.slice(0, at + 1), id, ...rest.slice(at + 1)];
}

/**
 * Writes a set's new positions in one statement, touching only the rows that
 * moved. Renumbered from nought every time, so two members reordering one
 * set never leave two rows on one position.
 */
async function writePositions(
  tx: OperationTx,
  workspaceId: string,
  table: "goals" | "key_results",
  order: readonly string[],
): Promise<void> {
  if (order.length === 0) {
    return;
  }
  const ids = sql.join(
    order.map((id) => sql`${id}`),
    sql`, `,
  );
  // openokr:allow-mutation: inside the operation that called this.
  await tx.execute(sql`
    update ${sql.identifier(table)} as row
       set position = moved.ordinal - 1, updated_at = now()
      from unnest(array[${ids}]::uuid[]) with ordinality as moved(id, ordinal)
     where row.id = moved.id
       and row.workspace_id = ${workspaceId}
       and row.position <> moved.ordinal - 1`);
}

export const placeGoal = defineWriteAction({
  name: "goals.place",
  // openokr:policy-exempt: reordering objectives that exist changes no objective, which stays open under every setting (METHOD.md §2.9).
  summary:
    "Puts an objective straight after another in its cycle, or first, and renumbers the cycle's whole order so a row a filter hides keeps its place.",
  input: z.object({
    id: z.uuid(),
    /** The objective it goes after, or null to put it first. */
    afterId: z.uuid().nullable(),
  }),
  output: z.object({ order: z.array(z.uuid()) }),
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
      const [moved] = await tx
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
      if (!moved?.cycleId) {
        throw new OperationError(
          "not_found",
          "No such objective in a cycle to order.",
        );
      }
      // The whole cycle, closed objectives included, so the order a filter
      // hides is the order it keeps.
      const siblings = await tx
        .select({ id: goals.id })
        .from(goals)
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            eq(goals.cycleId, moved.cycleId),
          ),
        )
        .orderBy(asc(goals.position), asc(goals.id));
      const order = placedOrder(
        siblings.map((row) => row.id),
        input.id,
        input.afterId,
      );
      await writePositions(tx, workspaceId, "goals", order);
      return {
        result: { order },
        activity: {
          kind: "goal.placed",
          subjectType: "goal",
          subjectId: input.id,
          payload: { afterId: input.afterId },
        },
        audit: {
          action: "goals.place",
          targetType: "goal",
          targetId: input.id,
          payload: { afterId: input.afterId },
        },
      };
    },
  }),
});

export const placeKeyResult = defineWriteAction({
  name: "goals.placeKeyResult",
  // openokr:policy-exempt: reordering an objective's key results changes no key result, which stays open under every setting (METHOD.md §2.9).
  summary:
    "Puts a key result straight after another under its objective, or first, and renumbers the objective's key results.",
  input: z.object({
    id: z.uuid(),
    /** The key result it goes after, or null to put it first. */
    afterId: z.uuid().nullable(),
  }),
  output: z.object({ goal: treeGoal }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const [row] = await tx
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
      if (!row) {
        throw new OperationError("not_found", "No such key result.");
      }
      await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "goal",
        resourceId: row.goalId,
        requires: ACCESS_LEVELS.edit,
      });
      const siblings = await tx
        .select({ id: keyResults.id })
        .from(keyResults)
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.goalId, row.goalId),
          ),
        )
        .orderBy(asc(keyResults.position), asc(keyResults.id));
      const order = placedOrder(
        siblings.map((sibling) => sibling.id),
        input.id,
        input.afterId,
      );
      await writePositions(tx, workspaceId, "key_results", order);
      return {
        result: { goal: await treeNode(tx, workspaceId, row.goalId) },
        activity: {
          kind: "key_result.placed",
          subjectType: "goal",
          subjectId: row.goalId,
          payload: { keyResultId: input.id, afterId: input.afterId },
        },
        audit: {
          action: "goals.placeKeyResult",
          targetType: "key_result",
          targetId: input.id,
          payload: { goalId: row.goalId, afterId: input.afterId },
        },
      };
    },
  }),
});
