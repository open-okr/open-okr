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
  KPI_AGGREGATES,
  KPI_DIRECTION_VALUES,
  KPI_FREQUENCY_VALUES,
  KPI_OWNER_KINDS,
  KPI_TIERS,
  kpiCategories,
  kpis,
  newId,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { type KpiFrequency, normalisePeriod } from "@openokr/method";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  cascadeFromKpi,
  evaluateKpiForPeriod,
  setKpiFormula,
} from "../kpis/formula.ts";
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
  input: z.object({ name: z.string().trim().min(1).max(120) }),
  output: z.object({ id: z.uuid(), name: z.string() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      await actingMember(tx, workspaceId, context.actor.userId);
      const id = newId();
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx.insert(kpiCategories).values({
        id,
        workspaceId,
        name: input.name,
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
  }),
  output: z.object({ id: z.uuid(), shortId: z.string() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      await actingMember(tx, workspaceId, context.actor.userId);

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
