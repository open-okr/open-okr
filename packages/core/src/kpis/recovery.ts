import { activeOnly, goals, kpiRecords, kpis } from "@openokr/db";
import {
  draftRecovery,
  type RecoveryDraft,
  type RecoveryTreeInput,
  type RecoveryTreeNode,
} from "@openokr/method";
import { desc, eq, inArray, isNotNull } from "drizzle-orm";
import { createGoalInTx, createKeyResultInTx } from "../goals/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { recomputeKpi } from "./service.ts";

/**
 * The recovery loop's half that needs rows (METHOD.md §6.5, design
 * `p3-t00-kpi-engine.md` §8, P3-T14).
 *
 * The walk and every string it produces are in `packages/method`. This loads
 * the subtree, hands it over, and turns the draft into a real goal through the
 * ordinary goal service rather than by inserting rows: a recovery objective is
 * an objective, and one created down a side path would miss its access context,
 * its activity row and its first key result history.
 */

interface KpiValue {
  readonly actual: number | null;
  readonly target: number | null;
}

/**
 * The newest recorded actual per KPI, with the target from that same record and
 * the KPI's standing default behind it.
 *
 * The same rule the recompute uses, for the same reason: a monthly KPI on the
 * third of the month has no value for this month yet, and reading the empty
 * period would make every driver look unmeasured.
 */
async function loadValues(
  tx: OperationTx,
  workspaceId: string,
  ids: readonly string[],
  defaults: ReadonlyMap<string, number | null>,
): Promise<Map<string, KpiValue>> {
  const values = new Map<string, KpiValue>();
  for (const id of ids) {
    values.set(id, { actual: null, target: defaults.get(id) ?? null });
  }
  if (ids.length === 0) {
    return values;
  }

  const rows = await tx
    .select({
      kpiId: kpiRecords.kpiId,
      periodStart: kpiRecords.periodStart,
      actualValue: kpiRecords.actualValue,
      targetValue: kpiRecords.targetValue,
    })
    .from(kpiRecords)
    .where(
      activeOnly(
        kpiRecords,
        eq(kpiRecords.workspaceId, workspaceId),
        inArray(kpiRecords.kpiId, [...ids]),
        isNotNull(kpiRecords.actualValue),
      ),
    )
    .orderBy(desc(kpiRecords.periodStart));

  // Ordered newest first, so the first row seen for a KPI is its latest.
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.kpiId)) {
      continue;
    }
    seen.add(row.kpiId);
    values.set(row.kpiId, {
      actual: row.actualValue === null ? null : Number(row.actualValue),
      target:
        row.targetValue !== null
          ? Number(row.targetValue)
          : (defaults.get(row.kpiId) ?? null),
    });
  }
  return values;
}

/**
 * The KPI and everything under it, in the shape §6.5's walk expects.
 *
 * Loads the workspace's KPIs once and descends in memory rather than issuing a
 * query per level: a driver tree is small, and a recursive query per node would
 * be a round trip per level of a structure somebody is waiting on.
 */
async function loadRecoveryTree(
  tx: OperationTx,
  workspaceId: string,
  kpiId: string,
): Promise<RecoveryTreeInput | null> {
  const all = await tx
    .select({
      id: kpis.id,
      parentKpiId: kpis.parentKpiId,
      title: kpis.title,
      indicatorType: kpis.indicatorType,
      direction: kpis.direction,
      targetDefault: kpis.targetDefault,
      memberId: kpis.memberId,
      position: kpis.position,
    })
    .from(kpis)
    .where(activeOnly(kpis, eq(kpis.workspaceId, workspaceId)));

  const root = all.find((row) => row.id === kpiId);
  if (!root) {
    return null;
  }

  const childrenOf = new Map<string, typeof all>();
  for (const row of all) {
    if (!row.parentKpiId) {
      continue;
    }
    const siblings = childrenOf.get(row.parentKpiId);
    if (siblings) {
      siblings.push(row);
    } else {
      childrenOf.set(row.parentKpiId, [row]);
    }
  }

  const subtree: typeof all = [];
  const queue = [...(childrenOf.get(kpiId) ?? [])];
  const seen = new Set<string>([kpiId]);
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    subtree.push(node);
    queue.push(...(childrenOf.get(node.id) ?? []));
  }

  const defaults = new Map<string, number | null>(
    [root, ...subtree].map((row) => [
      row.id,
      row.targetDefault === null ? null : Number(row.targetDefault),
    ]),
  );
  const values = await loadValues(
    tx,
    workspaceId,
    [root.id, ...subtree.map((row) => row.id)],
    defaults,
  );

  const nodes: RecoveryTreeNode[] = subtree.map((row) => {
    const value = values.get(row.id);
    return {
      id: row.id,
      parent: row.parentKpiId ?? kpiId,
      type: row.indicatorType,
      title: row.title,
      direction: row.direction,
      current: value?.actual ?? 0,
      target: value?.target ?? 0,
      owner: row.memberId,
      position: row.position,
    };
  });

  const rootValue = values.get(root.id);
  return {
    root: {
      id: root.id,
      title: root.title,
      target: rootValue?.target ?? 0,
      current: rootValue?.actual ?? 0,
    },
    nodes,
  };
}

/** The draft a screen shows before anybody commits to it. */
export async function draftRecoveryForKpi(
  tx: OperationTx,
  workspaceId: string,
  kpiId: string,
  keyResultCap: number,
): Promise<RecoveryDraft | null> {
  const tree = await loadRecoveryTree(tx, workspaceId, kpiId);
  return tree ? draftRecovery(tree, keyResultCap) : null;
}

export interface LaunchRecoveryInput {
  readonly workspaceId: string;
  readonly kpiId: string;
  /** The member launching it, who champions and reviews the recovery goal. */
  readonly memberId: string;
  /**
   * The cycle the recovery objective lives in. Required, and not defaulted to a
   * made-up window: §4.1 gives a goal a cycle or a stated timeframe and never
   * neither, and choosing dates on somebody's behalf is a decision, not a
   * fallback.
   */
  readonly cycleId: string;
  readonly spaceId: string | null;
  readonly keyResultCap: number;
  /**
   * A title to use instead of §6.5's template sentence (P4-T05c-b).
   *
   * The only thing a model is allowed to change about a recovery objective.
   * The key results, their baselines, their targets and the breadth-first walk
   * that chose them all stay §6.5's, because those are the practice and a
   * sentence is not. Absent is the ordinary case.
   */
  readonly objectiveTitle?: string;
  readonly now?: Date;
}

export interface LaunchedRecovery {
  readonly goalId: string;
  readonly keyResultIds: readonly string[];
  readonly startedPct: number | null;
}

/**
 * §6.5's launch, as one Operation's worth of work.
 *
 * The KPI's achievement at launch is stamped before anything else moves, since
 * it is the floor every later projection is measured from, and reading it back
 * afterwards would read a number the launch itself had already changed.
 */
export async function launchRecoveryInTx(
  tx: OperationTx,
  input: LaunchRecoveryInput,
): Promise<LaunchedRecovery> {
  const now = input.now ?? new Date();
  const [kpi] = await tx
    .select({
      id: kpis.id,
      title: kpis.title,
      state: kpis.state,
      achievementPct: kpis.achievementPct,
      recoveryGoalId: kpis.recoveryGoalId,
      spaceId: kpis.spaceId,
    })
    .from(kpis)
    .where(
      activeOnly(
        kpis,
        eq(kpis.workspaceId, input.workspaceId),
        eq(kpis.id, input.kpiId),
      ),
    )
    .limit(1);
  if (!kpi) {
    throw new OperationError("not_found", "No such KPI.");
  }
  if (kpi.recoveryGoalId) {
    // One **open** recovery per KPI. A second open one would give the same
    // metric two competing plans and make effective health ambiguous: whose
    // progress? A closed one is history, and a KPI that fell over twice is
    // entitled to a second recovery.
    const [existing] = await tx
      .select({ closedAt: goals.closedAt })
      .from(goals)
      .where(
        activeOnly(
          goals,
          eq(goals.workspaceId, input.workspaceId),
          eq(goals.id, kpi.recoveryGoalId),
        ),
      )
      .limit(1);
    if (existing && existing.closedAt === null) {
      throw new OperationError(
        "forbidden",
        "This KPI already has a recovery objective. Close it before launching another.",
      );
    }
  }

  const tree = await loadRecoveryTree(tx, input.workspaceId, input.kpiId);
  if (!tree) {
    throw new OperationError("not_found", "No such KPI.");
  }
  const draft = draftRecovery(tree, input.keyResultCap);

  // The KPI's own space unless the caller names one, because a recovery belongs
  // to whoever owns the metric.
  const spaceId = input.spaceId ?? kpi.spaceId;
  const goal = await createGoalInTx(tx, {
    workspaceId: input.workspaceId,
    // The drafted sentence when one was offered, the §6.5 template otherwise.
    title: input.objectiveTitle?.trim() || draft.objective,
    cycleId: input.cycleId,
    level: "team",
    ownerKind: spaceId ? "space" : "workspace",
    spaceId,
    // The launcher champions and reviews it. §2.5 needs both filled, and the
    // person who launched a recovery is the one who owes the check-ins on it
    // until somebody reassigns the role through the ordinary path.
    championId: input.memberId,
    reviewerId: input.memberId,
  });

  const keyResultIds: string[] = [];
  for (const keyResult of draft.keyResults) {
    const created = await createKeyResultInTx(tx, {
      workspaceId: input.workspaceId,
      goalId: goal.id,
      title: keyResult.title,
      direction: keyResult.direction,
      // Always leading. That is what made it a driver (design §8).
      indicatorType: "leading",
      baselineValue: keyResult.baseline,
      targetValue: keyResult.target,
      ownerId: keyResult.ownerMemberId,
      authorMemberId: input.memberId,
    });
    keyResultIds.push(created.id);
  }

  const startedPct =
    kpi.achievementPct === null ? null : Number(kpi.achievementPct);

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(kpis)
    .set({
      recoveryGoalId: goal.id,
      recoveryStartedPct: startedPct === null ? null : String(startedPct),
      // A fresh recovery has proposed nothing yet, whatever the last one did.
      recoveryCloseProposedAt: null,
      updatedAt: now,
    })
    .where(
      activeOnly(
        kpis,
        eq(kpis.workspaceId, input.workspaceId),
        eq(kpis.id, input.kpiId),
      ),
    );

  // The state flips to `recovering` through the one recompute entry point
  // rather than by writing the word here, so the corridor precedence stays in
  // one place.
  await recomputeKpi(tx, input.workspaceId, input.kpiId, now);

  return { goalId: goal.id, keyResultIds, startedPct };
}
