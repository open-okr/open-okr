/**
 * Gives every row of the seven addressable aggregates its short identifier
 * (docs/design/short-ids.md S3, approved by Akmal on 10 November 2026;
 * migration 0163).
 *
 * From 0.7.0 every write that creates a cycle, a goal, a key result, an
 * initiative, a task, a document or a session gives it a `short_id`. Rows
 * written before have none, and so do rows a 0.6 replica writes during a
 * rolling upgrade, because that release does not know the column. This fills
 * both. 0.8.0's migration makes the column not null, and refuses to run until
 * this has, which is why the column is nullable for one release.
 *
 * **Drawn from `newShortId`, the generator every write uses**, so a filled
 * row looks exactly like a written one. A candidate another row in the same
 * workspace already holds is not written; that row stays empty and gets a
 * fresh draw on the next batch, which is the collision retry.
 *
 * **One workspace at a time, inside its own tenant setting.** As 0033 does:
 * the admin connection may be the table owner rather than a superuser, and
 * FORCE ROW LEVEL SECURITY binds the owner too, so workspaces are listed
 * through the scheduler's read-only scan setting and each is then opened as
 * the application opens it. The floor is never lifted.
 *
 * **Batched by rows, not only by workspace.** The performance dataset has a
 * million tasks in one workspace, and one transaction writing all of them
 * would hold its locks for minutes. A batch fills at most `BATCH` rows; a
 * workspace with more is visited again, and the cursor moves past it only
 * once a batch finds fewer rows than that.
 *
 * Safe to run again: only empty rows are written.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";
import { newShortId } from "../id.ts";

/** The seven tables, in the order a batch fills them. */
const TABLES = [
  "cycles",
  "goals",
  "key_results",
  "initiatives",
  "tasks",
  "documents",
  "okr_sessions",
] as const;

/** The most rows one batch writes, across every table. */
const BATCH = 1_000;

/** Up to `limit` rows of `table` in this workspace that have no short id. */
async function emptyRows(
  client: DataChangeClient,
  table: string,
  workspaceId: string,
  limit: number,
): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `select id from ${table}
      where workspace_id = $1 and short_id is null
      order by id
      limit $2`,
    [workspaceId, limit],
  );
  return rows.map((row) => row.id);
}

/** Fills these rows, each with its own draw, and answers how many it wrote. */
async function fill(
  client: DataChangeClient,
  table: string,
  workspaceId: string,
  ids: readonly string[],
): Promise<number> {
  // Distinct within the batch, so two rows here never draw the same one.
  const drawn = new Set<string>();
  while (drawn.size < ids.length) {
    drawn.add(newShortId());
  }
  const { rows } = await client.query(
    `update ${table} t
        set short_id = c.short_id
       from unnest($2::uuid[], $3::text[]) as c(id, short_id)
      where t.id = c.id
        and t.workspace_id = $1
        and t.short_id is null
        and not exists (
          select 1 from ${table} o
           where o.workspace_id = $1 and o.short_id = c.short_id
        )
      returning 1`,
    [workspaceId, ids, [...drawn]],
  );
  return rows.length;
}

export const shortIds: DataChangeScript = {
  name: "0034_short_ids",
  summary:
    "Gives every cycle, goal, key result, initiative, task, document and session without one its short identifier.",
  expects: TABLES.flatMap((table) => [
    { table, column: "id", dataType: "uuid" },
    { table, column: "workspace_id", dataType: "uuid" },
    { table, column: "short_id", dataType: "text" },
  ]),
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    // The scheduler's read-only scan lists tenants without a role that
    // bypasses the floor (migration 0099). Local to this batch.
    await client.query("select set_config('app.system_scan', 'on', true)");
    const { rows: next } = await client.query<{ id: string }>(
      `select id from workspaces
        where ($1::uuid is null or id > $1::uuid)
        order by id limit 2`,
      [cursor],
    );
    await client.query("select set_config('app.system_scan', '', true)");

    const workspace = next[0];
    if (!workspace) {
      return { done: true, rowsChanged: 0 };
    }

    await client.query("select set_config('app.workspace_id', $1, true)", [
      workspace.id,
    ]);
    let found = 0;
    let written = 0;
    for (const table of TABLES) {
      if (found >= BATCH) {
        break;
      }
      const ids = await emptyRows(client, table, workspace.id, BATCH - found);
      found += ids.length;
      if (ids.length > 0) {
        written += await fill(client, table, workspace.id, ids);
      }
    }
    await client.query("select set_config('app.workspace_id', '', true)");

    // A full batch may have left more here, and a collision left a row empty
    // for a fresh draw: either way, visit this workspace again. The cursor
    // stays where it was, which is the workspace before this one.
    if (found >= BATCH || written < found) {
      return {
        done: false,
        ...(cursor === null ? {} : { cursor }),
        rowsChanged: written,
      };
    }
    return {
      done: next.length < 2,
      cursor: workspace.id,
      rowsChanged: written,
    };
  },
};
