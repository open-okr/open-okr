/** Adds the session creation domain to active built-in roles (0.9.1 A1). */
import type { DataChangeScript } from "../data-change.ts";

const BATCH = 100;

export const sessionRolePermissions: DataChangeScript = {
  name: "0036_session_role_permissions",
  summary: "Adds missing session creation permissions to built-in roles.",
  expects: [
    { table: "workspace_roles", column: "workspace_id", dataType: "uuid" },
    { table: "workspace_roles", column: "builtin_key", dataType: "text" },
    { table: "role_permissions", column: "domain", dataType: "text" },
    { table: "role_permissions", column: "level", dataType: "integer" },
  ],
  async runBatch(client, cursor) {
    await client.query("select set_config('app.system_scan', 'on', true)");
    const { rows: workspaces } = await client.query<{ id: string }>(
      `select id from workspaces
        where deleted_at is null and ($1::uuid is null or id > $1::uuid)
        order by id limit $2`,
      [cursor, BATCH],
    );
    await client.query("select set_config('app.system_scan', '', true)");

    let rowsChanged = 0;
    for (const { id } of workspaces) {
      await client.query("select set_config('app.workspace_id', $1, true)", [
        id,
      ]);
      const { rows } = await client.query(
        `insert into role_permissions (id, workspace_id, role_id, domain, level)
         select gen_random_uuid(), workspace_id, id, 'session',
                case builtin_key when 'viewer' then 10 when 'member' then 70 else 100 end
           from workspace_roles
          where workspace_id = $1 and deleted_at is null
            and builtin_key in ('owner', 'admin', 'member', 'viewer')
         on conflict (workspace_id, role_id, domain) where deleted_at is null do nothing
         returning id`,
        [id],
      );
      rowsChanged += rows.length;
    }
    await client.query("select set_config('app.workspace_id', '', true)");
    const last = workspaces.at(-1);
    return {
      done: workspaces.length < BATCH,
      ...(last ? { cursor: last.id } : {}),
      rowsChanged,
    };
  },
};
