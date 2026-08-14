import {
  activeOnly,
  kpiDependencies,
  kpiRecords,
  kpis,
  newId,
} from "@openokr/db";
import {
  aggregateForPeriod,
  cascadeOrder,
  type DependencyEdge,
  evaluateFormula,
  type FormulaNode,
  type KpiAggregate,
  type KpiFrequency,
  validateFormula,
} from "@openokr/method";
import { eq, inArray } from "drizzle-orm";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { upsertKpiRecord } from "./service.ts";

/**
 * Calculated KPIs: the edge table, the cascade and the per-period evaluation
 * (design `p3-t00-kpi-engine.md` §5 to §7, P3-T13).
 *
 * The grammar, the aggregation and the cascade order are all in
 * `packages/method`. This is the half that loads records, writes edges and walks
 * the graph.
 *
 * **The cascade runs in the writing transaction**, the third time this repository
 * has made that call (P3-T05 scoring, P3-T09 alignment, P3-T12 KPI state) and for
 * the same two reasons: no relay host drains the outbox, and in-transaction leaves
 * no window where a dependent shows a number its source no longer supports. The
 * design document drives it from the outbox and this function is what the relay
 * will call.
 */

/**
 * Replaces one KPI's dependency edges from its formula, refusing a cycle.
 *
 * **The cycle check runs before the insert, against the graph as it would be.**
 * A cycle that reached the table would have to be defended against on every read
 * forever, so the only version of this promise worth making is the one that keeps
 * the table acyclic.
 */
export async function setKpiFormula(
  tx: OperationTx,
  workspaceId: string,
  kpiId: string,
  formula: unknown,
): Promise<{ references: readonly string[] }> {
  const shape = validateFormula(formula);
  if (!shape.ok) {
    throw new OperationError(
      "forbidden",
      shape.problem === "not_a_formula"
        ? "That is not a formula this product can store. A formula is a tree of literals, references and the four operators."
        : `That formula is too large to evaluate safely (${shape.problem?.replace(/_/g, " ")}). These are limits on the evaluator, not thresholds a workspace sets.`,
    );
  }

  if (shape.references.includes(kpiId)) {
    throw new OperationError(
      "forbidden",
      "A KPI cannot be calculated from itself.",
    );
  }

  // Every reference has to exist and be in this workspace. A formula pointing at
  // nothing would evaluate to null forever with no way for a reader to tell why.
  if (shape.references.length > 0) {
    const found = await tx
      .select({ id: kpis.id })
      .from(kpis)
      .where(
        activeOnly(
          kpis,
          eq(kpis.workspaceId, workspaceId),
          inArray(kpis.id, [...shape.references]),
        ),
      );
    if (found.length !== shape.references.length) {
      throw new OperationError(
        "not_found",
        "That formula references a KPI that does not exist here.",
      );
    }
  }

  const existing = await loadEdges(tx, workspaceId);
  // The graph as it would be: this KPI's old edges dropped, the new ones added.
  const proposed: DependencyEdge[] = [
    ...existing.filter((edge) => edge.dependent !== kpiId),
    ...shape.references.map((reference) => ({
      dependent: kpiId,
      dependsOn: reference,
    })),
  ];
  if (cascadeOrder(proposed, kpiId).rejected) {
    throw new OperationError(
      "forbidden",
      "That formula would make a cycle: this KPI would end up depending on itself through another one.",
    );
  }

  const now = new Date();
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(kpiDependencies)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      activeOnly(
        kpiDependencies,
        eq(kpiDependencies.workspaceId, workspaceId),
        eq(kpiDependencies.dependentKpiId, kpiId),
      ),
    );

  for (const reference of shape.references) {
    // openokr:allow-mutation: same transaction.
    await tx.insert(kpiDependencies).values({
      id: newId(),
      workspaceId,
      dependentKpiId: kpiId,
      dependsOnKpiId: reference,
    });
  }

  // openokr:allow-mutation: same transaction.
  await tx
    .update(kpis)
    .set({
      isCalculated: true,
      formula: formula as never,
      updatedAt: now,
    })
    .where(
      activeOnly(kpis, eq(kpis.workspaceId, workspaceId), eq(kpis.id, kpiId)),
    );

  return { references: shape.references };
}

async function loadEdges(
  tx: OperationTx,
  workspaceId: string,
): Promise<DependencyEdge[]> {
  const rows = await tx
    .select({
      dependent: kpiDependencies.dependentKpiId,
      dependsOn: kpiDependencies.dependsOnKpiId,
    })
    .from(kpiDependencies)
    .where(
      activeOnly(kpiDependencies, eq(kpiDependencies.workspaceId, workspaceId)),
    );
  return rows.map((row) => ({
    dependent: row.dependent,
    dependsOn: row.dependsOn,
  }));
}

/**
 * Evaluates one calculated KPI for one period and writes the result.
 *
 * A null result writes **no actual value** and records the diagnostic instead, so
 * the KPI reads `no_data` and the grid can say why rather than showing an empty
 * cell that looks like nobody got round to it.
 */
export async function evaluateKpiForPeriod(
  tx: OperationTx,
  workspaceId: string,
  kpiId: string,
  periodStart: string,
  authorMemberId: string,
): Promise<{ value: number | null; diagnostic: string | null }> {
  const [kpi] = await tx
    .select({
      frequency: kpis.frequency,
      formula: kpis.formula,
      isCalculated: kpis.isCalculated,
    })
    .from(kpis)
    .where(
      activeOnly(kpis, eq(kpis.workspaceId, workspaceId), eq(kpis.id, kpiId)),
    )
    .limit(1);
  if (!kpi?.isCalculated || kpi.formula === null) {
    return { value: null, diagnostic: null };
  }

  const shape = validateFormula(kpi.formula);
  if (!shape.ok) {
    // A stored formula that no longer parses is a fact worth reporting rather
    // than a crash: the bounds may have tightened since it was written.
    return { value: null, diagnostic: "missing_source" };
  }

  const sources: Record<string, number | null> = {};
  for (const reference of shape.references) {
    sources[reference] = await resolveReference(
      tx,
      workspaceId,
      reference,
      kpi.frequency as KpiFrequency,
      periodStart,
    );
  }

  const result = evaluateFormula(kpi.formula as FormulaNode, sources);

  await upsertKpiRecord(tx, kpi.frequency as KpiFrequency, {
    workspaceId,
    kpiId,
    on: periodStart,
    actualValue: result.value,
    authorMemberId,
  });

  // openokr:allow-mutation: same transaction.
  await tx
    .update(kpiRecords)
    .set({ diagnostic: result.diagnostic, updatedAt: new Date() })
    .where(
      activeOnly(
        kpiRecords,
        eq(kpiRecords.workspaceId, workspaceId),
        eq(kpiRecords.kpiId, kpiId),
        eq(kpiRecords.periodStart, periodStart),
      ),
    );

  return { value: result.value, diagnostic: result.diagnostic };
}

/** One source's value for the target period, folded by its own aggregate (§6). */
async function resolveReference(
  tx: OperationTx,
  workspaceId: string,
  sourceKpiId: string,
  targetFrequency: KpiFrequency,
  targetPeriodStart: string,
): Promise<number | null> {
  const [source] = await tx
    .select({ frequency: kpis.frequency, aggregate: kpis.aggregate })
    .from(kpis)
    .where(
      activeOnly(
        kpis,
        eq(kpis.workspaceId, workspaceId),
        eq(kpis.id, sourceKpiId),
      ),
    )
    .limit(1);
  if (!source) {
    return null;
  }

  const rows = await tx
    .select({
      periodStart: kpiRecords.periodStart,
      actualValue: kpiRecords.actualValue,
    })
    .from(kpiRecords)
    .where(
      activeOnly(
        kpiRecords,
        eq(kpiRecords.workspaceId, workspaceId),
        eq(kpiRecords.kpiId, sourceKpiId),
      ),
    );

  return aggregateForPeriod(
    source.frequency as KpiFrequency,
    targetFrequency,
    source.aggregate as KpiAggregate,
    rows.flatMap((row) =>
      row.actualValue === null
        ? []
        : [
            {
              periodStart: String(row.periodStart),
              value: Number(row.actualValue),
            },
          ],
    ),
    targetPeriodStart,
  );
}

/**
 * Recomputes everything downstream of a changed KPI, in topological order.
 *
 * Returns the identifiers it touched, so a caller can recompute their corridor
 * states afterwards without walking the graph again.
 */
export async function cascadeFromKpi(
  tx: OperationTx,
  workspaceId: string,
  changedKpiId: string,
  periodStart: string,
  authorMemberId: string,
): Promise<readonly string[]> {
  const edges = await loadEdges(tx, workspaceId);
  const cascade = cascadeOrder(edges, changedKpiId);
  if (cascade.rejected) {
    // Unreachable while every write goes through `setKpiFormula`, and worth
    // refusing loudly rather than looping if an import ever puts one in.
    throw new OperationError(
      "forbidden",
      "The KPI dependency graph contains a cycle, so nothing can be recomputed until it is broken.",
    );
  }
  for (const kpiId of cascade.order) {
    await evaluateKpiForPeriod(
      tx,
      workspaceId,
      kpiId,
      periodStart,
      authorMemberId,
    );
  }
  return cascade.order;
}
