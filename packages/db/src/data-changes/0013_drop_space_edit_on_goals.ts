/**
 * Takes the `space_standard` binding off every goal that already has one
 * (P8-G13c, docs/design/workspace-roles.md).
 *
 * **What this removes, and what it does not.** A goal in a space granted every
 * member of that space `edit` on it. That was the only answer to "who may edit
 * this objective", it could be stated only by reading this table, and it had no
 * screen. The workspace role answers it now. Nothing about who can *see* a goal
 * changes: the `workspace_standard` binding at `view` stays, as it has since
 * P3-T04, so every member still reads every objective.
 *
 * **Nobody loses the edit on the day this runs**, provided data change 0012 has
 * run first, which the runner guarantees by order. 0012 gives every active
 * human the Member role, and Member grants `edit` on the `goal` domain, so the
 * level `can()` resolves is the same number from a different source. The
 * difference is that an administrator can now change it.
 *
 * **Soft delete, not a delete.** `unbindGroup` is what the application uses
 * when a space role changes, and for the same reason: the level stops resolving
 * at once and the history of who held what survives. A row already soft-deleted
 * is left alone, which is what makes a second run change nothing.
 *
 * **Goals and initiatives.** The script first removed the goal binding alone,
 * because the task row names the objective, and the two were left disagreeing
 * with the disagreement written down. Agung read that note and asked for them
 * to agree, so an initiative in a space no longer grants its members `edit`
 * either. The owner keeps `full` through their own group, which is what
 * `initiatives.delete` asks for, and `workspace_standard` keeps `view` on
 * both, so nothing becomes invisible.
 *
 * Batched by a keyset on `access_bindings.id`. Idempotent by predicate: a
 * binding this has already removed is not selected again.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

const BATCH_SIZE = 500;

export const dropSpaceEditOnGoals: DataChangeScript = {
  name: "0013_drop_space_edit_on_goals",
  summary:
    "Removes the space_standard binding from every goal and initiative context, leaving the workspace-wide view binding in place.",
  expects: [
    { table: "access_bindings", column: "id", dataType: "uuid" },
    { table: "access_bindings", column: "group_id", dataType: "uuid" },
    { table: "access_bindings", column: "context_id", dataType: "uuid" },
    { table: "access_groups", column: "kind", dataType: "text" },
    { table: "access_contexts", column: "resource_type", dataType: "text" },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{
      batch_size: number;
      last_id: string | null;
      changed_count: number;
    }>(
      `with batch as (
         select b.id
           from access_bindings b
           join access_groups g
             on g.id = b.group_id
            and g.kind = 'space_standard'
            and g.deleted_at is null
           join access_contexts c
             on c.id = b.context_id
            and c.resource_type in ('goal', 'initiative')
            and c.deleted_at is null
          where b.deleted_at is null
            and ($1::uuid is null or b.id > $1::uuid)
          order by b.id
          limit $2
       ),
       changed as (
         update access_bindings
            set deleted_at = now()
          where id in (select id from batch)
         returning id
       )
       select
         (select count(*) from batch)::int as batch_size,
         -- Not max(id): Postgres has no max() for uuid. The batch is already
         -- ordered ascending, so its last row is the same answer.
         (select id from batch order by id desc limit 1) as last_id,
         (select count(*) from changed)::int as changed_count`,
      [cursor, BATCH_SIZE],
    );
    const row = rows[0];
    const batchSize = row?.batch_size ?? 0;

    return {
      done: batchSize < BATCH_SIZE,
      cursor: row?.last_id ?? undefined,
      rowsChanged: row?.changed_count ?? 0,
    };
  },
};
