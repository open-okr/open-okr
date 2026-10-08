/**
 * Gives every key result already scored its computed score (METHOD.md §3.3,
 * P9-T14a).
 *
 * Migration 0120 keeps the score §2.10 computes beside the one the review
 * gave. A key result scored before that has only the review's score, and
 * nobody adjusted anything before adjusting existed, so that score is the
 * computed one too.
 *
 * | Stored | This script |
 * |---|---|
 * | `score` set, `score_computed` null | `score_computed` becomes `score` |
 * | Anything else | Untouched |
 *
 * Soft-deleted key results are carried too, so one restored later reads the
 * way it was scored. One statement, idempotent by predicate.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

export const keyResultScoreComputed: DataChangeScript = {
  name: "0018_key_result_score_computed",
  summary:
    "Copies every key result's score into its computed score, for the ones scored before scores could be adjusted.",
  expects: [
    { table: "key_results", column: "score", dataType: "numeric" },
    { table: "key_results", column: "score_computed", dataType: "numeric" },
  ],
  async runBatch(client: DataChangeClient): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ n: number }>(
      `with changed as (
         update key_results
            set score_computed = score
          where score is not null and score_computed is null
          returning 1
       )
       select count(*)::int as n from changed`,
    );
    return { done: true, rowsChanged: rows[0]?.n ?? 0 };
  },
};
