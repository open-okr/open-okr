/**
 * Gives every workspace provisioned before P3-T01 the default space
 * TECHNICAL-PLAN.md §4.14 says it should have had: "One space named after the
 * workspace, with the first member as its manager, who covers the
 * coordinator's duties until one is named."
 *
 * Faithful to what provisioning now does, and no more. The founding member
 * becomes the manager and **nobody else is added**, because an invited member
 * has never been put into a space automatically and this backfill is not the
 * place to start. Everyone else can already see the space through the
 * `workspace_standard` view binding and can join it.
 *
 * Ids are generated in JavaScript with `newId` rather than by
 * `gen_random_uuid()`, unlike script 0002. TECHNICAL-PLAN §3 asks for
 * time-ordered keys, and `idTimestamp` reads a creation time back out of one.
 * A random uuid on a `spaces` row would make that lie. 0002 wrote
 * `access_bindings`, whose ordering nothing reads.
 *
 * Batched by a keyset on `workspaces.id`, the same shape as 0001 and 0002.
 */

import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";
import { newId } from "../id.ts";

const BATCH_SIZE = 200;
const VIEW_LEVEL = 10;
const EDIT_LEVEL = 70;
const FULL_LEVEL = 100;

interface Candidate {
  workspace_id: string;
  workspace_name: string;
  workspace_standard_group_id: string | null;
  founding_member_id: string | null;
  /** `DataChangeClient.query` rows are open records, and a closed interface
   * does not satisfy that constraint. */
  [column: string]: unknown;
}

export const backfillDefaultSpace: DataChangeScript = {
  name: "0003_backfill_default_space",
  summary:
    "Creates the §4.14 default space, named after the workspace with its founding member as manager, for every workspace that has none.",
  expects: [
    { table: "workspaces", column: "id", dataType: "uuid" },
    { table: "workspaces", column: "name", dataType: "text" },
    { table: "spaces", column: "workspace_id", dataType: "uuid" },
    { table: "spaces", column: "name", dataType: "text" },
    { table: "space_members", column: "space_id", dataType: "uuid" },
    { table: "space_members", column: "member_id", dataType: "uuid" },
    { table: "space_members", column: "role", dataType: "text" },
    { table: "access_contexts", column: "resource_type", dataType: "text" },
    { table: "access_contexts", column: "resource_id", dataType: "uuid" },
    { table: "access_groups", column: "kind", dataType: "text" },
    { table: "access_groups", column: "space_id", dataType: "uuid" },
    { table: "access_groups", column: "member_id", dataType: "uuid" },
    { table: "access_group_memberships", column: "group_id", dataType: "uuid" },
    { table: "access_bindings", column: "context_id", dataType: "uuid" },
    { table: "access_bindings", column: "level", dataType: "integer" },
    { table: "workspace_members", column: "kind", dataType: "text" },
    { table: "workspace_members", column: "status", dataType: "text" },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<Candidate>(
      `select
         w.id as workspace_id,
         w.name as workspace_name,
         (select ag.id from access_groups ag
           where ag.workspace_id = w.id
             and ag.kind = 'workspace_standard'
             and ag.deleted_at is null
           limit 1) as workspace_standard_group_id,
         -- The founding member: the oldest active human with a real user
         -- behind them. A workspace whose founder was erased gets a space
         -- with no manager, which a workspace admin can then repair, rather
         -- than no space at all.
         (select m.id from workspace_members m
           where m.workspace_id = w.id
             and m.kind = 'human'
             and m.status = 'active'
             and m.user_id is not null
             and m.deleted_at is null
           order by m.created_at, m.id
           limit 1) as founding_member_id
       from workspaces w
      where w.deleted_at is null
        and ($1::uuid is null or w.id > $1::uuid)
        and not exists (
          select 1 from spaces s
           where s.workspace_id = w.id
             and s.deleted_at is null
        )
      order by w.id
      limit $2`,
      [cursor, BATCH_SIZE],
    );

    let created = 0;

    for (const candidate of rows) {
      const spaceId = newId();

      await client.query(
        `insert into spaces (id, workspace_id, name) values ($1, $2, $3)`,
        [spaceId, candidate.workspace_id, candidate.workspace_name],
      );

      const spaceContextId = newId();
      await client.query(
        `insert into access_contexts (id, workspace_id, resource_type, resource_id)
         values ($1, $2, 'space', $3)`,
        [spaceContextId, candidate.workspace_id, spaceId],
      );

      // The workspace's own standard group may be missing on a workspace old
      // enough to predate P2-T01, in which case script 0002 did not find it
      // either. Created here rather than skipped, so the space is discoverable.
      let workspaceStandardGroupId = candidate.workspace_standard_group_id;
      if (!workspaceStandardGroupId) {
        workspaceStandardGroupId = newId();
        await client.query(
          `insert into access_groups (id, workspace_id, kind)
           values ($1, $2, 'workspace_standard')`,
          [workspaceStandardGroupId, candidate.workspace_id],
        );
      }
      await client.query(
        `insert into access_bindings (id, workspace_id, group_id, context_id, level)
         values ($1, $2, $3, $4, $5)`,
        [
          newId(),
          candidate.workspace_id,
          workspaceStandardGroupId,
          spaceContextId,
          VIEW_LEVEL,
        ],
      );

      const spaceStandardGroupId = newId();
      await client.query(
        `insert into access_groups (id, workspace_id, kind, space_id)
         values ($1, $2, 'space_standard', $3)`,
        [spaceStandardGroupId, candidate.workspace_id, spaceId],
      );
      await client.query(
        `insert into access_bindings (id, workspace_id, group_id, context_id, level)
         values ($1, $2, $3, $4, $5)`,
        [
          newId(),
          candidate.workspace_id,
          spaceStandardGroupId,
          spaceContextId,
          EDIT_LEVEL,
        ],
      );

      if (candidate.founding_member_id) {
        await client.query(
          `insert into space_members (id, workspace_id, space_id, member_id, role)
           values ($1, $2, $3, $4, 'manager')`,
          [
            newId(),
            candidate.workspace_id,
            spaceId,
            candidate.founding_member_id,
          ],
        );
        await client.query(
          `insert into access_group_memberships (id, workspace_id, group_id, member_id)
           values ($1, $2, $3, $4)`,
          [
            newId(),
            candidate.workspace_id,
            spaceStandardGroupId,
            candidate.founding_member_id,
          ],
        );

        // The manager's `full` binding hangs off their own member group, which
        // provisioning already created. Found rather than assumed: a workspace
        // predating P2-T01 may not have one.
        const { rows: groupRows } = await client.query<{ id: string }>(
          `select id from access_groups
            where workspace_id = $1
              and kind = 'member'
              and member_id = $2
              and deleted_at is null
            limit 1`,
          [candidate.workspace_id, candidate.founding_member_id],
        );
        let memberGroupId = groupRows[0]?.id;
        if (!memberGroupId) {
          memberGroupId = newId();
          await client.query(
            `insert into access_groups (id, workspace_id, kind, member_id)
             values ($1, $2, 'member', $3)`,
            [
              memberGroupId,
              candidate.workspace_id,
              candidate.founding_member_id,
            ],
          );
        }
        await client.query(
          `insert into access_bindings (id, workspace_id, group_id, context_id, level)
           values ($1, $2, $3, $4, $5)`,
          [
            newId(),
            candidate.workspace_id,
            memberGroupId,
            spaceContextId,
            FULL_LEVEL,
          ],
        );
      }

      created += 1;
    }

    const last = rows.at(-1);

    return {
      done: rows.length < BATCH_SIZE,
      cursor: last?.workspace_id ?? undefined,
      rowsChanged: created,
    };
  },
};
