/**
 * Binds the Champion and the Coach, by name, to every goal and KPI that
 * belongs to no space (completeness review H-04).
 *
 * Their readers now honour their bindings, as CLAUDE.md always required: an
 * agent holds bindings on named spaces, goals and KPI trees, never a
 * workspace-wide grant. They were bound to spaces only, so a company goal, an
 * individual goal or a workspace KPI, none of which belongs to a space, would
 * have dropped out of their sight the moment the readers started asking. New
 * ones are bound as they are created (`bindAgentsToContextInTx`); this binds
 * the ones that already exist. Akmal chose this on 28 September 2026 over
 * exempting the built-in agents from the rule.
 *
 * A KPI had no access context at all, so one is created for each KPI that
 * belongs to no space: the `kpi` context TECHNICAL-PLAN §4.1 anticipates.
 *
 * Batched by workspace. Idempotent: a binding that already exists is left
 * alone, and a second run binds nothing.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";
import { newId } from "../id.ts";

const BATCH_SIZE = 100;
const VIEW_LEVEL = 10;

export const bindAgentsToSpacelessItems: DataChangeScript = {
  name: "0009_bind_agents_to_spaceless_items",
  summary:
    "Binds the Champion and the Coach to every goal and KPI that belongs to no space, creating a context for each such KPI.",
  expects: [
    { table: "agents", column: "member_id", dataType: "uuid" },
    { table: "goals", column: "space_id", dataType: "uuid" },
    { table: "kpis", column: "space_id", dataType: "uuid" },
    { table: "access_contexts", column: "resource_id", dataType: "uuid" },
    { table: "access_bindings", column: "level", dataType: "integer" },
    { table: "access_groups", column: "member_id", dataType: "uuid" },
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

    let bound = 0;
    for (const { id: workspaceId } of batch) {
      // A context for every live KPI that belongs to no space and has none.
      const { rows: kpis } = await client.query<{ id: string }>(
        `select k.id from kpis k
          where k.workspace_id = $1
            and k.space_id is null
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
      for (const kpi of kpis) {
        await client.query(
          `insert into access_contexts (id, workspace_id, resource_type, resource_id)
           values ($1, $2, 'kpi', $3)`,
          [newId(), workspaceId, kpi.id],
        );
      }

      // Every pair of built-in agent and space-less item not yet bound.
      const { rows: pairs } = await client.query<{
        group_id: string;
        context_id: string;
      }>(
        `select grp.id as group_id, ctx.id as context_id
           from agents a
           join access_groups grp
             on grp.member_id = a.member_id
            and grp.kind = 'member'
            and grp.deleted_at is null
           join access_contexts ctx
             on ctx.workspace_id = a.workspace_id
            and ctx.deleted_at is null
          where a.workspace_id = $1
            and a.kind in ('champion', 'coach')
            and a.deleted_at is null
            and (
              (ctx.resource_type = 'goal' and exists (
                 select 1 from goals g
                  where g.id = ctx.resource_id
                    and g.space_id is null
                    and g.deleted_at is null))
              or (ctx.resource_type = 'kpi' and exists (
                 select 1 from kpis k
                  where k.id = ctx.resource_id
                    and k.space_id is null
                    and k.deleted_at is null))
            )
            and not exists (
              select 1 from access_bindings b
               where b.group_id = grp.id
                 and b.context_id = ctx.id
                 and b.tag is null
                 and b.deleted_at is null
            )`,
        [workspaceId],
      );
      for (const pair of pairs) {
        await client.query(
          `insert into access_bindings (id, workspace_id, group_id, context_id, level)
           values ($1, $2, $3, $4, $5)`,
          [newId(), workspaceId, pair.group_id, pair.context_id, VIEW_LEVEL],
        );
        bound += 1;
      }
    }

    const last = batch.at(-1);
    return {
      done: batch.length < BATCH_SIZE,
      cursor: last?.id ?? undefined,
      rowsChanged: bound,
    };
  },
};
