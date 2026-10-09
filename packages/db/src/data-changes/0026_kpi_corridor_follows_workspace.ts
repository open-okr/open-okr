/**
 * Lets every KPI that copied a corridor follow the workspace again (UAT
 * BUG-011, migration 0139).
 *
 * `kpis.create` used to copy the workspace's healthy and watch thresholds
 * into each KPI, and before completeness review H-17 every KPI took the
 * column defaults, the canon's 90 and 70. Either way a line equal to one of
 * those is a copy, not a choice, and is cleared so it follows from now on. A
 * line that differs from both was set on the KPI and is kept.
 *
 * | Stored line | This script |
 * |---|---|
 * | Equal to the workspace's current value for it | Cleared to null |
 * | Equal to the canon default (90 healthy, 70 watch) | Cleared to null |
 * | Anything else | Kept: the KPI deviates by design |
 *
 * **A cleared line can move a KPI's band**, where the workspace had moved
 * its thresholds after the KPI copied the canon's. So the stored state of
 * each KPI read on the ratio (no green or red thresholds of its own) is
 * rewritten from its stored achievement against the corridor it now
 * follows, by the §6.4 rule 0021 also applies: healthy at or above the
 * healthy line, watch at or above the watch line, unhealthy below. A KPI
 * read by its own thresholds keeps its state, because the corridor does not
 * decide its band.
 *
 * **The canon defaults are written here as 90 and 70**, the values migration
 * 0139 removed as column defaults. `packages/db` cannot read
 * `packages/method`, and a data change is a record of one release's rewrite,
 * so the numbers it compared against belong in it.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

const CANON_HEALTHY = 90;
const CANON_WATCH = 70;

export const kpiCorridorFollowsWorkspace: DataChangeScript = {
  name: "0026_kpi_corridor_follows_workspace",
  summary:
    "Clears each KPI healthy and watch threshold that only copied the workspace's or the canon's, so it follows the workspace from now on.",
  expects: [
    { table: "kpis", column: "healthy_pct", dataType: "numeric" },
    { table: "kpis", column: "watch_pct", dataType: "numeric" },
    { table: "kpis", column: "state", dataType: "text" },
    { table: "kpis", column: "achievement_pct", dataType: "numeric" },
    { table: "kpis", column: "green_low", dataType: "numeric" },
    { table: "rhythm_settings", column: "overrides", dataType: "jsonb" },
  ],
  async runBatch(client: DataChangeClient): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ n: number }>(
      `with corridor as (
         select k.id,
                coalesce((r.overrides ->> 'kpi.healthyThreshold')::numeric, $1)
                  as healthy,
                coalesce((r.overrides ->> 'kpi.watchThreshold')::numeric, $2)
                  as watch
           from kpis k
           left join rhythm_settings r on r.workspace_id = k.workspace_id
       ), cleared as (
         update kpis k
            set healthy_pct = case when k.healthy_pct in (c.healthy, $1)
                                   then null else k.healthy_pct end,
                watch_pct = case when k.watch_pct in (c.watch, $2)
                                 then null else k.watch_pct end,
                state = case
                  when k.green_low is not null or k.green_high is not null
                    or k.red_low is not null or k.red_high is not null
                    or k.achievement_pct is null
                    then k.state
                  when k.achievement_pct >= case when k.healthy_pct in (c.healthy, $1)
                                                 then c.healthy else k.healthy_pct end
                    then 'healthy'
                  when k.achievement_pct >= case when k.watch_pct in (c.watch, $2)
                                                 then c.watch else k.watch_pct end
                    then 'watch'
                  else 'unhealthy'
                end
           from corridor c
          where c.id = k.id
            and (k.healthy_pct in (c.healthy, $1) or k.watch_pct in (c.watch, $2))
          returning 1
       )
       select count(*)::int as n from cleared`,
      [CANON_HEALTHY, CANON_WATCH],
    );
    return { done: true, rowsChanged: rows[0]?.n ?? 0 };
  },
};
