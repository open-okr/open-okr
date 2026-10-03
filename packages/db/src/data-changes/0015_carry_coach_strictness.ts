/**
 * Carries a workspace's choice of a strict Coach onto strict mode (P9-T05).
 *
 * Before Phase 9 a workspace made the Coach strict with the §11 threshold
 * "Coach strictness", stored in `rhythm_settings.coach_strictness`. METHOD.md
 * §4 now gives every check its own level, and "Strict mode" in §12.1 is the
 * one switch that raises them all to block. The settings screen shows that
 * switch and no longer shows the old one, so a workspace that had chosen
 * strict has to find it there.
 *
 * | Stored | This script |
 * |---|---|
 * | `coach_strictness` = `strict` | `practice.strictMode` becomes `on`, and the column goes back to `warn` |
 * | `advisory` or `warn` | Untouched. Both now mean what every check's own level says, so neither is a choice to carry |
 *
 * The column is cleared as well as carried, because the read treats either
 * one as strict: leaving it would mean turning strict mode off on the screen
 * changed nothing. The column itself stays for a release, as PLAN.md §5.1
 * asks of anything being retired. A space's own strictness is a different
 * setting and is not touched. One statement, idempotent by predicate.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

export const carryCoachStrictness: DataChangeScript = {
  name: "0015_carry_coach_strictness",
  summary:
    "Moves a workspace's strict Coach strictness onto the strict mode practice setting.",
  expects: [
    { table: "rhythm_settings", column: "workspace_id", dataType: "uuid" },
    { table: "rhythm_settings", column: "coach_strictness", dataType: "text" },
    { table: "rhythm_settings", column: "practice", dataType: "jsonb" },
  ],
  async runBatch(client: DataChangeClient): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ n: number }>(
      `with changed as (
         update rhythm_settings
            set practice = practice || '{"strictMode": "on"}'::jsonb,
                coach_strictness = 'warn'
          where coach_strictness = 'strict'
          returning 1
       )
       select count(*)::int as n from changed`,
    );
    return { done: true, rowsChanged: rows[0]?.n ?? 0 };
  },
};
