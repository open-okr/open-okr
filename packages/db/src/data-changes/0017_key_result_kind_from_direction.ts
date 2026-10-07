/**
 * Makes every key result written with a maintain direction a maintain key
 * result (METHOD.md §2.10, P9-T12b).
 *
 * Before kinds existed, "hold this number inside a band" could only be said
 * through the direction. Migration 0114 gives every key result a kind, metric
 * by default, and this says which of them were maintain all along.
 *
 * | Stored | This script |
 * |---|---|
 * | `direction` = `maintain`, `kind` = `metric` | `kind` becomes `maintain` |
 * | Anything else | Untouched |
 *
 * Soft-deleted key results are carried too, so one restored later reads the
 * way it was written. One statement, idempotent by predicate.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

export const keyResultKindFromDirection: DataChangeScript = {
  name: "0017_key_result_kind_from_direction",
  summary:
    "Marks every key result written with a maintain direction as a maintain key result.",
  expects: [
    { table: "key_results", column: "direction", dataType: "text" },
    { table: "key_results", column: "kind", dataType: "text" },
  ],
  async runBatch(client: DataChangeClient): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ n: number }>(
      `with changed as (
         update key_results
            set kind = 'maintain'
          where direction = 'maintain' and kind = 'metric'
          returning 1
       )
       select count(*)::int as n from changed`,
    );
    return { done: true, rowsChanged: rows[0]?.n ?? 0 };
  },
};
