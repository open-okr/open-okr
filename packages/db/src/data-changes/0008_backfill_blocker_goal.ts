/**
 * Records the goal on every open blocker that has none (completeness review
 * H-10).
 *
 * `sessions.createBlocker` never wrote `goal_id`, and it is the one path that
 * opens a blocker: a session's diagnose stage and a chat command both go
 * through it. The review inbox decides who may see a blocker by its goal and
 * skips one without, so no blocker ever reached its owner's inbox. The action
 * now writes the goal on insert; this repairs the rows written before it did.
 *
 * The goal is the key result's own, which is the only goal a blocker raised
 * against a key result can belong to. A blocker whose key result is gone, or
 * that never named one, is left as it is: there is nothing to derive a goal
 * from, and guessing one would put a blocker in front of the wrong people.
 *
 * Batched by a keyset on `id`, the runner's convention. Resolved and deleted
 * blockers are included: a resolved one still shows on the aging board's
 * history, and a restore can bring a deleted one back.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

const BATCH_SIZE = 500;

export const backfillBlockerGoal: DataChangeScript = {
  name: "0008_backfill_blocker_goal",
  summary:
    "Sets blockers.goal_id from the key result's goal, for any blocker that has none.",
  expects: [
    { table: "blockers", column: "id", dataType: "uuid" },
    { table: "blockers", column: "goal_id", dataType: "uuid" },
    { table: "blockers", column: "key_result_id", dataType: "uuid" },
    { table: "key_results", column: "id", dataType: "uuid" },
    { table: "key_results", column: "goal_id", dataType: "uuid" },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{
      batch_size: number;
      last_id: string | null;
      updated_count: number;
    }>(
      `with batch as (
         select id from blockers
          where goal_id is null
            and key_result_id is not null
            and ($1::uuid is null or id > $1::uuid)
          order by id
          limit $2
       ),
       updated as (
         update blockers b
            set goal_id = k.goal_id
           from key_results k
          where b.id in (select id from batch)
            and k.id = b.key_result_id
            and k.workspace_id = b.workspace_id
          returning b.id
       )
       select
         (select count(*) from batch)::int as batch_size,
         (select id from batch order by id desc limit 1) as last_id,
         (select count(*) from updated)::int as updated_count`,
      [cursor, BATCH_SIZE],
    );
    const row = rows[0];
    const batchSize = row?.batch_size ?? 0;

    return {
      done: batchSize < BATCH_SIZE,
      cursor: row?.last_id ?? undefined,
      rowsChanged: row?.updated_count ?? 0,
    };
  },
};
