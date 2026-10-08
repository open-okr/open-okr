/**
 * Gives every workspace provisioned before P8-G13a its four roles, and every
 * human member a role to hold (migration 0108,
 * docs/design/workspace-roles.md).
 *
 * | Who | Becomes |
 * |---|---|
 * | The oldest active human member of the workspace | Owner |
 * | A manager or coordinator of any space | Admin |
 * | Every other active human member | Member |
 * | A guest, an agent, a placeholder | Nothing. They keep their bindings |
 *
 * **A guest gets no role on purpose.** A guest holds nothing on the
 * workspace's own context because they were invited into one space; handing
 * them a workspace-wide role would give them the whole workspace, which is the
 * opposite of what their invitation said. A guest is recognised the way the
 * resolver recognises one: no live binding on the workspace context.
 *
 * **The oldest member rather than a stored founder.** Nothing records who
 * created a workspace, and the first member row is the closest fact to it:
 * `insertWorkspaceAndMember` writes the workspace and that member in one
 * transaction. Ids are time-ordered, so "oldest" is `order by id`.
 *
 * Batched by a keyset on `workspaces.id`, the same shape as 0002. Idempotent
 * by predicate twice over: a workspace that already has roles is skipped, and
 * a member who already holds one is left alone, so an administrator who
 * assigned roles by hand between the migration and this run keeps them.
 *
 * The matrix written here is the one in `packages/core/src/access/roles.ts`,
 * written out rather than imported for the reason every data change gives:
 * `packages/db` cannot depend on `packages/core`, and a data change runs
 * against its own moment rather than whatever the application later becomes.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

const BATCH_SIZE = 100;

/** [builtin key, name, is default, goal, kpi, initiative, task, comment, space, workspace] */
const ROLES: readonly (readonly [
  string,
  string,
  boolean,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
])[] = [
  ["owner", "Owner", false, 100, 100, 100, 100, 100, 100, 100],
  ["admin", "Admin", false, 100, 100, 100, 100, 100, 100, 70],
  ["member", "Member", true, 70, 70, 70, 70, 40, 10, 10],
  ["viewer", "Viewer", false, 10, 10, 10, 10, 10, 10, 10],
];

const DOMAINS = [
  "goal",
  "kpi",
  "initiative",
  "task",
  "comment",
  "space",
  "workspace",
] as const;

export const backfillWorkspaceRoles: DataChangeScript = {
  name: "0012_backfill_workspace_roles",
  summary:
    "Seeds the four built-in roles per workspace and gives every active human member one.",
  expects: [
    { table: "workspaces", column: "id", dataType: "uuid" },
    { table: "workspace_roles", column: "workspace_id", dataType: "uuid" },
    { table: "workspace_roles", column: "builtin_key", dataType: "text" },
    { table: "workspace_roles", column: "is_default", dataType: "boolean" },
    { table: "role_permissions", column: "role_id", dataType: "uuid" },
    { table: "role_permissions", column: "domain", dataType: "text" },
    { table: "role_permissions", column: "level", dataType: "integer" },
    { table: "workspace_members", column: "role_id", dataType: "uuid" },
    { table: "workspace_members", column: "kind", dataType: "text" },
    { table: "space_members", column: "role", dataType: "text" },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ id: string }>(
      `select w.id
         from workspaces w
        where w.deleted_at is null
          and ($1::uuid is null or w.id > $1::uuid)
          and not exists (
            select 1 from workspace_roles r
             where r.workspace_id = w.id
               and r.deleted_at is null
          )
        order by w.id
        limit $2`,
      [cursor, BATCH_SIZE],
    );

    let changed = 0;
    for (const { id: workspaceId } of rows) {
      for (const [key, name, isDefault, ...levels] of ROLES) {
        const { rows: created } = await client.query<{ id: string }>(
          `insert into workspace_roles (id, workspace_id, name, builtin_key, is_default)
           values (gen_random_uuid(), $1, $2, $3, $4)
           returning id`,
          [workspaceId, name, key, isDefault],
        );
        const roleId = created[0]?.id;
        if (!roleId) {
          continue;
        }
        changed += 1;
        for (const [index, domain] of DOMAINS.entries()) {
          await client.query(
            `insert into role_permissions (id, workspace_id, role_id, domain, level)
             values (gen_random_uuid(), $1, $2, $3, $4)`,
            [workspaceId, roleId, domain, levels[index] ?? 0],
          );
        }
      }

      // Owner: the oldest active human member who holds a live binding on the
      // workspace's own context. The binding is what tells a member from a
      // guest, and `order by id` is the closest fact to "created it".
      const { rows: ownerRows } = await client.query<{ id: string }>(
        `update workspace_members m
            set role_id = (
              select r.id from workspace_roles r
               where r.workspace_id = m.workspace_id
                 and r.builtin_key = 'owner'
                 and r.deleted_at is null
            )
          where m.id = (
            select m2.id
              from workspace_members m2
             where m2.workspace_id = $1
               and m2.kind = 'human'
               and m2.status = 'active'
               and m2.deleted_at is null
               and exists (
                 select 1
                   from access_bindings b
                   join access_groups g on g.id = b.group_id and g.deleted_at is null
                   join access_contexts c on c.id = b.context_id and c.deleted_at is null
                  where b.workspace_id = m2.workspace_id
                    and b.deleted_at is null
                    and c.resource_type = 'workspace'
                    and c.resource_id = m2.workspace_id
                    and g.kind = 'member'
                    and g.member_id = m2.id
               )
             order by m2.id
             limit 1
          )
          returning m.id`,
        [workspaceId],
      );
      changed += ownerRows.length;

      // Admin: anybody managing or coordinating a space, who is not already
      // the owner.
      const { rows: adminRows } = await client.query<{ id: string }>(
        `update workspace_members m
            set role_id = (
              select r.id from workspace_roles r
               where r.workspace_id = m.workspace_id
                 and r.builtin_key = 'admin'
                 and r.deleted_at is null
            )
          where m.workspace_id = $1
            and m.kind = 'human'
            and m.status = 'active'
            and m.deleted_at is null
            and m.role_id is null
            and exists (
              select 1 from space_members sm
               where sm.member_id = m.id
                 and sm.deleted_at is null
                 and sm.role in ('manager', 'coordinator')
            )
          returning m.id`,
        [workspaceId],
      );
      changed += adminRows.length;

      // Member: every other active human holding a binding on the workspace
      // context. A guest holds none and is skipped.
      const { rows: memberRows } = await client.query<{ id: string }>(
        `update workspace_members m
            set role_id = (
              select r.id from workspace_roles r
               where r.workspace_id = m.workspace_id
                 and r.builtin_key = 'member'
                 and r.deleted_at is null
            )
          where m.workspace_id = $1
            and m.kind = 'human'
            and m.status = 'active'
            and m.deleted_at is null
            and m.role_id is null
            and exists (
              select 1
                from access_bindings b
                join access_groups g on g.id = b.group_id and g.deleted_at is null
                join access_contexts c on c.id = b.context_id and c.deleted_at is null
               where b.workspace_id = m.workspace_id
                 and b.deleted_at is null
                 and c.resource_type = 'workspace'
                 and c.resource_id = m.workspace_id
                 and (
                   g.kind = 'workspace_standard'
                   or (g.kind = 'member' and g.member_id = m.id)
                 )
            )
          returning m.id`,
        [workspaceId],
      );
      changed += memberRows.length;
    }

    return {
      done: rows.length < BATCH_SIZE,
      cursor: rows[rows.length - 1]?.id ?? undefined,
      rowsChanged: changed,
    };
  },
};
