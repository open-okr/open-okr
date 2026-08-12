/**
 * Backfills the `workspace_standard` group's binding on its own workspace's
 * context, for every workspace provisioned before `insertWorkspaceAndMember`
 * (`packages/core/src/workspaces/provisioning.ts`) started creating it.
 *
 * Without this binding, `resolveMemberAccessLevel` has nothing to find for
 * an ordinary active member on the workspace's own context: only the
 * founding member's own `member` group is bound there, at `full`. Every
 * other member resolves to zero, unable to read the workspace overview or
 * update their own profile — found by running the real test suite against
 * a real database for the first time, not by review. `edit` (70) matches
 * what the group now gets at provisioning: enough for self-service and
 * reading the workspace aggregate, below every `full`-gated admin action.
 *
 * Batched by a keyset on `workspaces.id` (time-ordered, per
 * `packages/db/src/id.ts`), the same shape as 0001's own backfill.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

const BATCH_SIZE = 500;
const EDIT_LEVEL = 70;

export const backfillWorkspaceStandardBinding: DataChangeScript = {
  name: "0002_backfill_workspace_standard_binding",
  summary:
    "Binds each workspace's workspace_standard group to its own context at edit, where that binding is missing.",
  expects: [
    { table: "workspaces", column: "id", dataType: "uuid" },
    { table: "access_groups", column: "workspace_id", dataType: "uuid" },
    { table: "access_groups", column: "kind", dataType: "text" },
    { table: "access_contexts", column: "workspace_id", dataType: "uuid" },
    { table: "access_contexts", column: "resource_type", dataType: "text" },
    { table: "access_contexts", column: "resource_id", dataType: "uuid" },
    { table: "access_bindings", column: "group_id", dataType: "uuid" },
    { table: "access_bindings", column: "context_id", dataType: "uuid" },
    { table: "access_bindings", column: "level", dataType: "integer" },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{
      batch_size: number;
      last_id: string | null;
      inserted_count: number;
    }>(
      `with batch as (
         select w.id as workspace_id, ag.id as group_id, ac.id as context_id
           from workspaces w
           join access_groups ag
             on ag.workspace_id = w.id
            and ag.kind = 'workspace_standard'
            and ag.deleted_at is null
           join access_contexts ac
             on ac.workspace_id = w.id
            and ac.resource_type = 'workspace'
            and ac.resource_id = w.id
            and ac.deleted_at is null
          where w.deleted_at is null
            and ($1::uuid is null or w.id > $1::uuid)
            and not exists (
              select 1 from access_bindings b
               where b.group_id = ag.id
                 and b.context_id = ac.id
                 and b.deleted_at is null
            )
          order by w.id
          limit $2
       ),
       inserted as (
         insert into access_bindings (id, workspace_id, group_id, context_id, level)
         select gen_random_uuid(), workspace_id, group_id, context_id, ${EDIT_LEVEL}
           from batch
         returning id
       )
       select
         (select count(*) from batch)::int as batch_size,
         -- Not max(workspace_id): Postgres's max() aggregate has no uuid
         -- overload. batch is already ordered by w.id ascending, so its
         -- last row is the same answer.
         (select workspace_id from batch order by workspace_id desc limit 1) as last_id,
         (select count(*) from inserted)::int as inserted_count`,
      [cursor, BATCH_SIZE],
    );
    const row = rows[0];
    const batchSize = row?.batch_size ?? 0;

    return {
      done: batchSize < BATCH_SIZE,
      cursor: row?.last_id ?? undefined,
      rowsChanged: row?.inserted_count ?? 0,
    };
  },
};
