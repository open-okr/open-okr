/**
 * Gives every existing KPI an access context, standard and owner bindings, and
 * re-points search and activities to the new contexts (0.10.0 K3, §3.3).
 *
 * Idempotent: every insert is guarded by `not exists`, so a second run changes
 * 0 rows.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";
import { newId } from "../id.ts";

const BATCH_SIZE = 100;
const VIEW_LEVEL = 10;
const FULL_LEVEL = 100;

export const kpiAccessContexts: DataChangeScript = {
  name: "0037_kpi_access_contexts",
  summary:
    "Gives every existing KPI an access context, standard and owner bindings, and updates search and activity references.",
  expects: [
    { table: "kpis", column: "owner_member_id", dataType: "uuid" },
    { table: "kpis", column: "space_id", dataType: "uuid" },
    { table: "access_contexts", column: "resource_id", dataType: "uuid" },
    { table: "access_bindings", column: "tag", dataType: "text" },
    { table: "access_groups", column: "member_id", dataType: "uuid" },
    { table: "search_documents", column: "context_id", dataType: "uuid" },
    { table: "activities", column: "context_id", dataType: "uuid" },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows: batch } = await client.query<{ id: string }>(
      `select id from workspaces
        where deleted_at is null
          and ($1::uuid is null or id > $1::uuid)
        order by id
        limit $2`,
      [cursor, BATCH_SIZE],
    );

    let changed = 0;
    for (const { id: workspaceId } of batch) {
      // 1 Contexts: one row per live KPI with no live kpi context
      const { rows: missingContexts } = await client.query<{ id: string }>(
        `select k.id from kpis k
          where k.workspace_id = $1
            and k.deleted_at is null
            and not exists (
              select 1 from access_contexts c
               where c.workspace_id = k.workspace_id
                 and c.resource_type = 'kpi'
                 and c.resource_id = k.id
                 and c.deleted_at is null
            )`,
        [workspaceId],
      );
      for (const kpi of missingContexts) {
        await client.query(
          `insert into access_contexts (id, workspace_id, resource_type, resource_id)
           values ($1, $2, 'kpi', $3)`,
          [newId(), workspaceId, kpi.id],
        );
        changed += 1;
      }

      // 2 Standard binding: workspace_standard at 10, tag null, on every live kpi context lacking an untagged binding for that group
      const { rows: missingStdBindings } = await client.query<{
        group_id: string;
        context_id: string;
      }>(
        `select g.id as group_id, c.id as context_id
           from access_groups g
           join access_contexts c
             on c.workspace_id = g.workspace_id
            and c.resource_type = 'kpi'
            and c.deleted_at is null
          where g.workspace_id = $1
            and g.kind = 'workspace_standard'
            and g.deleted_at is null
            and not exists (
              select 1 from access_bindings b
               where b.workspace_id = g.workspace_id
                 and b.group_id = g.id
                 and b.context_id = c.id
                 and b.tag is null
                 and b.deleted_at is null
            )`,
        [workspaceId],
      );
      for (const row of missingStdBindings) {
        await client.query(
          `insert into access_bindings (id, workspace_id, group_id, context_id, level, tag)
           values ($1, $2, $3, $4, $5, null)`,
          [newId(), workspaceId, row.group_id, row.context_id, VIEW_LEVEL],
        );
        changed += 1;
      }

      // 3 Owner groups: kind 'member' for each owner with no live member group (kind <> 'agent')
      const { rows: missingOwnerGroups } = await client.query<{
        member_id: string;
      }>(
        `select distinct k.owner_member_id as member_id
           from kpis k
           join workspace_members m
             on m.id = k.owner_member_id
            and m.workspace_id = k.workspace_id
            and m.kind <> 'agent'
            and m.deleted_at is null
          where k.workspace_id = $1
            and k.owner_member_id is not null
            and k.deleted_at is null
            and not exists (
              select 1 from access_groups g
               where g.workspace_id = k.workspace_id
                 and g.kind = 'member'
                 and g.member_id = k.owner_member_id
                 and g.deleted_at is null
            )`,
        [workspaceId],
      );
      for (const row of missingOwnerGroups) {
        await client.query(
          `insert into access_groups (id, workspace_id, kind, member_id)
           values ($1, $2, 'member', $3)`,
          [newId(), workspaceId, row.member_id],
        );
        changed += 1;
      }

      // 4 Owner binding: level 100, tag 'owner', for each KPI with a live owner and no live 'owner' binding on its context
      const { rows: missingOwnerBindings } = await client.query<{
        group_id: string;
        context_id: string;
      }>(
        `select g.id as group_id, c.id as context_id
           from kpis k
           join workspace_members m
             on m.id = k.owner_member_id
            and m.workspace_id = k.workspace_id
            and m.kind <> 'agent'
            and m.deleted_at is null
           join access_groups g
             on g.workspace_id = k.workspace_id
            and g.kind = 'member'
            and g.member_id = m.id
            and g.deleted_at is null
           join access_contexts c
             on c.workspace_id = k.workspace_id
            and c.resource_type = 'kpi'
            and c.resource_id = k.id
            and c.deleted_at is null
          where k.workspace_id = $1
            and k.owner_member_id is not null
            and k.deleted_at is null
            and not exists (
              select 1 from access_bindings b
               where b.workspace_id = k.workspace_id
                 and b.group_id = g.id
                 and b.context_id = c.id
                 and b.tag = 'owner'
                 and b.deleted_at is null
            )`,
        [workspaceId],
      );
      for (const row of missingOwnerBindings) {
        await client.query(
          `insert into access_bindings (id, workspace_id, group_id, context_id, level, tag)
           values ($1, $2, $3, $4, $5, 'owner')`,
          [newId(), workspaceId, row.group_id, row.context_id, FULL_LEVEL],
        );
        changed += 1;
      }

      // 5 Search: update search_documents set context_id = <kpi context> where entity_type = 'kpi' and entity_id is the KPI
      const searchRes = await client.query<{ id: string }>(
        `update search_documents s
            set context_id = c.id
           from access_contexts c
          where c.workspace_id = s.workspace_id
            and c.resource_type = 'kpi'
            and c.resource_id = s.entity_id
            and c.deleted_at is null
            and s.workspace_id = $1
            and s.entity_type = 'kpi'
            and s.context_id is distinct from c.id
         returning s.id`,
        [workspaceId],
      );
      changed += searchRes.rows.length;

      // 6 Feed: update activities set context_id = <kpi context> where subject_type = 'kpi', subject_id is the KPI and context_id is null
      const feedRes = await client.query<{ id: string }>(
        `update activities a
            set context_id = c.id
           from access_contexts c
          where c.workspace_id = a.workspace_id
            and c.resource_type = 'kpi'
            and c.resource_id = a.subject_id
            and c.deleted_at is null
            and a.workspace_id = $1
            and a.subject_type = 'kpi'
            and a.context_id is null
         returning a.id`,
        [workspaceId],
      );
      changed += feedRes.rows.length;
    }

    const last = batch.at(-1);
    return {
      done: batch.length < BATCH_SIZE,
      cursor: last?.id ?? undefined,
      rowsChanged: changed,
    };
  },
};
