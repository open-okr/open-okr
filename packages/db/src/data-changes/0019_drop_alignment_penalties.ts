/**
 * Removes the retired alignment penalties from every workspace's overrides
 * (P9-T16a).
 *
 * METHOD.md §5.2 scored alignment by subtracting fixed penalties until
 * 1 October 2026, when METHOD v2 replaced the arithmetic with the share of
 * goals below company level that align or stand alone with a reason. §11's
 * "Alignment penalties" left the registry with it, and nothing reads the key.
 *
 * | Stored | This script |
 * |---|---|
 * | `alignment.penalties`, any value | Removed. There is no successor to carry it to: a share has no per-finding cost |
 * | `alignment.healthyThreshold` | Left alone. A workspace chose that number, and it now reads as a share |
 *
 * Reads already ignore the key, because an unknown key is dropped rather than
 * allowed to decide anything. This keeps an admin saving the settings card
 * from being told about a threshold they cannot see. One statement,
 * idempotent by predicate.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

export const dropAlignmentPenalties: DataChangeScript = {
  name: "0019_drop_alignment_penalties",
  summary:
    "Removes the retired alignment penalties from each workspace's threshold overrides.",
  expects: [
    { table: "rhythm_settings", column: "workspace_id", dataType: "uuid" },
    { table: "rhythm_settings", column: "overrides", dataType: "jsonb" },
  ],
  async runBatch(client: DataChangeClient): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ n: number }>(
      `with changed as (
         update rhythm_settings
            set overrides = overrides - 'alignment.penalties'
          where overrides ? 'alignment.penalties'
          returning 1
       )
       select count(*)::int as n from changed`,
    );
    return { done: true, rowsChanged: rows[0]?.n ?? 0 };
  },
};
