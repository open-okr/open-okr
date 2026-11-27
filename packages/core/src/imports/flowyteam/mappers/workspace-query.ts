/**
 * One read against the target, under the workspace's tenant setting.
 *
 * For the few questions no read action answers in bulk: which values an
 * earlier run already wrote, read once per run rather than once per row. Reads
 * only, because every write goes through an action.
 */
import type { Pool } from "pg";

export async function withWorkspaceQuery<T extends Record<string, unknown>>(
  pool: Pool,
  workspaceId: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.workspace_id', $1, true)", [
      workspaceId,
    ]);
    const result = await client.query<T>(sql, params);
    await client.query("commit");
    return result.rows;
  } finally {
    client.release();
  }
}
