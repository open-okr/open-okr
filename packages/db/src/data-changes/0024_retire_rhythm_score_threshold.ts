/**
 * Retires the survey rhythm threshold (METHOD.md §8.6, §11, P9-T20d).
 *
 * The diagnostic's rhythm became the measured share of due check-ins
 * published on time, with "Diagnostic rhythm threshold" at 75% replacing
 * "Diagnostic rhythm-score threshold" at 3.5 out of five. A workspace that
 * had set its own 3.5 holds a number on the wrong scale with no key to read
 * it, so it is removed and the canon's 75% applies until the workspace sets
 * another.
 *
 * | Stored | This script |
 * |---|---|
 * | `sessions.diagnosticRhythmScore` in a workspace's overrides | Removed. Its five-point number has no meaning as a share |
 *
 * Every other override is left alone, the cycle-score threshold among them:
 * its key and its scale did not change, only its canon default.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

export const retireRhythmScoreThreshold: DataChangeScript = {
  name: "0024_retire_rhythm_score_threshold",
  summary:
    "Removes the survey rhythm-score threshold from workspace overrides now that the diagnostic reads a measured share.",
  expects: [
    { table: "rhythm_settings", column: "overrides", dataType: "jsonb" },
  ],
  async runBatch(client: DataChangeClient): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ n: number }>(
      `with settings as (
         update rhythm_settings
            set overrides = overrides - 'sessions.diagnosticRhythmScore'
          where overrides ? 'sessions.diagnosticRhythmScore'
          returning 1
       )
       select count(*)::int as n from settings`,
    );
    return { done: true, rowsChanged: rows[0]?.n ?? 0 };
  },
};
