/**
 * Carries a workspace's strategic issue floor onto the threshold that replaced
 * the one it was stored under (P9-T02).
 *
 * METHOD.md §11's "Strategic issue bounds" (3 to 10) became "Strategic issue
 * minimum" (3), because nothing ever checked the upper bound. A workspace that
 * had raised the floor stored it as `quality.strategicIssueBounds` in
 * `rhythm_settings.overrides`, which no longer names a threshold, so it would
 * quietly read the canon's 3 again.
 *
 * | Stored under the old key | This script |
 * |---|---|
 * | A whole-number `low` other than 3 | Becomes `quality.strategicIssueMinimum`, unless the workspace has already set that |
 * | `low` of 3, or anything that is not a number | Dropped: 3 is the canon, and an unreadable value was never applied |
 *
 * The old key is removed either way, so the override map holds only
 * thresholds that exist. One statement, idempotent by predicate: a row
 * without the old key is never selected again.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

export const carryStrategicIssueMinimum: DataChangeScript = {
  name: "0013_carry_strategic_issue_minimum",
  summary:
    "Moves a workspace's raised strategic issue floor from the retired bounds threshold onto the strategic issue minimum.",
  expects: [
    { table: "rhythm_settings", column: "workspace_id", dataType: "uuid" },
    { table: "rhythm_settings", column: "overrides", dataType: "jsonb" },
  ],
  async runBatch(client: DataChangeClient): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ n: number }>(
      `with changed as (
         update rhythm_settings
            set overrides =
              case
                when jsonb_typeof(overrides->'quality.strategicIssueBounds'->'low') = 'number'
                 and (overrides->'quality.strategicIssueBounds'->>'low')::numeric
                     = trunc((overrides->'quality.strategicIssueBounds'->>'low')::numeric)
                 and (overrides->'quality.strategicIssueBounds'->>'low')::numeric between 0 and 100
                 and (overrides->'quality.strategicIssueBounds'->>'low')::numeric <> 3
                then jsonb_build_object(
                       'quality.strategicIssueMinimum',
                       (overrides->'quality.strategicIssueBounds'->>'low')::int
                     )
                else '{}'::jsonb
              end
              -- The workspace's own value of the new key wins over the
              -- carried one, so the right-hand side is the stored map.
              || (overrides - 'quality.strategicIssueBounds')
          where overrides ? 'quality.strategicIssueBounds'
          returning 1
       )
       select count(*)::int as n from changed`,
    );
    return { done: true, rowsChanged: rows[0]?.n ?? 0 };
  },
};
