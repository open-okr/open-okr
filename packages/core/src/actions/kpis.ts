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
  kpis,
  kpiTrees,
  newId,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { type KpiFrequency, normalisePeriod } from "@openokr/method";
import { asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
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
import { draftRecoveryForKpi, launchRecoveryInTx } from "../kpis/recovery.ts";
import {
  loadKpiRecords,
  recomputeKpi,
  upsertKpiRecord,
} from "../kpis/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

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
    direction: z.enum(KPI_DIRECTION_VALUES).default("higher_better"),
    indicatorType: z.enum(["leading", "lagging"]).default("lagging"),
    tier: z.enum(KPI_TIERS).default("output"),
    aggregate: z.enum(KPI_AGGREGATES).default("sum"),
    ownerKind: z.enum(KPI_OWNER_KINDS).default("workspace"),
    spaceId: z.uuid().optional(),
    memberId: z.uuid().optional(),
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

      if (
        (input.healthyPct !== undefined || input.watchPct !== undefined) &&
        (input.watchPct ?? 70) > (input.healthyPct ?? 90)
      ) {
        // The corridor reads from below in both bands, so a watch band above the
        // healthy band would put every KPI in `watch` and none in `healthy`. The
        // database refuses it too; this says why.
        throw new OperationError(
          "forbidden",
          "The watch threshold cannot sit above the healthy threshold. Both bands are read from below.",
        );
      }

      const id = newId();
      const short = shortId();
      // openokr:allow-mutation: same transaction.
      await tx.insert(kpis).values({
        id,
        workspaceId,
        shortId: short,
        title: input.title,
        frequency: input.frequency,
        direction: input.direction,
        indicatorType: input.indicatorType,
        tier: input.tier,
        aggregate: input.aggregate,
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
        ...(input.healthyPct === undefined
          ? {}
          : { healthyPct: String(input.healthyPct) }),
        ...(input.watchPct === undefined
          ? {}
          : { watchPct: String(input.watchPct) }),
        ...legacyColumns(input.legacy),
      });

      // No records yet, so this settles the KPI at `no_data` rather than leaving
      // the column at its default and hoping they agree.
      await recomputeKpi(tx, workspaceId, id);

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
    on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
        tier: z.string(),
        state: z.string(),
        achievementPct: z.number().nullable(),
        targetDefault: z.number().nullable(),
        healthyPct: z.number(),
        watchPct: z.number(),
        isCalculated: z.boolean(),
        records: z.array(
          z.object({
            periodStart: z.string(),
            actualValue: z.number().nullable(),
            targetValue: z.number().nullable(),
            remark: z.string().nullable(),
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
            direction: kpis.direction,
            indicatorType: kpis.indicatorType,
            tier: kpis.tier,
            state: kpis.state,
            achievementPct: kpis.achievementPct,
            targetDefault: kpis.targetDefault,
            healthyPct: kpis.healthyPct,
            watchPct: kpis.watchPct,
            isCalculated: kpis.isCalculated,
          })
          .from(kpis)
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
            achievementPct:
              kpi.achievementPct === null ? null : Number(kpi.achievementPct),
            targetDefault:
              kpi.targetDefault === null ? null : Number(kpi.targetDefault),
            healthyPct: Number(kpi.healthyPct),
            watchPct: Number(kpi.watchPct),
            records: records.map((record) => ({
              periodStart: String(record.periodStart),
              actualValue:
                record.actualValue === null ? null : Number(record.actualValue),
              targetValue:
                record.targetValue === null ? null : Number(record.targetValue),
              remark: record.remark,
            })),
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

export const setKpiFormulaAction = defineWriteAction({
  name: "kpis.setFormula",
  summary:
    "Makes a KPI calculated from a formula over other KPIs, refusing self-reference and cycles.",
  input: z.object({
    kpiId: z.uuid(),
    /** The stored tree. Validated by the engine, never parsed from a string. */
    formula: z.unknown(),
    /** Any date inside the period to evaluate straight away. */
    on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
    indicatorType: z.enum(["leading", "lagging"]).optional(),
    tier: z.enum(KPI_TIERS).optional(),
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
      await actingMember(tx, workspaceId, context.actor.userId);

      const [existing] = await tx
        .select({
          id: kpis.id,
          healthyPct: kpis.healthyPct,
          watchPct: kpis.watchPct,
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
      if (input.direction !== undefined) {
        set.direction = input.direction;
      }
      if (input.indicatorType !== undefined) {
        set.indicatorType = input.indicatorType;
      }
      if (input.tier !== undefined) {
        set.tier = input.tier;
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
    state: z.string(),
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
          state: "recovering",
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
        state: z.string(),
        achievementPct: z.number().nullable(),
        effectivePct: z.number().nullable(),
        healthyPct: z.number(),
        watchPct: z.number(),
        unit: z.string().nullable(),
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
            recoveryGoalId: kpis.recoveryGoalId,
            recoveryStartedPct: kpis.recoveryStartedPct,
            recoveryCloseProposedAt: kpis.recoveryCloseProposedAt,
            goalTitle: goals.title,
            goalProgress: goals.progressPct,
            goalClosedAt: goals.closedAt,
          })
          .from(kpis)
          .leftJoin(kpiTrees, eq(kpiTrees.id, kpis.treeId))
          .leftJoin(goals, eq(goals.id, kpis.recoveryGoalId))
          .where(
            activeOnly(
              kpis,
              eq(kpis.workspaceId, context.workspaceId),
              inArray(kpis.state, ["unhealthy", "recovering"]),
            ),
          )
          .orderBy(asc(kpis.title));

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
            state: row.state,
            achievementPct:
              row.achievementPct === null ? null : Number(row.achievementPct),
            effectivePct:
              row.effectivePct === null ? null : Number(row.effectivePct),
            healthyPct: Number(row.healthyPct),
            watchPct: Number(row.watchPct),
            unit: row.unit,
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
    nodes: z.array(
      z.object({
        id: z.uuid(),
        parentKpiId: z.uuid().nullable(),
        title: z.string(),
        unit: z.string().nullable(),
        indicatorType: z.string(),
        tier: z.string(),
        direction: z.string(),
        state: z.string(),
        achievementPct: z.number().nullable(),
        effectivePct: z.number().nullable(),
        healthyPct: z.number(),
        watchPct: z.number(),
        targetDefault: z.number().nullable(),
        recoveryGoalId: z.uuid().nullable(),
        recoveryProgressPct: z.number().nullable(),
      }),
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
          .select({
            id: kpis.id,
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
            recoveryProgress: goals.progressPct,
            position: kpis.position,
          })
          .from(kpis)
          .leftJoin(goals, eq(goals.id, kpis.recoveryGoalId))
          .where(
            activeOnly(
              kpis,
              eq(kpis.workspaceId, context.workspaceId),
              treeId === null ? isNull(kpis.treeId) : eq(kpis.treeId, treeId),
            ),
          )
          .orderBy(asc(kpis.position), asc(kpis.title));

        return {
          trees,
          treeId,
          nodes: rows.map((row) => ({
            id: row.id,
            parentKpiId: row.parentKpiId,
            title: row.title,
            unit: row.unit,
            indicatorType: row.indicatorType,
            tier: row.tier,
            direction: row.direction,
            state: row.state,
            achievementPct:
              row.achievementPct === null ? null : Number(row.achievementPct),
            effectivePct:
              row.effectivePct === null ? null : Number(row.effectivePct),
            healthyPct: Number(row.healthyPct),
            watchPct: Number(row.watchPct),
            targetDefault:
              row.targetDefault === null ? null : Number(row.targetDefault),
            recoveryGoalId: row.recoveryGoalId,
            recoveryProgressPct:
              row.recoveryProgress === null
                ? null
                : Number(row.recoveryProgress),
          })),
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
      frequency: z.string(),
      unit: z.string().nullable(),
      direction: z.string(),
      indicatorType: z.string(),
      tier: z.string(),
      state: z.string(),
      achievementPct: z.number().nullable(),
      effectivePct: z.number().nullable(),
      healthyPct: z.number(),
      watchPct: z.number(),
      targetDefault: z.number().nullable(),
      isCalculated: z.boolean(),
      formula: z.unknown(),
      treeId: z.uuid().nullable(),
      treeName: z.string().nullable(),
      recoveryGoalId: z.uuid().nullable(),
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
            frequency: kpis.frequency,
            unit: kpis.unit,
            direction: kpis.direction,
            indicatorType: kpis.indicatorType,
            tier: kpis.tier,
            state: kpis.state,
            achievementPct: kpis.achievementPct,
            effectivePct: kpis.effectivePct,
            healthyPct: kpis.healthyPct,
            watchPct: kpis.watchPct,
            targetDefault: kpis.targetDefault,
            isCalculated: kpis.isCalculated,
            formula: kpis.formula,
            treeId: kpis.treeId,
            treeName: kpiTrees.name,
            parentKpiId: kpis.parentKpiId,
            recoveryGoalId: kpis.recoveryGoalId,
            recoveryStartedPct: kpis.recoveryStartedPct,
          })
          .from(kpis)
          .leftJoin(kpiCategories, eq(kpiCategories.id, kpis.categoryId))
          .leftJoin(workspaceMembers, eq(workspaceMembers.id, kpis.memberId))
          .leftJoin(kpiTrees, eq(kpiTrees.id, kpis.treeId))
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
            frequency: kpi.frequency,
            unit: kpi.unit,
            direction: kpi.direction,
            indicatorType: kpi.indicatorType,
            tier: kpi.tier,
            state: kpi.state,
            achievementPct:
              kpi.achievementPct === null ? null : Number(kpi.achievementPct),
            effectivePct:
              kpi.effectivePct === null ? null : Number(kpi.effectivePct),
            healthyPct: Number(kpi.healthyPct),
            watchPct: Number(kpi.watchPct),
            targetDefault:
              kpi.targetDefault === null ? null : Number(kpi.targetDefault),
            isCalculated: kpi.isCalculated,
            formula: kpi.formula,
            treeId: kpi.treeId,
            treeName: kpi.treeName,
            recoveryGoalId: kpi.recoveryGoalId,
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
      keyResults: z.array(
        z.object({
          title: z.string(),
          direction: z.string(),
          baseline: z.number(),
          target: z.number(),
          ownerMemberId: z.uuid().nullable(),
          sourceKpiId: z.uuid().nullable(),
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
          ? { objective: draft.objective, keyResults: [...draft.keyResults] }
          : null;
      },
    );
  },
});
