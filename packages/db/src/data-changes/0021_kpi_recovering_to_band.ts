/**
 * Gives a KPI stored as `recovering` the band it actually reads (P9-T17b-a).
 *
 * METHOD v2 §6.4 shows a recovery beside a KPI's real band, never instead of
 * it, and the recompute has written only the band since P9-T17b-a. A row the
 * previous release wrote as `recovering` keeps that word until something is
 * recorded against the KPI, which for a metric under a recovery may be weeks.
 *
 * | Stored | This script |
 * |---|---|
 * | `recovering`, no thresholds, no achievement | `no_data` |
 * | `recovering`, no thresholds | The corridor band of its stored achievement: healthy at or above `healthy_pct`, watch at or above `watch_pct`, unhealthy below |
 * | `recovering`, with thresholds | Left for its next recompute. Thresholds arrived in the same release, so no instance upgrading from the last one has such a row |
 *
 * **The corridor rule is repeated here in SQL**, which is the one place it is:
 * `packages/db` cannot reach `packages/method`, and these rows were judged by
 * that rule and nothing else, so reading them by it is exact rather than an
 * approximation. Readers map any residue the same way. One statement,
 * idempotent by predicate.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

export const kpiRecoveringToBand: DataChangeScript = {
  name: "0021_kpi_recovering_to_band",
  summary:
    "Rewrites each KPI stored as recovering to the corridor band its achievement gives, now that a recovery is shown beside the band.",
  expects: [
    { table: "kpis", column: "state", dataType: "text" },
    { table: "kpis", column: "achievement_pct", dataType: "numeric" },
    { table: "kpis", column: "healthy_pct", dataType: "numeric" },
    { table: "kpis", column: "watch_pct", dataType: "numeric" },
    { table: "kpis", column: "green_low", dataType: "numeric" },
    { table: "kpis", column: "green_high", dataType: "numeric" },
    { table: "kpis", column: "red_low", dataType: "numeric" },
    { table: "kpis", column: "red_high", dataType: "numeric" },
  ],
  async runBatch(client: DataChangeClient): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ n: number }>(
      `with changed as (
         update kpis
            set state = case
                          when achievement_pct is null then 'no_data'
                          when achievement_pct >= healthy_pct then 'healthy'
                          when achievement_pct >= watch_pct then 'watch'
                          else 'unhealthy'
                        end
          where state = 'recovering'
            and green_low is null and green_high is null
            and red_low is null and red_high is null
          returning 1
       )
       select count(*)::int as n from changed`,
    );
    return { done: true, rowsChanged: rows[0]?.n ?? 0 };
  },
};
