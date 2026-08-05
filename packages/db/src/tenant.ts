/**
 * The request-scoped tenant wrapper (TECHNICAL-PLAN §2).
 *
 * One rule, held everywhere: the workspace setting is applied with SET LOCAL
 * semantics inside a transaction, never at session level. A pooled server
 * connection is handed to another client the moment a transaction ends, and
 * only transaction-local state is guaranteed to die with it. The pooling
 * spike suite proves this through PgBouncer in transaction mode.
 */
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** The transaction-local setting every row-level security policy keys on. */
export const WORKSPACE_SETTING = "app.workspace_id";

/** The drizzle transaction handed to a `withWorkspace` callback. */
export type WorkspaceTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
> = Parameters<Parameters<NodePgDatabase<TSchema>["transaction"]>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opens a transaction, applies the workspace setting transaction-locally,
 * and runs `fn` inside it. Every tenant-scoped read and write goes through
 * here; there is no other supported way to satisfy the row-level policies.
 *
 * The workspace id is validated before any query. It comes from the session
 * or an agent binding, never from client input, but the wrapper does not
 * trust its callers either.
 */
export async function withWorkspace<
  T,
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  db: NodePgDatabase<TSchema>,
  workspaceId: string,
  fn: (tx: WorkspaceTx<TSchema>) => Promise<T> | T,
): Promise<T> {
  if (!UUID.test(workspaceId)) {
    throw new Error("Invalid workspace id: expected a UUID.");
  }
  return db.transaction(async (tx) => {
    // set_config(..., true) is SET LOCAL: it vanishes when this transaction
    // ends, committed or not.
    await tx.execute(
      sql`select set_config(${WORKSPACE_SETTING}, ${workspaceId}, true)`,
    );
    return fn(tx);
  });
}
