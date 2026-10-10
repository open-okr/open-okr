/**
 * KPI actions (TECHNICAL-PLAN §4.6, §14, METHOD.md §6, P3-T12).
 *
 * A KPI is owned by the workspace, a space or a member, and its authorisation
 * resolves the way a goal's does: through the access context of whatever owns it.
 * A workspace-owned KPI is readable by every member, which is the same choice
 * §4.1 makes for a company objective, and for the same reason: a metric nobody
 * can see is not a shared measure.
 *
 * The formula, the tree walk and the recovery drafter are P3-T13 and P3-T14. A
 * calculated KPI cannot be created here, because nothing can evaluate one yet and
 * a KPI whose value nobody computes would read `no_data` forever with no way to
 * fix it.
 */

import {
  activeOnly,
  goals,
  KPI_AGGREGATES,
  KPI_DIRECTION_VALUES,
  KPI_FREQUENCY_VALUES,
  KPI_OWNER_KINDS,
  KPI_TIERS,
  keyResults,
  kpiCategories,
  kpiDependencies,
  kpis,
  kpiTrees,
  newId,
  proposedChanges,
  spaces,
  tasks,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { LOCAL_DATE_PATTERN } from "@openokr/formats";
import {
  directionOfTargetType,
  KPI_TARGET_TYPES,
  type KpiDirection,
  type KpiFrequency,
  type KpiTargetType,
  type KpiThresholds,
  normalisePeriod,
  targetTypeOfDirection,
  thresholdsProblem,
} from "@openokr/method";
import { and, asc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ensureContext } from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { bindAgentsToContextInTx } from "../agents/bindings.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow } from "../cycles/service.ts";
import {
  assertLegacyKeyFree,
  legacyColumns,
  legacyKey,
} from "../imports/legacy.ts";
import {
  cascadeFromKpi,
  evaluateKpiForPeriod,
  setKpiFormula,
} from "../kpis/formula.ts";
import { followKpisInTx } from "../kpis/linked.ts";
import { draftRecoveryForKpi, launchRecoveryInTx } from "../kpis/recovery.ts";
import {
  isRecovering,
  KPI_RULE_COLUMNS,
  type KpiRule,
  kpiResponsesInTx,
  loadKpiRecords,
  readingOf,
  recomputeKpi,
  shownState,
  targetTypeOf,
  thresholdsOf,
  upsertKpiRecord,
} from "../kpis/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

/**
 * §6.2's target type and thresholds, as `kpis.create` and `kpis.update` take
 * them (P9-T17a). Each threshold is in the KPI's own units; null clears one,
 * and none at all leaves the KPI on the ratio fallback.
 */
const ruleFields = {
  targetType: z.enum(KPI_TARGET_TYPES).optional(),
  greenLow: z.number().nullable().optional(),
  greenHigh: z.number().nullable().optional(),
  redLow: z.number().nullable().optional(),
  redHigh: z.number().nullable().optional(),
};

type RuleInput = {
  readonly direction?: KpiDirection;
  readonly targetType?: KpiTargetType;
  readonly greenLow?: number | null;
  readonly greenHigh?: number | null;
  readonly redLow?: number | null;
  readonly redHigh?: number | null;
};

const FLIPPED: Readonly<Record<KpiTargetType, KpiTargetType>> = {
  at_least: "at_most",
  at_most: "at_least",
  increase_to: "decrease_to",
  decrease_to: "increase_to",
  range: "range",
};

/**
 * The columns a create or an update writes for a KPI's rule, refused in words
 * when they cannot be judged (§6.2, P9-T17a).
 *
 * A direction alone still works, for a caller written before target types: it
 * picks the type that faces that way. `direction` keeps being written beside
 * the type, because the release before this one reads only that.
 *
 * A type uses only its own thresholds, so changing the type drops the stored
 * ones it does not use. One given explicitly that the type does not use is
 * refused rather than dropped, because the caller meant something by it.
 */
interface RuleColumns {
  readonly targetType: KpiTargetType;
  readonly direction: KpiDirection;
  readonly greenLow: string | null;
  readonly greenHigh: string | null;
  readonly redLow: string | null;
  readonly redHigh: string | null;
}

function ruleWrite(input: RuleInput, existing: KpiRule | null): RuleColumns {
  const before = existing ? targetTypeOf(existing) : null;
  let type: KpiTargetType;
  if (input.targetType !== undefined) {
    type = input.targetType;
  } else if (input.direction !== undefined) {
    type =
      before === null
        ? targetTypeOfDirection(input.direction)
        : directionOfTargetType(before) === input.direction ||
            before === "range"
          ? before
          : FLIPPED[before];
  } else {
    type = before ?? "at_least";
  }

  const stored = existing
    ? thresholdsOf(existing)
    : { greenLow: null, greenHigh: null, redLow: null, redHigh: null };
  const merged: { -readonly [K in keyof KpiThresholds]: number | null } = {
    greenLow: input.greenLow !== undefined ? input.greenLow : stored.greenLow,
    greenHigh:
      input.greenHigh !== undefined ? input.greenHigh : stored.greenHigh,
    redLow: input.redLow !== undefined ? input.redLow : stored.redLow,
    redHigh: input.redHigh !== undefined ? input.redHigh : stored.redHigh,
  };
  const facing = directionOfTargetType(type);
  const unused: readonly (keyof KpiThresholds)[] =
    facing === "higher_better"
      ? ["greenHigh", "redHigh"]
      : facing === "lower_better"
        ? ["greenLow", "redLow"]
        : [];
  for (const key of unused) {
    if (input[key] !== undefined && input[key] !== null) {
      throw new OperationError(
        "forbidden",
        facing === "higher_better"
          ? "A KPI that should stay high has a green value and a red value below it, not above."
          : "A KPI that should stay low has a green value and a red value above it, not below.",
      );
    }
    merged[key] = null;
  }
  const problem = thresholdsProblem(type, merged);
  if (problem) {
    throw new OperationError("forbidden", problem);
  }

  const text = (value: number | null) =>
    value === null ? null : String(value);
  return {
    targetType: type,
    direction:
      facing ??
      input.direction ??
      (existing?.direction as KpiDirection | undefined) ??
      "higher_better",
    greenLow: text(merged.greenLow),
    greenHigh: text(merged.greenHigh),
    redLow: text(merged.redLow),
    redHigh: text(merged.redHigh),
  };
}

/**
 * The recovery goal beside a KPI, for `isRecovering` (P9-T17b-a). Read with
 * the left join `recoveryJoin` gives.
 */
const RECOVERY_COLUMNS = {
  recoveryGoalId: kpis.recoveryGoalId,
  recoveryGoalLive: goals.id,
  recoveryGoalClosedAt: goals.closedAt,
} as const;

const recoveryJoin = and(
  eq(goals.id, kpis.recoveryGoalId),
  isNull(goals.deletedAt),
);

/** The named owner, joined beside where a KPI lives (P9-T17b-b). */
const namedOwners = alias(workspaceMembers, "named_owner");

/** The rule as every KPI read reports it (P9-T17a). */
const ruleOutput = {
  targetType: z.enum(KPI_TARGET_TYPES),
  greenLow: z.number().nullable(),
  greenHigh: z.number().nullable(),
  redLow: z.number().nullable(),
  redHigh: z.number().nullable(),
  /**
   * What decides this KPI's band: its own thresholds, or the ratio of current
   * to target where it has none (§6.4). The ratio suits a positive number
   * counted from zero and nothing else, so a screen says which it is reading.
   */
  basis: z.enum(["thresholds", "ratio"]),
};

function ruleOf(rule: KpiRule) {
  const thresholds = thresholdsOf(rule);
  return {
    targetType: targetTypeOf(rule),
    ...thresholds,
    basis: readingOf(rule, null, null).basis,
  };
}

/**
 * A named owner, checked: an active person in this workspace, or nobody
 * (§6.2, P9-T17b-b). An agent is a member too, and is refused, because §6.2
 * says a person.
 */
async function namedOwner(
  tx: OperationTx,
  workspaceId: string,
  memberId: string | null,
): Promise<string | null> {
  if (memberId === null) {
    return null;
  }
  const [member] = await tx
    .select({ id: workspaceMembers.id, kind: workspaceMembers.kind })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.id, memberId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError(
      "not_found",
      "No such member. A KPI's owner is a person who is still here.",
    );
  }
  // A person who has not signed in yet, as an import leaves them, is still
  // a person: only an agent cannot be accountable for a number.
  if (member.kind === "agent") {
    throw new OperationError(
      "forbidden",
      "A KPI is owned by a person, not an agent.",
    );
  }
  return member.id;
}

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

/** A short identifier for a URL. Random, per workspace, never sequential. */
function shortId(): string {
  const alphabet = "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  let out = "";
  for (let index = 0; index < 10; index += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export const createKpiCategory = defineWriteAction({
  name: "kpis.createCategory",
  summary: "Adds a KPI category, which is how the grid groups its rows.",
  input: z.object({
    name: z.string().trim().min(1).max(120),
    /** The source-system identity, when an import is creating this (P6-T03d). */
    legacy: legacyKey.optional(),
  }),
  output: z.object({ id: z.uuid(), name: z.string() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      await actingMember(tx, workspaceId, context.actor.userId);
      await assertLegacyKeyFree(
        tx,
        workspaceId,
        kpiCategories,
        input.legacy,
        "KPI category",
      );
      const id = newId();
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx.insert(kpiCategories).values({
        id,
        workspaceId,
        name: input.name,
        ...(input.legacy
          ? { legacyType: input.legacy.type, legacyId: input.legacy.id }
          : {}),
      });
      return {
        result: { id, name: input.name },
        activity: {
          kind: "kpi.category_created" as const,
          subjectType: "workspace" as const,
          subjectId: workspaceId,
          payload: { name: input.name },
        },
        audit: {
          action: "kpis.createCategory",
          targetType: "kpi_category",
          targetId: id,
          payload: { name: input.name },
        },
      };
    },
  }),
});

export const createKpi = defineWriteAction({
  name: "kpis.create",
  summary:
    "Adds a KPI with its frequency, unit, direction, tier and corridor thresholds.",
  input: z.object({
    title: z.string().trim().min(1).max(500),
    frequency: z.enum(KPI_FREQUENCY_VALUES),
    /** Kept for callers written before target types; a type wins over it. */
    direction: z.enum(KPI_DIRECTION_VALUES).optional(),
    ...ruleFields,
    indicatorType: z.enum(["leading", "lagging"]).default("lagging"),
    /** Optional since P9-T17b-b (METHOD.md §6.2): none unless one is chosen. */
    tier: z.enum(KPI_TIERS).nullable().optional(),
    aggregate: z.enum(KPI_AGGREGATES).default("sum"),
    ownerKind: z.enum(KPI_OWNER_KINDS).default("workspace"),
    spaceId: z.uuid().optional(),
    memberId: z.uuid().optional(),
    /**
     * The one named person who owns it (§6.2, P9-T17b-b), and who hears when
     * it leaves its corridor. Where it lives is `ownerKind`. A KPI on a
     * member's own list is owned by that member unless another is named.
     */
    ownerMemberId: z.uuid().nullable().optional(),
    categoryId: z.uuid().optional(),
    parentKpiId: z.uuid().optional(),
    unit: z.string().trim().max(60).optional(),
    targetDefault: z.number().optional(),
    healthyPct: z.number().min(0).max(200).optional(),
    watchPct: z.number().min(0).max(200).optional(),
    /** The source-system identity, when an import is creating this (P6-T01a). */
    legacy: legacyKey.optional(),
  }),
  output: z.object({ id: z.uuid(), shortId: z.string() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      await actingMember(tx, workspaceId, context.actor.userId);

      await assertLegacyKeyFree(tx, workspaceId, kpis, input.legacy, "KPI");

      // The workspace's own corridor where the caller names none (completeness
      // review H-17). The columns' defaults were the canon's 90 and 70, so a
      // workspace that moved its thresholds on /admin/rhythm still got those.
      const thresholds = resolveRhythm(
        await readRhythmRow(tx, workspaceId),
      ).thresholds;
      const healthyPct = input.healthyPct ?? thresholds["kpi.healthyThreshold"];
      const watchPct = input.watchPct ?? thresholds["kpi.watchThreshold"];
      if (watchPct > healthyPct) {
        // The corridor reads from below in both bands, so a watch band above the
        // healthy band would put every KPI in `watch` and none in `healthy`. The
        // database refuses it too; this says why.
        throw new OperationError(
          "forbidden",
          "The watch threshold cannot sit above the healthy threshold. Both bands are read from below.",
        );
      }

      const rule = ruleWrite(input, null);

      const id = newId();
      const short = shortId();
      // openokr:allow-mutation: same transaction.
      await tx.insert(kpis).values({
        id,
        workspaceId,
        shortId: short,
        title: input.title,
        frequency: input.frequency,
        ...rule,
        indicatorType: input.indicatorType,
        tier: input.tier ?? null,
        aggregate: input.aggregate,
        ownerMemberId: await namedOwner(
          tx,
          workspaceId,
          input.ownerMemberId ??
            (input.ownerKind === "member" ? (input.memberId ?? null) : null),
        ),
        ownerKind: input.ownerKind,
        spaceId: input.spaceId ?? null,
        memberId: input.memberId ?? null,
        categoryId: input.categoryId ?? null,
        parentKpiId: input.parentKpiId ?? null,
        unit: input.unit ?? null,
        targetDefault:
          input.targetDefault === undefined
            ? null
            : String(input.targetDefault),
        healthyPct: String(healthyPct),
        watchPct: String(watchPct),
        ...legacyColumns(input.legacy),
      });

      // No records yet, so this settles the KPI at `no_data` rather than leaving
      // the column at its default and hoping they agree.
      await recomputeKpi(tx, workspaceId, id);

      // A KPI that belongs to no space owns a context of its own, so the
      // built-in agents can be bound to it by name (completeness review H-04).
      // One in a space is in their sight through the space.
      if (!input.spaceId) {
        const contextId = await ensureContext(tx, {
          workspaceId,
          resourceType: "kpi",
          resourceId: id,
        });
        await bindAgentsToContextInTx(tx, { workspaceId, contextId });
      }

      return {
        result: { id, shortId: short },
        activity: {
          kind: "kpi.created" as const,
          subjectType: "workspace" as const,
          subjectId: workspaceId,
          payload: { title: input.title, frequency: input.frequency },
        },
        audit: {
          action: "kpis.create",
          targetType: "kpi",
          targetId: id,
          payload: { title: input.title },
        },
      };
    },
  }),
});

export const recordKpiValue = defineWriteAction({
  name: "kpis.record",
  summary:
    "Records a value for the period a date falls in. Re-recording updates rather than duplicating.",
  input: z.object({
    kpiId: z.uuid(),
    /** Any date inside the period. Normalised on the server, never by a client. */
    on: z.string().regex(LOCAL_DATE_PATTERN),
    actualValue: z.number().nullable().optional(),
    targetValue: z.number().nullable().optional(),
    remark: z.string().trim().max(500).nullable().optional(),
  }),
  output: z.object({
    id: z.uuid(),
    periodStart: z.string(),
    created: z.boolean(),
    achievementPct: z.number().nullable(),
    state: z.string(),
    diagnostic: z.string().nullable(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );

      const [kpi] = await tx
        .select({
          id: kpis.id,
          frequency: kpis.frequency,
          isCalculated: kpis.isCalculated,
        })
        .from(kpis)
        .where(
          activeOnly(
            kpis,
            eq(kpis.workspaceId, workspaceId),
            eq(kpis.id, input.kpiId),
          ),
        )
        .limit(1);
      if (!kpi) {
        throw new OperationError("not_found", "No such KPI.");
      }
      if (kpi.isCalculated) {
        // The same refusal a KPI-linked key result gets. A calculated cell is
        // read-only because its value is derived, and a typed-in figure would be
        // overwritten by the next evaluation without warning.
        throw new OperationError(
          "forbidden",
          "This KPI is calculated from a formula, so its values cannot be typed in.",
        );
      }

      const record = await upsertKpiRecord(tx, kpi.frequency, {
        workspaceId,
        kpiId: input.kpiId,
        on: input.on,
        actualValue: input.actualValue,
        targetValue: input.targetValue,
        remark: input.remark,
        authorMemberId: memberId,
      });

      // Everything downstream, in topological order, then each one's corridor
      // state. A dependent recomputed before its source would fold a stale
      // number into the answer (design §7).
      const touched = await cascadeFromKpi(
        tx,
        workspaceId,
        input.kpiId,
        record.periodStart,
        memberId,
      );
      for (const dependentId of touched) {
        await recomputeKpi(tx, workspaceId, dependentId);
      }

      const recomputed = await recomputeKpi(tx, workspaceId, input.kpiId);

      // Then every key result that reads this KPI or one the cascade just
      // recomputed, and the goals above them (completeness review M-07).
      // Last, because the progress it sets off reads the achievement stored
      // by the two steps above.
      await followKpisInTx(tx, {
        workspaceId,
        kpiIds: [input.kpiId, ...touched],
        authorMemberId: memberId,
      });

      return {
        result: {
          id: record.id,
          periodStart: record.periodStart,
          created: record.created,
          achievementPct: recomputed.achievementPct,
          state: recomputed.state,
          diagnostic: recomputed.diagnostic,
        },
        activity: {
          kind: "kpi.value_recorded" as const,
          subjectType: "kpi" as const,
          subjectId: input.kpiId,
          payload: {
            periodStart: record.periodStart,
            created: record.created,
          },
        },
        audit: {
          action: "kpis.record",
          targetType: "kpi_record",
          targetId: record.id,
          payload: { periodStart: record.periodStart },
        },
      };
    },
  }),
});

export const readKpiGrid = defineReadAction({
  name: "kpis.grid",
  summary:
    "Every KPI with its recent periods, grouped by category. Drives screen S-20.",
  input: z.object({
    /** How many periods to return per KPI, newest first. */
    periods: z.number().int().min(1).max(48).default(12),
  }),
  output: z.object({
    categories: z.array(
      z.object({ id: z.uuid().nullable(), name: z.string() }),
    ),
    kpis: z.array(
      z.object({
        id: z.uuid(),
        shortId: z.string(),
        title: z.string(),
        categoryId: z.uuid().nullable(),
        frequency: z.string(),
        unit: z.string().nullable(),
        direction: z.string(),
        indicatorType: z.string(),
        tier: z.string().nullable(),
        /** The band, or no data. Never `recovering` since P9-T17b-a. */
        state: z.string(),
        /** An open recovery objective, shown beside the band (§6.4). */
        recovering: z.boolean(),
        achievementPct: z.number().nullable(),
        targetDefault: z.number().nullable(),
        healthyPct: z.number(),
        watchPct: z.number(),
        ...ruleOutput,
        isCalculated: z.boolean(),
        /**
         * Who answers for this KPI, so the grid can filter by owner (P6-G30).
         *
         * S-20 asks for a filter by owner and the grid could not offer one: it
         * returned no owner at all, and the KPI detail read is the only place
         * that knew.
         */
        ownerId: z.uuid().nullable(),
        ownerName: z.string().nullable(),
        /** The one named person who owns it (§6.2), when somebody is named. */
        namedOwnerId: z.uuid().nullable(),
        namedOwnerName: z.string().nullable(),
        /**
         * The expression behind a calculated cell (P6-G30).
         *
         * S-20 asks for a formula chip on a calculated cell, and a chip needs
         * a formula to name. Returned as text rather than as the stored tree,
         * because a reader wants to see the sum, not the shape of it.
         */
        formula: z.string().nullable(),
        records: z.array(
          z.object({
            periodStart: z.string(),
            actualValue: z.number().nullable(),
            targetValue: z.number().nullable(),
            remark: z.string().nullable(),
            /**
             * This period's own band, by the KPI's rule (P9-T17a), so a cell
             * is coloured the way its state would be read rather than by a
             * ratio the KPI may not use. Null with no value to judge.
             */
            band: z.enum(["healthy", "watch", "unhealthy"]).nullable(),
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
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;

        const categoryRows = await tx
          .select({ id: kpiCategories.id, name: kpiCategories.name })
          .from(kpiCategories)
          .where(
            activeOnly(
              kpiCategories,
              eq(kpiCategories.workspaceId, context.workspaceId),
            ),
          )
          .orderBy(asc(kpiCategories.position), asc(kpiCategories.name));

        const kpiRows = await tx
          .select({
            id: kpis.id,
            shortId: kpis.shortId,
            title: kpis.title,
            categoryId: kpis.categoryId,
            frequency: kpis.frequency,
            unit: kpis.unit,
            indicatorType: kpis.indicatorType,
            tier: kpis.tier,
            state: kpis.state,
            achievementPct: kpis.achievementPct,
            targetDefault: kpis.targetDefault,
            ...KPI_RULE_COLUMNS,
            isCalculated: kpis.isCalculated,
            // **The owner is a kind and one of two columns**, not a single
            // id: a KPI belongs to the workspace, a space or a member
            // (P3-T12). The grid flattens the three into one label so S-20's
            // owner filter has something to filter on.
            ownerKind: kpis.ownerKind,
            memberId: kpis.memberId,
            memberName: workspaceMembers.name,
            spaceId: kpis.spaceId,
            spaceName: spaces.name,
            formula: kpis.formula,
            ...RECOVERY_COLUMNS,
            namedOwnerId: kpis.ownerMemberId,
            namedOwnerName: namedOwners.name,
          })
          .from(kpis)
          .leftJoin(workspaceMembers, eq(workspaceMembers.id, kpis.memberId))
          .leftJoin(spaces, eq(spaces.id, kpis.spaceId))
          .leftJoin(goals, recoveryJoin)
          .leftJoin(namedOwners, eq(namedOwners.id, kpis.ownerMemberId))
          .where(activeOnly(kpis, eq(kpis.workspaceId, context.workspaceId)))
          .orderBy(asc(kpis.position), asc(kpis.title));

        const out = [];
        for (const kpi of kpiRows) {
          const records = await loadKpiRecords(
            tx,
            context.workspaceId,
            kpi.id,
            input.periods,
          );
          out.push({
            ...kpi,
            ...ruleOf(kpi),
            state: shownState(kpi),
            recovering: isRecovering(kpi),
            achievementPct:
              kpi.achievementPct === null ? null : Number(kpi.achievementPct),
            targetDefault:
              kpi.targetDefault === null ? null : Number(kpi.targetDefault),
            healthyPct: Number(kpi.healthyPct),
            ownerId: kpi.memberId ?? kpi.spaceId,
            ownerName:
              kpi.ownerKind === "member"
                ? kpi.memberName
                : kpi.ownerKind === "space"
                  ? kpi.spaceName
                  : null,
            // Text, not the stored tree: a chip names the sum, it does not
            // draw its shape (P6-G30).
            formula:
              kpi.formula === null || kpi.formula === undefined
                ? null
                : typeof kpi.formula === "string"
                  ? kpi.formula
                  : JSON.stringify(kpi.formula),
            watchPct: Number(kpi.watchPct),
            records: records.map((record) => {
              const actual =
                record.actualValue === null ? null : Number(record.actualValue);
              const target =
                record.targetValue === null ? null : Number(record.targetValue);
              return {
                periodStart: String(record.periodStart),
                actualValue: actual,
                targetValue: target,
                remark: record.remark,
                // A period with no target of its own is read against the
                // standing one, as the recompute reads it.
                band: readingOf(
                  kpi,
                  actual,
                  target ??
                    (kpi.targetDefault === null
                      ? null
                      : Number(kpi.targetDefault)),
                ).band,
              };
            }),
          });
        }

        return {
          // A null id is the "uncategorised" group, which the grid renders last.
          // Every KPI belongs to exactly one group, and a category nobody chose
          // is still a group rather than a gap.
          categories: [...categoryRows, { id: null, name: "Uncategorised" }],
          kpis: out,
        };
      },
    );
  },
});

/**
 * Every KPI, one row each, for a picker (completeness review M-07).
 *
 * The grid read answers a different question and costs one query per KPI for
 * its periods, which is a lot to pay for a drop-down on the drafting step and
 * on every goal page. This is one query, and it reads the same rows the grid
 * does: KPIs sit at the workspace floor, so a member who can open the grid
 * can pick any of them, and a member who cannot open this workspace reaches
 * nothing here either.
 */
export const listKpis = defineReadAction({
  name: "kpis.list",
  summary:
    "Every KPI by title, with its unit, state and achievement. Drives the measure picker on S-09 and S-14.",
  input: z.object({}),
  output: z.object({
    kpis: z.array(
      z.object({
        id: z.uuid(),
        shortId: z.string(),
        title: z.string(),
        unit: z.string().nullable(),
        frequency: z.string(),
        direction: z.string(),
        state: z.string(),
        achievementPct: z.number().nullable(),
        targetDefault: z.number().nullable(),
        isCalculated: z.boolean(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const rows = await tx
          .select({
            id: kpis.id,
            shortId: kpis.shortId,
            title: kpis.title,
            unit: kpis.unit,
            frequency: kpis.frequency,
            direction: kpis.direction,
            state: kpis.state,
            achievementPct: kpis.achievementPct,
            targetDefault: kpis.targetDefault,
            isCalculated: kpis.isCalculated,
          })
          .from(kpis)
          .where(activeOnly(kpis, eq(kpis.workspaceId, context.workspaceId)))
          .orderBy(asc(kpis.title), asc(kpis.id));
        return {
          kpis: rows.map((row) => ({
            ...row,
            achievementPct:
              row.achievementPct === null ? null : Number(row.achievementPct),
            targetDefault:
              row.targetDefault === null ? null : Number(row.targetDefault),
          })),
        };
      },
    );
  },
});

export const setKpiFormulaAction = defineWriteAction({
  name: "kpis.setFormula",
  summary:
    "Makes a KPI calculated from a formula over other KPIs, refusing self-reference and cycles.",
  input: z.object({
    kpiId: z.uuid(),
    /** The stored tree. Validated by the engine, never parsed from a string. */
    formula: z.unknown(),
    /** Any date inside the period to evaluate straight away. */
    on: z.string().regex(LOCAL_DATE_PATTERN),
  }),
  output: z.object({
    id: z.uuid(),
    references: z.array(z.uuid()),
    value: z.number().nullable(),
    diagnostic: z.string().nullable(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );

      const [kpi] = await tx
        .select({ id: kpis.id, frequency: kpis.frequency })
        .from(kpis)
        .where(
          activeOnly(
            kpis,
            eq(kpis.workspaceId, workspaceId),
            eq(kpis.id, input.kpiId),
          ),
        )
        .limit(1);
      if (!kpi) {
        throw new OperationError("not_found", "No such KPI.");
      }

      const { references } = await setKpiFormula(
        tx,
        workspaceId,
        input.kpiId,
        input.formula,
      );

      // Evaluated immediately, so the grid never shows a calculated KPI with a
      // formula and no value for the period the author was looking at.
      const period = normalisePeriod(kpi.frequency as KpiFrequency, input.on);
      const evaluated = await evaluateKpiForPeriod(
        tx,
        workspaceId,
        input.kpiId,
        period,
        memberId,
      );
      await recomputeKpi(tx, workspaceId, input.kpiId);
      // A KPI that has just become calculated has a new value, and whatever
      // reads it has to see that value rather than the typed one it replaced.
      await followKpisInTx(tx, {
        workspaceId,
        kpiIds: [input.kpiId],
        authorMemberId: memberId,
      });

      return {
        result: {
          id: input.kpiId,
          references: [...references],
          value: evaluated.value,
          diagnostic: evaluated.diagnostic,
        },
        activity: {
          kind: "kpi.formula_set" as const,
          subjectType: "kpi" as const,
          subjectId: input.kpiId,
          payload: { references: references.length },
        },
        audit: {
          action: "kpis.setFormula",
          targetType: "kpi",
          targetId: input.kpiId,
          payload: { references: references.length },
        },
      };
    },
  }),
});

export const updateKpi = defineWriteAction({
  name: "kpis.update",
  summary:
    "Edits a KPI's own fields, where it hangs in the tree, and which tree it belongs to.",
  input: z.object({
    kpiId: z.uuid(),
    title: z.string().trim().min(1).max(500).optional(),
    unit: z.string().trim().max(60).nullable().optional(),
    direction: z.enum(KPI_DIRECTION_VALUES).optional(),
    ...ruleFields,
    indicatorType: z.enum(["leading", "lagging"]).optional(),
    /** Null takes the tier away, which §6.2 allows. */
    tier: z.enum(KPI_TIERS).nullable().optional(),
    /** The named owner (§6.2); null leaves it unnamed. */
    ownerMemberId: z.uuid().nullable().optional(),
    targetDefault: z.number().nullable().optional(),
    /** Null detaches it, which makes it a root of its own. */
    parentKpiId: z.uuid().nullable().optional(),
    treeId: z.uuid().nullable().optional(),
    categoryId: z.uuid().nullable().optional(),
    healthyPct: z.number().min(0).max(200).optional(),
    watchPct: z.number().min(0).max(200).optional(),
  }),
  output: z.object({
    id: z.uuid(),
    state: z.string(),
    achievementPct: z.number().nullable(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );

      const [existing] = await tx
        .select({
          id: kpis.id,
          ...KPI_RULE_COLUMNS,
        })
        .from(kpis)
        .where(
          activeOnly(
            kpis,
            eq(kpis.workspaceId, workspaceId),
            eq(kpis.id, input.kpiId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new OperationError("not_found", "No such KPI.");
      }

      if (input.parentKpiId === input.kpiId) {
        // The database refuses it too. This says why rather than surfacing a
        // constraint name to somebody rearranging a tree.
        throw new OperationError(
          "forbidden",
          "A KPI cannot drive itself. Pick a different parent, or detach it.",
        );
      }

      if (input.parentKpiId) {
        // A cycle would make the recovery walk and the tree render loop
        // forever. Refused against the graph as it would be, before the write,
        // the same way P3-T13 refuses a formula cycle.
        const all = await tx
          .select({ id: kpis.id, parentKpiId: kpis.parentKpiId })
          .from(kpis)
          .where(activeOnly(kpis, eq(kpis.workspaceId, workspaceId)));
        const parentOf = new Map(
          all.map((row) => [row.id, row.parentKpiId] as const),
        );
        parentOf.set(input.kpiId, input.parentKpiId);
        const seen = new Set<string>();
        let cursor: string | null | undefined = input.kpiId;
        while (cursor) {
          if (seen.has(cursor)) {
            throw new OperationError(
              "forbidden",
              "That would make the tree loop back on itself. A driver cannot end up driving its own parent.",
            );
          }
          seen.add(cursor);
          cursor = parentOf.get(cursor) ?? null;
        }
      }

      const healthyPct = input.healthyPct ?? Number(existing.healthyPct);
      const watchPct = input.watchPct ?? Number(existing.watchPct);
      if (watchPct > healthyPct) {
        throw new OperationError(
          "forbidden",
          "The watch threshold cannot sit above the healthy threshold. Both bands are read from below.",
        );
      }

      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.title !== undefined) {
        set.title = input.title;
      }
      if (input.unit !== undefined) {
        set.unit = input.unit;
      }
      const ruleTouched =
        input.direction !== undefined ||
        input.targetType !== undefined ||
        input.greenLow !== undefined ||
        input.greenHigh !== undefined ||
        input.redLow !== undefined ||
        input.redHigh !== undefined;
      if (ruleTouched) {
        Object.assign(set, ruleWrite(input, existing));
      }
      if (input.indicatorType !== undefined) {
        set.indicatorType = input.indicatorType;
      }
      if (input.tier !== undefined) {
        set.tier = input.tier;
      }
      if (input.ownerMemberId !== undefined) {
        set.ownerMemberId = await namedOwner(
          tx,
          workspaceId,
          input.ownerMemberId,
        );
      }
      if (input.targetDefault !== undefined) {
        set.targetDefault =
          input.targetDefault === null ? null : String(input.targetDefault);
      }
      if (input.parentKpiId !== undefined) {
        set.parentKpiId = input.parentKpiId;
      }
      if (input.treeId !== undefined) {
        set.treeId = input.treeId;
      }
      if (input.categoryId !== undefined) {
        set.categoryId = input.categoryId;
      }
      if (input.healthyPct !== undefined) {
        set.healthyPct = String(input.healthyPct);
      }
      if (input.watchPct !== undefined) {
        set.watchPct = String(input.watchPct);
      }

      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(kpis)
        .set(set)
        .where(
          activeOnly(
            kpis,
            eq(kpis.workspaceId, workspaceId),
            eq(kpis.id, input.kpiId),
          ),
        );

      // Direction, target and the corridor all change what the same records
      // mean, so the derived columns are recomputed rather than left describing
      // the KPI as it was before the edit.
      const recomputed = await recomputeKpi(tx, workspaceId, input.kpiId);
      // A new target or direction moves the achievement a linked key result
      // reads, with no new reading to say so (completeness review M-07).
      await followKpisInTx(tx, {
        workspaceId,
        kpiIds: [input.kpiId],
        authorMemberId: memberId,
      });

      return {
        result: {
          id: input.kpiId,
          state: recomputed.state,
          achievementPct: recomputed.achievementPct,
        },
        activity: {
          kind: "kpi.updated" as const,
          subjectType: "kpi" as const,
          subjectId: input.kpiId,
          payload: {
            fields: Object.keys(set).filter((key) => key !== "updatedAt"),
          },
        },
        audit: {
          action: "kpis.update",
          targetType: "kpi",
          targetId: input.kpiId,
          payload: {
            fields: Object.keys(set).filter((key) => key !== "updatedAt"),
          },
        },
      };
    },
  }),
});

export const createKpiTree = defineWriteAction({
  name: "kpis.createTree",
  summary:
    "Names a driver tree. The parent pointers shape it; this row is the tree itself.",
  input: z.object({
    name: z.string().trim().min(1).max(120),
    rootKpiId: z.uuid().optional(),
  }),
  output: z.object({ id: z.uuid(), name: z.string() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      await actingMember(tx, workspaceId, context.actor.userId);
      const id = newId();
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx.insert(kpiTrees).values({
        id,
        workspaceId,
        name: input.name,
        rootKpiId: input.rootKpiId ?? null,
      });
      if (input.rootKpiId) {
        // The root belongs to the tree it roots. Saying so here means nobody
        // has to remember a second call.
        // openokr:allow-mutation: same transaction.
        await tx
          .update(kpis)
          .set({ treeId: id, updatedAt: new Date() })
          .where(
            activeOnly(
              kpis,
              eq(kpis.workspaceId, workspaceId),
              eq(kpis.id, input.rootKpiId),
            ),
          );
      }
      return {
        result: { id, name: input.name },
        activity: {
          kind: "kpi.tree_created" as const,
          subjectType: "workspace" as const,
          subjectId: workspaceId,
          payload: { name: input.name },
        },
        audit: {
          action: "kpis.createTree",
          targetType: "kpi_tree",
          targetId: id,
          payload: { name: input.name },
        },
      };
    },
  }),
});

export const launchKpiRecovery = defineWriteAction({
  name: "kpis.launchRecovery",
  summary:
    "Creates METHOD.md §6.5's recovery objective from the leading drivers under an unhealthy KPI.",
  input: z.object({
    kpiId: z.uuid(),
    /** The cycle the objective lives in. The caller resolves the current one. */
    cycleId: z.uuid(),
    /**
     * A title instead of §6.5's template sentence (P4-T05c-b).
     *
     * Carried on a Champion proposal when a model wrote a better one. Bounded
     * like every other objective title, because a proposal is applied through
     * this action by a human and gets no exemption from §4.1's length rule.
     */
    objectiveTitle: z.string().trim().min(1).max(500).optional(),
  }),
  output: z.object({
    goalId: z.uuid(),
    keyResultIds: z.array(z.uuid()),
    startedPct: z.number().nullable(),
    /** The KPI's band, which the launch does not change (P9-T17b-a). */
    state: z.string(),
    recovering: z.boolean(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
      const launched = await launchRecoveryInTx(tx, {
        workspaceId,
        kpiId: input.kpiId,
        memberId,
        cycleId: input.cycleId,
        spaceId: null,
        keyResultCap: Number(rhythm.thresholds["kpi.recoveryKeyResultCap"]),
        ...(input.objectiveTitle
          ? { objectiveTitle: input.objectiveTitle }
          : {}),
      });

      return {
        result: {
          goalId: launched.goalId,
          keyResultIds: [...launched.keyResultIds],
          startedPct: launched.startedPct,
          state: launched.state,
          recovering: true,
        },
        activity: {
          kind: "kpi.recovery_launched" as const,
          subjectType: "kpi" as const,
          subjectId: input.kpiId,
          payload: {
            goalId: launched.goalId,
            keyResults: launched.keyResultIds.length,
          },
        },
        audit: {
          action: "kpis.launchRecovery",
          targetType: "kpi",
          targetId: input.kpiId,
          payload: { goalId: launched.goalId },
        },
      };
    },
  }),
});

/**
 * How an unhealthy KPI was answered, when it was not with a recovery
 * (METHOD.md §6.5, P9-T18b).
 *
 * §6.5 offers three responses. A recovery has its own launch. The other two
 * are work created through their own writes, which keep their own rules: a
 * task fixed now is `tasks.create`, with its owner and its date, and a key
 * result for it on an existing objective is `goals.addKeyResult`, which marks
 * one added mid-cycle and asks the practice. This records which one answers
 * the KPI, so the recovery board shows the answer instead of offering the
 * three again, and the coach does not propose a recovery for a KPI somebody
 * has already answered.
 */
export const recordKpiResponse = defineWriteAction({
  name: "kpis.recordResponse",
  summary:
    "Records how an unhealthy KPI was answered: fixed now as a task, or by a key result on an existing objective.",
  input: z.object({
    kpiId: z.uuid(),
    kind: z.enum(["fix_now", "key_result"]),
    /** The task that fixes it, for `fix_now`. */
    taskId: z.uuid().optional(),
    /** The key result that answers it, for `key_result`. */
    keyResultId: z.uuid().optional(),
  }),
  output: z.object({
    kpiId: z.uuid(),
    kind: z.enum(["fix_now", "key_result"]),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMember(
        tx,
        workspaceId,
        context.actor.userId,
      );
      const [kpi] = await tx
        .select({ id: kpis.id, title: kpis.title })
        .from(kpis)
        .where(
          activeOnly(
            kpis,
            eq(kpis.workspaceId, workspaceId),
            eq(kpis.id, input.kpiId),
          ),
        )
        .limit(1);
      if (!kpi) {
        throw new OperationError("not_found", "No such KPI.");
      }

      let subjectId: string;
      if (input.kind === "fix_now") {
        if (!input.taskId) {
          throw new OperationError(
            "forbidden",
            "Fixing it now needs the task that does it.",
          );
        }
        // The task must be one this member can see: a response pointing at
        // work they cannot open would answer nothing they could follow.
        await getAccessScoped(tx, {
          workspaceId,
          memberId,
          resourceType: "task",
          resourceId: input.taskId,
          requires: ACCESS_LEVELS.view,
        });
        // A task already done is a fix that happened, not one under way, so
        // it answers nothing about the KPI as it stands.
        const [task] = await tx
          .select({ status: tasks.status })
          .from(tasks)
          .where(
            activeOnly(
              tasks,
              eq(tasks.workspaceId, workspaceId),
              eq(tasks.id, input.taskId),
            ),
          )
          .limit(1);
        if (task?.status === "done") {
          throw new OperationError(
            "forbidden",
            "That task is already done, so it cannot be how the KPI is being fixed now. Name a task still open, or open a new one.",
          );
        }
        subjectId = input.taskId;
      } else {
        if (!input.keyResultId) {
          throw new OperationError(
            "forbidden",
            "Answering it with a key result needs the key result.",
          );
        }
        const [keyResult] = await tx
          .select({ goalId: keyResults.goalId, closedAt: goals.closedAt })
          .from(keyResults)
          .innerJoin(goals, eq(goals.id, keyResults.goalId))
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, workspaceId),
              eq(keyResults.id, input.keyResultId),
            ),
          )
          .limit(1);
        if (!keyResult) {
          throw new OperationError("not_found", "No such key result.");
        }
        // A closed objective moves nothing any more, so its key result
        // cannot be what answers the KPI from here on.
        if (keyResult.closedAt !== null) {
          throw new OperationError(
            "forbidden",
            "That key result's objective is closed, so it cannot answer the KPI. Choose a key result on an open objective.",
          );
        }
        await getAccessScoped(tx, {
          workspaceId,
          memberId,
          resourceType: "goal",
          resourceId: keyResult.goalId,
          requires: ACCESS_LEVELS.view,
        });
        subjectId = input.keyResultId;
      }

      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(kpis)
        .set({
          responseKind: input.kind,
          responseTaskId: input.kind === "fix_now" ? subjectId : null,
          responseKeyResultId: input.kind === "key_result" ? subjectId : null,
          respondedByMemberId: memberId,
          respondedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          activeOnly(
            kpis,
            eq(kpis.workspaceId, workspaceId),
            eq(kpis.id, input.kpiId),
          ),
        );

      // A recovery the coach proposed for it is answered too: the decision
      // was made another way, and leaving the proposal in the inbox would ask
      // for it twice. Settled as dismissed by whoever answered, which is what
      // the inbox would have recorded had they pressed dismiss.
      // openokr:allow-mutation: the calling Operation's own transaction.
      const settled = await tx
        .update(proposedChanges)
        .set({
          status: "dismissed",
          decidedByMemberId: memberId,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(proposedChanges.workspaceId, workspaceId),
            eq(proposedChanges.status, "pending"),
            eq(proposedChanges.action, "kpis.launchRecovery"),
            eq(proposedChanges.subjectType, "kpi"),
            eq(proposedChanges.subjectId, input.kpiId),
          ),
        )
        .returning({ id: proposedChanges.id });

      return {
        result: { kpiId: input.kpiId, kind: input.kind },
        activity: {
          kind: "kpi.responded" as const,
          subjectType: "kpi" as const,
          subjectId: input.kpiId,
          payload: { response: input.kind },
        },
        audit: {
          action: "kpis.recordResponse",
          targetType: "kpi",
          targetId: input.kpiId,
          payload: {
            response: input.kind,
            subjectId,
            settledProposalIds: settled.map((row) => row.id),
          },
        },
      };
    },
  }),
});

export const readRecoveryBoard = defineReadAction({
  name: "kpis.recoveryBoard",
  summary:
    "Every unhealthy or recovering KPI across every tree, with its recovery objective. Drives screen S-19.",
  input: z.object({}),
  output: z.object({
    cards: z.array(
      z.object({
        kpiId: z.uuid(),
        shortId: z.string(),
        title: z.string(),
        treeId: z.uuid().nullable(),
        treeName: z.string().nullable(),
        /** The real band. Never `recovering` since P9-T17b-a. */
        state: z.string(),
        /** An open recovery objective, shown beside the band (§6.4). */
        recovering: z.boolean(),
        /**
         * How it was answered other than by a recovery (§6.5, P9-T18b): a
         * task fixing it now, or a key result on an existing objective, and
         * whether that answer is still open. Null when nobody has answered.
         */
        response: z
          .object({
            kind: z.enum(["fix_now", "key_result"]),
            /** Null with the title when the reader cannot open it. */
            subjectId: z.uuid().nullable(),
            title: z.string().nullable(),
            dueOn: z.string().nullable(),
            goalId: z.uuid().nullable(),
            goalTitle: z.string().nullable(),
            open: z.boolean(),
          })
          .nullable(),
        achievementPct: z.number().nullable(),
        effectivePct: z.number().nullable(),
        healthyPct: z.number(),
        watchPct: z.number(),
        unit: z.string().nullable(),
        /**
         * Where it lives and who owns it, so fixing it now can default the
         * task's space and owner (§6.5, P9-T18b).
         */
        spaceId: z.uuid().nullable(),
        ownerMemberId: z.uuid().nullable(),
        recovery: z
          .object({
            goalId: z.uuid(),
            title: z.string(),
            progressPct: z.number(),
            closed: z.boolean(),
            keyResults: z.number().int(),
            startedPct: z.number().nullable(),
            closeProposed: z.boolean(),
          })
          .nullable(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        // METHOD.md §6.6: one list across every tree, unhealthy or recovering.
        // A healthy KPI is not on the board, which is what stops it becoming a
        // second grid nobody reads.
        const rows = await tx
          .select({
            id: kpis.id,
            shortId: kpis.shortId,
            title: kpis.title,
            treeId: kpis.treeId,
            treeName: kpiTrees.name,
            state: kpis.state,
            achievementPct: kpis.achievementPct,
            effectivePct: kpis.effectivePct,
            healthyPct: kpis.healthyPct,
            watchPct: kpis.watchPct,
            unit: kpis.unit,
            spaceId: kpis.spaceId,
            ownerMemberId: kpis.ownerMemberId,
            recoveryGoalId: kpis.recoveryGoalId,
            recoveryStartedPct: kpis.recoveryStartedPct,
            recoveryCloseProposedAt: kpis.recoveryCloseProposedAt,
            goalTitle: goals.title,
            goalProgress: goals.progressPct,
            goalClosedAt: goals.closedAt,
            recoveryGoalLive: goals.id,
            recoveryGoalClosedAt: goals.closedAt,
            responseKind: kpis.responseKind,
            responseTaskId: kpis.responseTaskId,
            responseKeyResultId: kpis.responseKeyResultId,
          })
          .from(kpis)
          .leftJoin(kpiTrees, eq(kpiTrees.id, kpis.treeId))
          .leftJoin(goals, recoveryJoin)
          .where(
            and(
              activeOnly(kpis, eq(kpis.workspaceId, context.workspaceId)),
              // Unhealthy, or under an open recovery whatever its band now
              // (P9-T17b-a): a recovery that has lifted the KPI into watch is
              // still in flight, and dropping it from the board the day the
              // band moved would lose the thing being watched. A stored
              // `recovering` from before the change counts as the latter.
              or(
                eq(kpis.state, "unhealthy"),
                eq(kpis.state, "recovering"),
                and(isNotNull(goals.id), isNull(goals.closedAt)),
              ),
            ),
          )
          .orderBy(asc(kpis.title));

        const responses = await kpiResponsesInTx(
          tx as OperationTx,
          context.workspaceId,
          rows,
          {
            memberId: await actingMember(
              tx as OperationTx,
              context.workspaceId,
              userId,
            ),
          },
        );
        const counts = new Map<string, number>();
        const goalIds = rows
          .map((row) => row.recoveryGoalId)
          .filter((id): id is string => id !== null);
        if (goalIds.length > 0) {
          const keyResultRows = await tx
            .select({ id: keyResults.id, goalId: keyResults.goalId })
            .from(keyResults)
            .where(
              activeOnly(
                keyResults,
                eq(keyResults.workspaceId, context.workspaceId),
                inArray(keyResults.goalId, goalIds),
              ),
            );
          for (const row of keyResultRows) {
            counts.set(row.goalId, (counts.get(row.goalId) ?? 0) + 1);
          }
        }

        return {
          cards: rows.map((row) => ({
            kpiId: row.id,
            shortId: row.shortId,
            title: row.title,
            treeId: row.treeId,
            treeName: row.treeName,
            state: shownState(row),
            recovering: isRecovering(row),
            response: responses.get(row.id) ?? null,
            achievementPct:
              row.achievementPct === null ? null : Number(row.achievementPct),
            effectivePct:
              row.effectivePct === null ? null : Number(row.effectivePct),
            healthyPct: Number(row.healthyPct),
            watchPct: Number(row.watchPct),
            unit: row.unit,
            spaceId: row.spaceId,
            ownerMemberId: row.ownerMemberId,
            recovery:
              row.recoveryGoalId && row.goalTitle
                ? {
                    goalId: row.recoveryGoalId,
                    title: row.goalTitle,
                    progressPct: Number(row.goalProgress ?? 0),
                    closed: row.goalClosedAt !== null,
                    keyResults: counts.get(row.recoveryGoalId) ?? 0,
                    startedPct:
                      row.recoveryStartedPct === null
                        ? null
                        : Number(row.recoveryStartedPct),
                    closeProposed: row.recoveryCloseProposedAt !== null,
                  }
                : null,
          })),
        };
      },
    );
  },
});

/** One node of a driver tree, as S-18 and the space home draw it. */
const kpiTreeNode = z.object({
  id: z.uuid(),
  parentKpiId: z.uuid().nullable(),
  title: z.string(),
  unit: z.string().nullable(),
  indicatorType: z.string(),
  tier: z.string().nullable(),
  direction: z.string(),
  /** The band, or no data. Never `recovering` since P9-T17b-a. */
  state: z.string(),
  /** An open recovery objective, shown beside the band (§6.4). */
  recovering: z.boolean(),
  achievementPct: z.number().nullable(),
  effectivePct: z.number().nullable(),
  healthyPct: z.number(),
  watchPct: z.number(),
  targetDefault: z.number().nullable(),
  recoveryGoalId: z.uuid().nullable(),
  recoveryProgressPct: z.number().nullable(),
  /**
   * How this KPI drives its parent (§6.3, P9-T17b-a): `formula` when it is
   * part of the parent's calculation, `influence` when it is believed to move
   * it. Read from the parent's formula rather than stored, so the two cannot
   * disagree. Null for a root or a KPI that stands alone.
   */
  link: z.enum(["formula", "influence"]).nullable(),
});
type TreeNode = z.infer<typeof kpiTreeNode>;

/**
 * The columns a tree node is read from, with `goals` joined for a recovery's
 * progress. Shared by `kpis.tree` and `kpis.spaceTrees`, so S-18 and the space
 * home cannot draw one KPI two ways (completeness review M-22).
 */
const KPI_TREE_NODE_COLUMNS = {
  id: kpis.id,
  treeId: kpis.treeId,
  parentKpiId: kpis.parentKpiId,
  title: kpis.title,
  unit: kpis.unit,
  indicatorType: kpis.indicatorType,
  tier: kpis.tier,
  direction: kpis.direction,
  state: kpis.state,
  achievementPct: kpis.achievementPct,
  effectivePct: kpis.effectivePct,
  healthyPct: kpis.healthyPct,
  watchPct: kpis.watchPct,
  targetDefault: kpis.targetDefault,
  recoveryGoalId: kpis.recoveryGoalId,
  recoveryGoalLive: goals.id,
  recoveryGoalClosedAt: goals.closedAt,
  recoveryProgress: goals.progressPct,
  position: kpis.position,
};

/**
 * Every parent-to-child pair where the parent's formula reads the child, as
 * `parent child` (§6.3, P9-T17b-a). One query over the nodes a read returns.
 */
async function formulaLinksInTx(
  tx: OperationTx,
  workspaceId: string,
  parentIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (parentIds.length === 0) {
    return new Set();
  }
  const rows = await tx
    .select({
      dependentKpiId: kpiDependencies.dependentKpiId,
      dependsOnKpiId: kpiDependencies.dependsOnKpiId,
    })
    .from(kpiDependencies)
    .where(
      activeOnly(
        kpiDependencies,
        eq(kpiDependencies.workspaceId, workspaceId),
        inArray(kpiDependencies.dependentKpiId, [...new Set(parentIds)]),
      ),
    );
  return new Set(
    rows.map((row) => `${row.dependentKpiId} ${row.dependsOnKpiId}`),
  );
}

/** A numeric column as a number, or null when it holds none. */
const numberOrNull = (value: string | null): number | null =>
  value === null ? null : Number(value);

function toTreeNode(
  formulaLinks: ReadonlySet<string>,
  row: {
    readonly id: string;
    readonly parentKpiId: string | null;
    readonly title: string;
    readonly unit: string | null;
    readonly indicatorType: string;
    readonly tier: string | null;
    readonly direction: string;
    readonly state: string;
    readonly achievementPct: string | null;
    readonly effectivePct: string | null;
    readonly healthyPct: string;
    readonly watchPct: string;
    readonly targetDefault: string | null;
    readonly recoveryGoalId: string | null;
    readonly recoveryGoalLive: string | null;
    readonly recoveryGoalClosedAt: Date | null;
    readonly recoveryProgress: string | null;
  },
): TreeNode {
  return {
    id: row.id,
    parentKpiId: row.parentKpiId,
    title: row.title,
    unit: row.unit,
    indicatorType: row.indicatorType,
    tier: row.tier,
    direction: row.direction,
    state: shownState(row),
    recovering: isRecovering(row),
    achievementPct: numberOrNull(row.achievementPct),
    effectivePct: numberOrNull(row.effectivePct),
    healthyPct: Number(row.healthyPct),
    watchPct: Number(row.watchPct),
    targetDefault: numberOrNull(row.targetDefault),
    recoveryGoalId: row.recoveryGoalId,
    recoveryProgressPct: numberOrNull(row.recoveryProgress),
    link:
      row.parentKpiId === null
        ? null
        : formulaLinks.has(`${row.parentKpiId} ${row.id}`)
          ? "formula"
          : "influence",
  };
}

export const readKpiTree = defineReadAction({
  name: "kpis.tree",
  summary:
    "One driver tree as nodes with their corridor state and recovery progress. Drives screen S-18.",
  /**
   * Absent means the first tree, which is what a bare visit should show. An
   * explicit null means the KPIs in no tree at all, which is a real set
   * somebody has to be able to reach: without it, naming one tree would hide
   * every unfiled KPI and there would be nothing left to file.
   */
  input: z.object({ treeId: z.uuid().nullable().optional() }),
  output: z.object({
    trees: z.array(z.object({ id: z.uuid(), name: z.string() })),
    treeId: z.uuid().nullable(),
    nodes: z.array(kpiTreeNode),
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
      async (tx) => {
        const trees = await tx
          .select({ id: kpiTrees.id, name: kpiTrees.name })
          .from(kpiTrees)
          .where(
            activeOnly(kpiTrees, eq(kpiTrees.workspaceId, context.workspaceId)),
          )
          .orderBy(asc(kpiTrees.position), asc(kpiTrees.name));

        // No tree named, so the first one. A workspace with none still gets a
        // canvas: every KPI that belongs to no tree is the unfiled set, which
        // is what a workspace looks like straight after an import.
        const treeId =
          input.treeId === null ? null : (input.treeId ?? trees[0]?.id ?? null);
        const rows = await tx
          .select(KPI_TREE_NODE_COLUMNS)
          .from(kpis)
          .leftJoin(goals, recoveryJoin)
          .where(
            activeOnly(
              kpis,
              eq(kpis.workspaceId, context.workspaceId),
              treeId === null ? isNull(kpis.treeId) : eq(kpis.treeId, treeId),
            ),
          )
          .orderBy(asc(kpis.position), asc(kpis.title));

        const links = await formulaLinksInTx(
          tx,
          context.workspaceId,
          rows.flatMap((row) => (row.parentKpiId ? [row.parentKpiId] : [])),
        );
        return {
          trees,
          treeId,
          nodes: rows.map((row) => toTreeNode(links, row)),
        };
      },
    );
  },
});

/**
 * One space's KPIs, grouped by the driver tree each is filed in (completeness
 * review M-22).
 *
 * **The space home had no KPIs on it.** REQUIREMENTS §4 makes a space a team
 * home with its own goals, and a KPI a space owns (`owner_kind` `space`) is
 * the team's own measure; the only way to find one was the workspace-wide
 * grid, filtered by eye.
 *
 * **Read through the space.** The space goes through the access getter first,
 * so a space the reader cannot open is not-found here exactly as it is on
 * `spaces.read`, and every KPI the space owns is then in their sight through
 * it. That is the rule the agents' scope already writes for a KPI in a space
 * (`agentSeesKpi`), and it is what lets a guest bound to one space see that
 * space's measures and nobody else's.
 *
 * **Grouped rather than one tree at a time**, because a space home shows all
 * of a team's measures at once. The named trees come in their own order and
 * the KPIs filed in none come last, which is where S-18 keeps them too. A
 * node whose parent belongs to another space or to the workspace is still
 * returned, with its parent id, and the screen draws it at the root.
 */
export const readSpaceKpiTrees = defineReadAction({
  name: "kpis.spaceTrees",
  summary:
    "One space's KPIs, grouped by the driver tree each is filed in. Drives the space home.",
  input: z.object({ spaceId: z.uuid() }),
  output: z.object({
    trees: z.array(
      z.object({
        /** Null for the KPIs filed in no tree. */
        id: z.uuid().nullable(),
        name: z.string().nullable(),
        nodes: z.array(kpiTreeNode),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such space.");
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
          resourceType: "space",
          resourceId: input.spaceId,
          requires: ACCESS_LEVELS.view,
        });

        const rows = await tx
          .select({
            ...KPI_TREE_NODE_COLUMNS,
            treeName: kpiTrees.name,
            treePosition: kpiTrees.position,
          })
          .from(kpis)
          .leftJoin(goals, recoveryJoin)
          .leftJoin(
            kpiTrees,
            activeOnly(
              kpiTrees,
              eq(kpiTrees.id, kpis.treeId),
              eq(kpiTrees.workspaceId, context.workspaceId),
            ),
          )
          .where(
            activeOnly(
              kpis,
              eq(kpis.workspaceId, context.workspaceId),
              eq(kpis.spaceId, input.spaceId),
            ),
          )
          .orderBy(
            asc(kpiTrees.position),
            asc(kpiTrees.name),
            asc(kpis.position),
            asc(kpis.title),
          );

        const links = await formulaLinksInTx(
          tx,
          context.workspaceId,
          rows.flatMap((row) => (row.parentKpiId ? [row.parentKpiId] : [])),
        );
        // A tree that was deleted leaves its KPIs pointing at nothing live, so
        // they are grouped with the unfiled ones rather than under a name
        // nobody can open.
        const groups = new Map<
          string | null,
          { id: string | null; name: string | null; nodes: TreeNode[] }
        >();
        for (const row of rows) {
          const key = row.treeName === null ? null : row.treeId;
          const group = groups.get(key) ?? {
            id: key,
            name: key === null ? null : row.treeName,
            nodes: [],
          };
          group.nodes.push(toTreeNode(links, row));
          groups.set(key, group);
        }
        const unfiled = groups.get(null);
        groups.delete(null);
        return {
          trees: [...groups.values(), ...(unfiled ? [unfiled] : [])],
        };
      },
    );
  },
});

export const readKpiDetail = defineReadAction({
  name: "kpis.detail",
  summary:
    "One KPI with its periods, its place in the tree and its formula. Drives screen S-21.",
  input: z.object({
    kpiId: z.uuid(),
    periods: z.number().int().min(1).max(48).default(24),
  }),
  output: z.object({
    kpi: z.object({
      id: z.uuid(),
      shortId: z.string(),
      title: z.string(),
      categoryName: z.string().nullable(),
      ownerName: z.string().nullable(),
      /** The one named person who owns it (§6.2), when somebody is named. */
      namedOwnerId: z.uuid().nullable(),
      namedOwnerName: z.string().nullable(),
      frequency: z.string(),
      unit: z.string().nullable(),
      direction: z.string(),
      indicatorType: z.string(),
      tier: z.string().nullable(),
      /** The band, or no data. Never `recovering` since P9-T17b-a. */
      state: z.string(),
      /** An open recovery objective, shown beside the band (§6.4). */
      recovering: z.boolean(),
      achievementPct: z.number().nullable(),
      effectivePct: z.number().nullable(),
      healthyPct: z.number(),
      watchPct: z.number(),
      ...ruleOutput,
      targetDefault: z.number().nullable(),
      isCalculated: z.boolean(),
      formula: z.unknown(),
      treeId: z.uuid().nullable(),
      treeName: z.string().nullable(),
      recoveryGoalId: z.uuid().nullable(),
      /** How far the recovery objective has got, shown beside the reading. */
      recoveryProgressPct: z.number().nullable(),
      recoveryStartedPct: z.number().nullable(),
    }),
    parent: z
      .object({ id: z.uuid(), title: z.string(), state: z.string() })
      .nullable(),
    children: z.array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        state: z.string(),
        indicatorType: z.string(),
        achievementPct: z.number().nullable(),
      }),
    ),
    records: z.array(
      z.object({
        periodStart: z.string(),
        actualValue: z.number().nullable(),
        targetValue: z.number().nullable(),
        remark: z.string().nullable(),
      }),
    ),
    /** Every other KPI, so the formula builder can offer its references. */
    candidates: z.array(
      z.object({ id: z.uuid(), title: z.string(), frequency: z.string() }),
    ),
    linkedKeyResults: z.array(
      z.object({ id: z.uuid(), title: z.string(), goalId: z.uuid() }),
    ),
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
      async (tx) => {
        const [kpi] = await tx
          .select({
            id: kpis.id,
            shortId: kpis.shortId,
            title: kpis.title,
            categoryName: kpiCategories.name,
            ownerName: workspaceMembers.name,
            namedOwnerId: kpis.ownerMemberId,
            namedOwnerName: namedOwners.name,
            frequency: kpis.frequency,
            unit: kpis.unit,
            indicatorType: kpis.indicatorType,
            tier: kpis.tier,
            state: kpis.state,
            achievementPct: kpis.achievementPct,
            effectivePct: kpis.effectivePct,
            ...KPI_RULE_COLUMNS,
            targetDefault: kpis.targetDefault,
            isCalculated: kpis.isCalculated,
            formula: kpis.formula,
            treeId: kpis.treeId,
            treeName: kpiTrees.name,
            parentKpiId: kpis.parentKpiId,
            ...RECOVERY_COLUMNS,
            recoveryProgress: goals.progressPct,
            recoveryStartedPct: kpis.recoveryStartedPct,
          })
          .from(kpis)
          .leftJoin(kpiCategories, eq(kpiCategories.id, kpis.categoryId))
          .leftJoin(workspaceMembers, eq(workspaceMembers.id, kpis.memberId))
          .leftJoin(kpiTrees, eq(kpiTrees.id, kpis.treeId))
          .leftJoin(goals, recoveryJoin)
          .leftJoin(namedOwners, eq(namedOwners.id, kpis.ownerMemberId))
          .where(
            activeOnly(
              kpis,
              eq(kpis.workspaceId, context.workspaceId),
              eq(kpis.id, input.kpiId),
            ),
          )
          .limit(1);
        if (!kpi) {
          throw new OperationError("not_found", "No such KPI.");
        }

        const [parent] = kpi.parentKpiId
          ? await tx
              .select({
                id: kpis.id,
                title: kpis.title,
                state: kpis.state,
              })
              .from(kpis)
              .where(
                activeOnly(
                  kpis,
                  eq(kpis.workspaceId, context.workspaceId),
                  eq(kpis.id, kpi.parentKpiId),
                ),
              )
              .limit(1)
          : [];

        const children = await tx
          .select({
            id: kpis.id,
            title: kpis.title,
            state: kpis.state,
            indicatorType: kpis.indicatorType,
            achievementPct: kpis.achievementPct,
          })
          .from(kpis)
          .where(
            activeOnly(
              kpis,
              eq(kpis.workspaceId, context.workspaceId),
              eq(kpis.parentKpiId, input.kpiId),
            ),
          )
          .orderBy(asc(kpis.position), asc(kpis.title));

        const records = await loadKpiRecords(
          tx,
          context.workspaceId,
          input.kpiId,
          input.periods,
        );

        const candidates = await tx
          .select({
            id: kpis.id,
            title: kpis.title,
            frequency: kpis.frequency,
          })
          .from(kpis)
          .where(
            activeOnly(
              kpis,
              eq(kpis.workspaceId, context.workspaceId),
              ne(kpis.id, input.kpiId),
            ),
          )
          .orderBy(asc(kpis.title));

        const linked = await tx
          .select({
            id: keyResults.id,
            title: keyResults.title,
            goalId: keyResults.goalId,
          })
          .from(keyResults)
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, context.workspaceId),
              eq(keyResults.kpiId, input.kpiId),
            ),
          );

        return {
          kpi: {
            id: kpi.id,
            shortId: kpi.shortId,
            title: kpi.title,
            categoryName: kpi.categoryName,
            ownerName: kpi.ownerName,
            namedOwnerId: kpi.namedOwnerId,
            namedOwnerName: kpi.namedOwnerName,
            frequency: kpi.frequency,
            unit: kpi.unit,
            direction: kpi.direction,
            indicatorType: kpi.indicatorType,
            tier: kpi.tier,
            state: shownState(kpi),
            recovering: isRecovering(kpi),
            achievementPct:
              kpi.achievementPct === null ? null : Number(kpi.achievementPct),
            effectivePct:
              kpi.effectivePct === null ? null : Number(kpi.effectivePct),
            healthyPct: Number(kpi.healthyPct),
            watchPct: Number(kpi.watchPct),
            ...ruleOf(kpi),
            targetDefault:
              kpi.targetDefault === null ? null : Number(kpi.targetDefault),
            isCalculated: kpi.isCalculated,
            formula: kpi.formula,
            treeId: kpi.treeId,
            treeName: kpi.treeName,
            recoveryGoalId: kpi.recoveryGoalId,
            recoveryProgressPct:
              kpi.recoveryProgress === null
                ? null
                : Number(kpi.recoveryProgress),
            recoveryStartedPct:
              kpi.recoveryStartedPct === null
                ? null
                : Number(kpi.recoveryStartedPct),
          },
          parent: parent ?? null,
          children: children.map((child) => ({
            ...child,
            achievementPct:
              child.achievementPct === null
                ? null
                : Number(child.achievementPct),
          })),
          records: records.map((record) => ({
            periodStart: record.periodStart,
            actualValue:
              record.actualValue === null ? null : Number(record.actualValue),
            targetValue:
              record.targetValue === null ? null : Number(record.targetValue),
            remark: record.remark,
          })),
          candidates,
          linkedKeyResults: linked,
        };
      },
    );
  },
});

export const readRecoveryDraft = defineReadAction({
  name: "kpis.recoveryDraft",
  summary:
    "The recovery objective a KPI would get, so it can be read before it is committed to.",
  input: z.object({ kpiId: z.uuid() }),
  output: z
    .object({
      objective: z.string(),
      /** Names the KPI and leaves the why to its owner (§6.5, P9-T18a). */
      description: z.string(),
      kind: z.enum(["committed"]),
      keyResults: z.array(
        z.object({
          title: z.string(),
          direction: z.string(),
          baseline: z.number(),
          target: z.number(),
          ownerMemberId: z.uuid().nullable(),
          sourceKpiId: z.uuid().nullable(),
          /** The first key result reads the KPI it is. */
          kpiBacked: z.boolean(),
        }),
      ),
    })
    .nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const rhythm = resolveRhythm(
          await readRhythmRow(tx, context.workspaceId),
        );
        const draft = await draftRecoveryForKpi(
          tx,
          context.workspaceId,
          input.kpiId,
          Number(rhythm.thresholds["kpi.recoveryKeyResultCap"]),
        );
        return draft
          ? {
              objective: draft.objective,
              description: draft.description,
              kind: draft.kind,
              keyResults: [...draft.keyResults],
            }
          : null;
      },
    );
  },
});
