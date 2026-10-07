/**
 * Gives every KPI written before §6.2's target types the type its direction
 * implies (P9-T17a).
 *
 * | Direction | Target type |
 * |---|---|
 * | `higher_better` | `at_least`, stay at or above |
 * | `lower_better` | `at_most`, stay at or below |
 *
 * "Stay at or above" rather than "increase to", because nothing about an old
 * KPI says its target is a destination rather than a floor, and the two read
 * the same until somebody sets thresholds. Reads already treat a null type
 * this way; this makes the stored row say so. One statement, idempotent by
 * predicate.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

export const kpiTargetTypeFromDirection: DataChangeScript = {
  name: "0020_kpi_target_type_from_direction",
  summary:
    "Writes the target type each existing KPI's direction implies: at or above for higher-is-better, at or below for lower-is-better.",
  expects: [
    { table: "kpis", column: "direction", dataType: "text" },
    { table: "kpis", column: "target_type", dataType: "text" },
  ],
  async runBatch(client: DataChangeClient): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ n: number }>(
      `with changed as (
         update kpis
            set target_type = case direction
                                when 'lower_better' then 'at_most'
                                else 'at_least'
                              end
          where target_type is null
          returning 1
       )
       select count(*)::int as n from changed`,
    );
    return { done: true, rowsChanged: rows[0]?.n ?? 0 };
  },
};
