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

/**
 * The authenticated identity, for the one question that genuinely spans
 * workspaces: which workspaces this person belongs to. The switcher asks it on
 * every page. Answering it with a policy keyed on the user keeps the answer
 * inside row-level security; the alternative is a privileged query stepping
 * around the floor, which is a cross-tenant read in the place a mistake is
 * least likely to be spotted.
 *
 * The policies that use this setting are read-only. It never authorises a
 * write, and it is not a substitute for the workspace setting.
 */
export const USER_SETTING = "app.user_id";

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
  return withContext(db, { workspaceId }, fn);
}

/**
 * The same, applying the authenticated identity instead of the workspace. Use
 * it only for the membership lookup: it answers "which workspaces are mine",
 * and nothing else is readable through it.
 */
export async function withUser<
  T,
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  db: NodePgDatabase<TSchema>,
  userId: string,
  fn: (tx: WorkspaceTx<TSchema>) => Promise<T> | T,
): Promise<T> {
  return withContext(db, { userId }, fn);
}

/** What a transaction is scoped to. At least one of the two is required. */
export interface TenantContext {
  readonly workspaceId?: string;
  readonly userId?: string;
}

/**
 * Opens a transaction and applies the tenant context transaction-locally.
 *
 * Provisioning needs both settings at once: it inserts into the new workspace
 * (which needs the workspace setting) while checking whether the person is
 * already a member somewhere (which needs the user setting).
 *
 * Both values are validated before any query runs. They come from the session,
 * never from client input, but this wrapper does not trust its callers either.
 */
export async function withContext<
  T,
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  db: NodePgDatabase<TSchema>,
  context: TenantContext,
  fn: (tx: WorkspaceTx<TSchema>) => Promise<T> | T,
): Promise<T> {
  const { workspaceId, userId } = context;

  if (workspaceId !== undefined && !UUID.test(workspaceId)) {
    throw new Error("Invalid workspace id: expected a UUID.");
  }
  // User ids come from Better Auth, which uses opaque text rather than UUIDs,
  // so the check is a sanity bound rather than a format.
  if (userId !== undefined && (userId === "" || userId.length > 255)) {
    throw new Error("Invalid user id: expected a non-empty identifier.");
  }
  if (workspaceId === undefined && userId === undefined) {
    throw new Error(
      "A tenant context needs a workspace id, a user id, or both.",
    );
  }

  return db.transaction(async (tx) => {
    // set_config(..., true) is SET LOCAL: it vanishes when this transaction
    // ends, committed or not.
    if (workspaceId !== undefined) {
      await tx.execute(
        sql`select set_config(${WORKSPACE_SETTING}, ${workspaceId}, true)`,
      );
    }
    if (userId !== undefined) {
      await tx.execute(
        sql`select set_config(${USER_SETTING}, ${userId}, true)`,
      );
    }
    return fn(tx);
  });
}
