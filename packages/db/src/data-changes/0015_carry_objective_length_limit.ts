/**
 * Carries a workspace's objective length limit onto the threshold that replaced
 * the one it was stored under (P9-T03a).
 *
 * METHOD.md §11's "Objective length bounds" (4 to 18 words) became "Objective
 * length limit" (18), because METHOD v2 dropped the lower bound: whatmatters'
 * own "Achieve fiscal sustainability" is three words. A workspace that had
 * changed the upper bound stored it as `quality.objectiveLengthWords` in
 * `rhythm_settings.overrides`, which no longer names a threshold.
 *
 * | Stored under the old key | This script |
 * |---|---|
 * | A whole-number `high` from 1 to 100 other than 18 | Becomes `quality.objectiveLengthLimit`, unless the workspace has already set that |
 * | `high` of 18, or anything else | Dropped: 18 is the canon, and the lower bound no longer exists |
 *
 * The old key is removed either way. One statement, idempotent by predicate.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

export const carryObjectiveLengthLimit: DataChangeScript = {
  name: "0015_carry_objective_length_limit",
  summary:
    "Moves a workspace's objective length upper bound from the retired bounds threshold onto the objective length limit.",
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
                when jsonb_typeof(overrides->'quality.objectiveLengthWords'->'high') = 'number'
                 and (overrides->'quality.objectiveLengthWords'->>'high')::numeric
                     = trunc((overrides->'quality.objectiveLengthWords'->>'high')::numeric)
                 and (overrides->'quality.objectiveLengthWords'->>'high')::numeric between 1 and 100
                 and (overrides->'quality.objectiveLengthWords'->>'high')::numeric <> 18
                then jsonb_build_object(
                       'quality.objectiveLengthLimit',
                       (overrides->'quality.objectiveLengthWords'->>'high')::int
                     )
                else '{}'::jsonb
              end
              -- The workspace's own value of the new key wins.
              || (overrides - 'quality.objectiveLengthWords')
          where overrides ? 'quality.objectiveLengthWords'
          returning 1
       )
       select count(*)::int as n from changed`,
    );
    return { done: true, rowsChanged: rows[0]?.n ?? 0 };
  },
};
