import { activeOnly, goals, kpiRecords, kpis, newId } from "@openokr/db";
import {
  type KpiReading as KpiBandReading,
  type KpiDirection,
  type KpiFrequency,
  type KpiState,
  type KpiTargetType,
  type KpiThresholds,
  kpiEffectiveHealth,
  kpiReading,
  kpiState,
  kpiStateOf,
  normalisePeriod,
  type RecoveryLink,
  shouldProposeRecoveryClose,
  targetTypeOfDirection,
} from "@openokr/method";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { OperationTx } from "../operations/operation.ts";

/**
 * The KPI engine's half that needs rows (METHOD.md §6.4, design
 * `p3-t00-kpi-engine.md` §1 to §3, P3-T12).
 *
 * The arithmetic is in `packages/method`. This normalises a period before the
 * unique index sees it, upserts the record, and recomputes the derived columns in
 * the same transaction.
 *
 * **Recompute runs in the writing transaction**, the same call P3-T05 made for
 * the scoring cascade and P3-T09 made for alignment, and for the same two
 * reasons: no relay host drains the outbox, and in-transaction leaves no window
 * where the grid shows a state the records no longer support.
 */

/** The columns a KPI's reading is decided by (§6.2, §6.4, P9-T17a). */
export interface KpiRule {
  readonly direction: string;
  readonly targetType: string | null;
  readonly greenLow: string | null;
  readonly greenHigh: string | null;
  readonly redLow: string | null;
  readonly redHigh: string | null;
  readonly healthyPct: string;
  readonly watchPct: string;
}

/** The selection that loads a `KpiRule`, so every reader asks for the same columns. */
export const KPI_RULE_COLUMNS = {
  direction: kpis.direction,
  targetType: kpis.targetType,
  greenLow: kpis.greenLow,
  greenHigh: kpis.greenHigh,
  redLow: kpis.redLow,
  redHigh: kpis.redHigh,
  healthyPct: kpis.healthyPct,
  watchPct: kpis.watchPct,
} as const;

/** A KPI written before target types reads as the type its direction implies. */
export function targetTypeOf(rule: KpiRule): KpiTargetType {
  return (
    (rule.targetType as KpiTargetType | null) ??
    targetTypeOfDirection(rule.direction as KpiDirection)
  );
}

const numberOrNull = (value: string | null): number | null =>
  value === null ? null : Number(value);

export function thresholdsOf(rule: KpiRule): KpiThresholds {
  return {
    greenLow: numberOrNull(rule.greenLow),
    greenHigh: numberOrNull(rule.greenHigh),
    redLow: numberOrNull(rule.redLow),
    redHigh: numberOrNull(rule.redHigh),
  };
}

/** One reading of this KPI, for an actual against a target (§6.4). */
export function readingOf(
  rule: KpiRule,
  actual: number | null,
  target: number | null,
): KpiBandReading {
  return kpiReading({
    targetType: targetTypeOf(rule),
    thresholds: thresholdsOf(rule),
    actual,
    target,
    corridor: {
      healthyPct: Number(rule.healthyPct),
      watchPct: Number(rule.watchPct),
    },
  });
}

/**
 * The state a reader shows (§6.4, P9-T17b-a): the band. A row stored as
 * `recovering` before the recovery moved beside the band is read as the band
 * its achievement gives, which is the rule it was judged by; data change 0021
 * rewrites those rows, and this covers any it left.
 */
export function shownState(row: {
  readonly state: string;
  readonly achievementPct: string | null;
  readonly healthyPct: string;
  readonly watchPct: string;
}): KpiState {
  if (row.state !== "recovering") {
    return row.state as KpiState;
  }
  return kpiState(
    row.achievementPct === null ? null : Number(row.achievementPct),
    { healthyPct: Number(row.healthyPct), watchPct: Number(row.watchPct) },
  );
}

/**
 * Whether a KPI is recovering, read beside its state (§6.4, P9-T17b-a): it
 * has a recovery goal, and that goal is live and open.
 */
export function isRecovering(row: {
  readonly recoveryGoalId: string | null;
  readonly recoveryGoalLive: string | null;
  readonly recoveryGoalClosedAt: Date | null;
}): boolean {
  return (
    row.recoveryGoalId !== null &&
    row.recoveryGoalLive !== null &&
    row.recoveryGoalClosedAt === null
  );
}

export interface UpsertRecordInput {
  readonly workspaceId: string;
  readonly kpiId: string;
  /** Any date inside the period. Normalised here, never by the caller. */
  readonly on: string;
  readonly actualValue?: number | null;
  readonly targetValue?: number | null;
  readonly remark?: string | null;
  readonly authorMemberId: string;
}

export interface UpsertRecordResult {
  readonly id: string;
  readonly periodStart: string;
  /** False when an existing period was updated, which is the common case. */
  readonly created: boolean;
}

/**
 * Records a value for the period the date falls in.
 *
 * **One row per KPI per period, enforced by the database.** The insert carries an
 * `on conflict` on the unique index rather than a read-then-write, because a
 * read-then-write is exactly the race two people typing in the grid would lose:
 * both read nothing, both insert, one fails or both succeed. Letting Postgres
 * settle it means the second writer updates the first writer's row, which is what
 * design §1 promises.
 *
 * A field left `undefined` is not touched. A field passed as null is cleared.
 * Those are different statements: clearing an actual is somebody saying they do
 * not have the number after all, and omitting it is somebody editing the target.
 */
export async function upsertKpiRecord(
  tx: OperationTx,
  frequency: KpiFrequency,
  input: UpsertRecordInput,
): Promise<UpsertRecordResult> {
  const periodStart = normalisePeriod(frequency, input.on);

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.actualValue !== undefined) {
    set.actualValue =
      input.actualValue === null ? null : String(input.actualValue);
  }
  if (input.targetValue !== undefined) {
    set.targetValue =
      input.targetValue === null ? null : String(input.targetValue);
  }
  if (input.remark !== undefined) {
    set.remark = input.remark;
  }
  // A soft-deleted row for this period is revived rather than duplicated: the
  // unique index is not partial on `deleted_at` precisely so this path exists.
  set.deletedAt = null;

  const id = newId();
  // openokr:allow-mutation: the calling Operation's own transaction.
  const [row] = await tx
    .insert(kpiRecords)
    .values({
      id,
      workspaceId: input.workspaceId,
      kpiId: input.kpiId,
      periodStart,
      actualValue:
        input.actualValue === undefined || input.actualValue === null
          ? null
          : String(input.actualValue),
      targetValue:
        input.targetValue === undefined || input.targetValue === null
          ? null
          : String(input.targetValue),
      remark: input.remark ?? null,
      authorMemberId: input.authorMemberId,
    })
    .onConflictDoUpdate({
      target: [
        kpiRecords.workspaceId,
        kpiRecords.kpiId,
        kpiRecords.periodStart,
      ],
      set,
    })
    .returning({ id: kpiRecords.id });

  return {
    id: row?.id ?? id,
    periodStart,
    created: row?.id === id,
  };
}

export interface KpiReading {
  readonly actualValue: number;
  /** Null when the period was recorded without one. */
  readonly targetValue: number | null;
}

/**
 * The newest period that has an actual value, or null when nothing is recorded.
 *
 * One definition, because two readers need the same answer: the achievement
 * below, and the key results that read this KPI (completeness review M-07). A
 * key result showing one period's value beside a progress bar computed from
 * another would be two numbers for one measure.
 */
export async function latestKpiReading(
  tx: OperationTx,
  workspaceId: string,
  kpiId: string,
): Promise<KpiReading | null> {
  const [latest] = await tx
    .select({
      actualValue: kpiRecords.actualValue,
      targetValue: kpiRecords.targetValue,
    })
    .from(kpiRecords)
    .where(
      activeOnly(
        kpiRecords,
        eq(kpiRecords.workspaceId, workspaceId),
        eq(kpiRecords.kpiId, kpiId),
        isNotNull(kpiRecords.actualValue),
      ),
    )
    .orderBy(desc(kpiRecords.periodStart))
    .limit(1);
  if (!latest || latest.actualValue === null) {
    return null;
  }
  return {
    actualValue: Number(latest.actualValue),
    targetValue:
      latest.targetValue === null ? null : Number(latest.targetValue),
  };
}

export interface KpiRecomputeResult {
  readonly achievementPct: number | null;
  /** §6.5's displayed figure. Equal to achievement unless a recovery is open. */
  readonly effectivePct: number | null;
  readonly state: string;
  readonly diagnostic: string | null;
  /** True when this recompute raised §6.5's closure proposal, at most once. */
  readonly closureProposed: boolean;
}

/**
 * How a KPI's recovery goal stands, in the three values §6.4's precedence reads.
 *
 * A goal that was deleted counts as no recovery at all rather than a closed one:
 * a deleted recovery is one nobody ever ran, and leaving the KPI reading
 * `recovering` because of a row that is gone would strand it there forever.
 */
async function loadRecovery(
  tx: OperationTx,
  workspaceId: string,
  recoveryGoalId: string | null,
): Promise<{ link: RecoveryLink; progress: number }> {
  if (!recoveryGoalId) {
    return { link: "none", progress: 0 };
  }
  const [goal] = await tx
    .select({ closedAt: goals.closedAt, progressPct: goals.progressPct })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.id, recoveryGoalId),
      ),
    )
    .limit(1);
  if (!goal) {
    return { link: "none", progress: 0 };
  }
  return {
    link: goal.closedAt === null ? "open" : "closed",
    // The goal's progress is a percentage; §6.5's projection wants a fraction.
    progress: Math.min(1, Math.max(0, Number(goal.progressPct) / 100)),
  };
}

/**
 * Recomputes one KPI's achievement and corridor state (design §2 and §3).
 *
 * **Achievement reads the newest period that has an actual value**, not the
 * current calendar period. A monthly KPI on the third of the month has no value
 * for this month yet, and reading the empty period would flip every KPI in the
 * workspace to `no_data` at every month boundary. The target comes from that same
 * record, falling back to the KPI's default: a period recorded without a target
 * is measured against the standing one rather than against nothing.
 *
 * The effective figure (design §4) is the displayed one while a recovery is
 * open: the higher of real achievement and §6.5's projection. Both are stored,
 * because every surface that shows one has to be able to show the other beside
 * it, and a screen that showed only the projection would be reporting the
 * recovery's own progress as if it were the metric.
 */
export async function recomputeKpi(
  tx: OperationTx,
  workspaceId: string,
  kpiId: string,
  now: Date = new Date(),
): Promise<KpiRecomputeResult> {
  const [kpi] = await tx
    .select({
      ...KPI_RULE_COLUMNS,
      targetDefault: kpis.targetDefault,
      recoveryGoalId: kpis.recoveryGoalId,
      recoveryStartedPct: kpis.recoveryStartedPct,
      recoveryCloseProposedAt: kpis.recoveryCloseProposedAt,
    })
    .from(kpis)
    .where(
      activeOnly(kpis, eq(kpis.workspaceId, workspaceId), eq(kpis.id, kpiId)),
    )
    .limit(1);
  if (!kpi) {
    return {
      achievementPct: null,
      effectivePct: null,
      state: "no_data",
      diagnostic: null,
      closureProposed: false,
    };
  }

  const latest = await latestKpiReading(tx, workspaceId, kpiId);

  const actual = latest?.actualValue ?? null;
  const target =
    latest?.targetValue != null
      ? latest.targetValue
      : kpi.targetDefault != null
        ? Number(kpi.targetDefault)
        : null;

  // By its own thresholds where it has them, by the ratio where it has not
  // (§6.4, P9-T17a). The ratio is still kept for display and the projection.
  const reading = readingOf(kpi, actual, target);
  const achievement = {
    pct: reading.achievementPct,
    diagnostic: reading.diagnostic,
  };
  const healthyPct = Number(kpi.healthyPct);
  const recovery = await loadRecovery(tx, workspaceId, kpi.recoveryGoalId);
  // The band, whatever the recovery is doing (§6.4, P9-T17b-a): a recovery is
  // shown beside it by the readers, never written in its place.
  const state = kpiStateOf(reading.band);

  // Effective health only exists while a recovery is open. A closed one leaves
  // the KPI reading whatever it actually reached, which is the honest outcome
  // whether the recovery worked or not.
  const effective =
    recovery.link === "open"
      ? kpiEffectiveHealth({
          achievementPct: achievement.pct,
          startPct: Number(kpi.recoveryStartedPct ?? achievement.pct ?? 0),
          recoveryProgress: recovery.progress,
          healthyPct,
        })
      : null;
  const effectivePct = effective ? effective.pct : achievement.pct;

  // §6.5's closure end, and it reads **real** achievement rather than the
  // effective figure on purpose: the projection rises with the recovery's own
  // progress, so closing on it would close a recovery because the recovery was
  // going well, which is circular. The stamp is the "exactly once".
  const closureProposed = shouldProposeRecoveryClose({
    achievementPct: achievement.pct,
    recovery: recovery.link,
    alreadyProposed: kpi.recoveryCloseProposedAt !== null,
    healthyPct,
    // The real band decides where thresholds do: a KPI back inside its green
    // boundary is healthy whatever its ratio to target says.
    ...(reading.basis === "thresholds" ? { band: reading.band } : {}),
  });

  // openokr:allow-mutation: same transaction.
  await tx
    .update(kpis)
    .set({
      achievementPct: achievement.pct === null ? null : String(achievement.pct),
      effectivePct: effectivePct === null ? null : String(effectivePct),
      state,
      ...(closureProposed ? { recoveryCloseProposedAt: now } : {}),
      updatedAt: now,
    })
    .where(
      activeOnly(kpis, eq(kpis.workspaceId, workspaceId), eq(kpis.id, kpiId)),
    );

  return {
    achievementPct: achievement.pct,
    effectivePct,
    state,
    diagnostic: achievement.diagnostic ?? effective?.diagnostic ?? null,
    closureProposed,
  };
}

/** Every period a grid column needs, newest first, for one KPI. */
export async function loadKpiRecords(
  tx: OperationTx,
  workspaceId: string,
  kpiId: string,
  limit = 24,
) {
  return tx
    .select({
      id: kpiRecords.id,
      periodStart: kpiRecords.periodStart,
      actualValue: kpiRecords.actualValue,
      targetValue: kpiRecords.targetValue,
      remark: kpiRecords.remark,
    })
    .from(kpiRecords)
    .where(
      activeOnly(
        kpiRecords,
        and(
          eq(kpiRecords.workspaceId, workspaceId),
          eq(kpiRecords.kpiId, kpiId),
        ),
      ),
    )
    .orderBy(desc(kpiRecords.periodStart))
    .limit(limit);
}
