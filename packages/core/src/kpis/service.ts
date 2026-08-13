import { activeOnly, kpiRecords, kpis, newId } from "@openokr/db";
import {
  type KpiDirection,
  type KpiFrequency,
  kpiAchievement,
  kpiState,
  normalisePeriod,
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

export interface KpiRecomputeResult {
  readonly achievementPct: number | null;
  readonly state: string;
  readonly diagnostic: string | null;
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
 * The effective figure (design §4) and the recovery link belong to P3-T14. Until
 * then the recovery argument is always `none`, so `recovering` is unreachable,
 * which is honest: no recovery goal can exist yet.
 */
export async function recomputeKpi(
  tx: OperationTx,
  workspaceId: string,
  kpiId: string,
): Promise<KpiRecomputeResult> {
  const [kpi] = await tx
    .select({
      direction: kpis.direction,
      targetDefault: kpis.targetDefault,
      healthyPct: kpis.healthyPct,
      watchPct: kpis.watchPct,
      recoveryGoalId: kpis.recoveryGoalId,
    })
    .from(kpis)
    .where(
      activeOnly(kpis, eq(kpis.workspaceId, workspaceId), eq(kpis.id, kpiId)),
    )
    .limit(1);
  if (!kpi) {
    return { achievementPct: null, state: "no_data", diagnostic: null };
  }

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

  const actual =
    latest?.actualValue == null ? null : Number(latest.actualValue);
  const target =
    latest?.targetValue != null
      ? Number(latest.targetValue)
      : kpi.targetDefault != null
        ? Number(kpi.targetDefault)
        : null;

  const achievement = kpiAchievement(
    kpi.direction as KpiDirection,
    actual,
    target,
  );
  // P3-T14 supplies the real recovery link. `none` until then, because no
  // recovery goal can exist yet and claiming otherwise would be inventing one.
  const state = kpiState(achievement.pct, "none", {
    healthyPct: Number(kpi.healthyPct),
    watchPct: Number(kpi.watchPct),
  });

  // openokr:allow-mutation: same transaction.
  await tx
    .update(kpis)
    .set({
      achievementPct: achievement.pct === null ? null : String(achievement.pct),
      state,
      updatedAt: new Date(),
    })
    .where(
      activeOnly(kpis, eq(kpis.workspaceId, workspaceId), eq(kpis.id, kpiId)),
    );

  return {
    achievementPct: achievement.pct,
    state,
    diagnostic: achievement.diagnostic,
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
