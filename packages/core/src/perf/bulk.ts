/**
 * Batched inserts for the performance dataset (P7-T01a).
 *
 * **Why this exists rather than the Operation pipeline.** Every product write
 * goes through `runOperation`: one transaction carrying the domain change, the
 * access rows, an activity row, an audit row and an outbox row, committed
 * together. That is the right shape for a write somebody made, and it is the
 * wrong shape for a million rows nobody made. A million Operations is a
 * million transactions and five million extra rows, and it would take hours to
 * produce a dataset whose only job is to have the right *shape* for a query
 * plan to be measured against.
 *
 * **Why `unnest` rather than `COPY` or a thousand placeholders.** `COPY` is
 * faster still and needs `pg-copy-streams`, a dependency this repository has
 * not agreed to carry for a seeding script. A multi-row `VALUES` list hits
 * Postgres's 65,535-parameter ceiling at a few thousand rows and forces the
 * batch size to depend on the column count. `insert into t (...) select * from
 * unnest($1::uuid[], $2::text[], ...)` sends one array per column whatever the
 * row count, so the batch size is a memory decision rather than a protocol
 * one, and it is plain libpq with nothing new installed.
 *
 * **Row-level security still applies.** Every business table carries forced
 * row-level security keyed on `app.workspace_id`, so the caller sets it with
 * `SET LOCAL` on the same transaction. That is deliberate: a seeder that
 * reached past the tenant floor would be the one program in the repository
 * proving nothing about whether the floor works.
 */
import type pg from "pg";

/** A column, and the Postgres array type its values are sent as. */
export interface BulkColumn {
  readonly name: string;
  /** `uuid`, `text`, `numeric`, `int4`, `bool`, `timestamptz`, `jsonb`, `date`. */
  readonly type: string;
}

/**
 * How many rows go in one statement.
 *
 * 5,000 keeps each statement's arrays comfortably inside a few megabytes at
 * the widest table here, and a million rows is 200 round trips rather than
 * 200,000. Raising it trades memory in this process for fewer round trips and
 * stops helping well before it stops costing.
 */
export const BULK_BATCH = 5_000;

/**
 * Inserts `rows` into `table`, one statement per `batchSize` rows.
 *
 * `rows` is row-major (one array per row, in `columns` order) because that is
 * how a generator naturally produces them; this transposes to the column-major
 * arrays `unnest` wants. Returns the number of rows inserted, which the caller
 * uses for its progress line rather than trusting its own arithmetic.
 */
export async function bulkInsert(
  client: pg.PoolClient,
  table: string,
  columns: readonly BulkColumn[],
  rows: readonly (readonly unknown[])[],
  batchSize: number = BULK_BATCH,
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  const names = columns.map((column) => `"${column.name}"`).join(", ");
  const unnest = columns
    .map((column, index) => `$${index + 1}::${column.type}[]`)
    .join(", ");
  const statement = `insert into "${table}" (${names}) select * from unnest(${unnest})`;

  let written = 0;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    // Column-major: one array per column, each as long as the batch.
    const parameters = columns.map((_column, index) =>
      batch.map((row) => row[index] ?? null),
    );
    await client.query(statement, parameters);
    written += batch.length;
  }
  return written;
}

/**
 * Opens a transaction with the tenant setting applied, runs `body`, commits.
 *
 * `SET LOCAL` rather than `SET`, so the setting dies with the transaction and
 * cannot leak into whatever the pooled connection serves next. This is the
 * same discipline the Operation pipeline follows and the reason it is
 * `PoolClient` in the signature: the setting and the writes have to be on one
 * connection or the policy sees nothing.
 */
export async function inTenantTransaction<T>(
  pool: pg.Pool,
  workspaceId: string,
  body: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.workspace_id', $1, true)", [
      workspaceId,
    ]);
    const result = await body(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
