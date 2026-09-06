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

/**
 * Permits writes to instance settings for one transaction.
 *
 * The same shape as the tenant floor, applied to the table that sits above
 * every workspace. Ordinary request paths never set it, so a stray write to
 * `system_settings` from a request handler is refused by Postgres rather than
 * caught in review. The wizard and instance administration set it on purpose.
 */
export const INSTANCE_ADMIN_SETTING = "app.instance_admin";

/**
 * Names one provider workspace, for the pre-tenant installation lookup
 * (P5-T02a).
 *
 * An inbound webhook has not identified an OpenOKR workspace yet, and finding
 * out which one it is *is* the question. `channel_installations` admits a row
 * either through the ordinary tenant setting or through this one matching its
 * own `external_team_id`, which is the same arrangement `app.user_id` has on
 * `workspace_members`. A caller can only see the row for a team id they
 * already hold.
 */
const CHANNEL_TEAM_SETTING = "app.channel_team_id";

/**
 * Names one token's hash, for the pre-tenant token lookup (P5-T07a).
 *
 * A REST request carries a bearer token and nothing else, so which workspace it
 * belongs to is the question rather than the context. `api_tokens` admits a row
 * either through the ordinary tenant setting or through this one matching its
 * own `token_hash`, so the caller can reach exactly the row whose token it
 * already holds. Somebody who does not have the token learns nothing, including
 * whether it exists.
 */
const API_TOKEN_HASH_SETTING = "app.api_token_hash";

/**
 * Names one device code's hash, for the device login (P5-T07c-b).
 *
 * A terminal running `okr login` has no session and no workspace: finding out
 * which workspace it belongs to *is* the flow. `device_authorisations` admits a
 * row through the ordinary tenant setting or through this one matching either of
 * its two code hashes, so a caller reaches exactly the request whose code it
 * already holds. The third table in the product read before a tenant is known,
 * after `channel_installations` and `api_tokens`, and the same shape as both.
 */
const DEVICE_CODE_HASH_SETTING = "app.device_code_hash";

/**
 * The fourth pre-tenant key, and the only one three tables share (P5-T08a).
 *
 * An OAuth authorisation code, access token and refresh token are all secrets a
 * client presents before any workspace is known, and in all three cases the row
 * it may reach is the one whose own digest equals this. Sharing the name does
 * not widen anything: each policy still compares against its own column, so a
 * caller holding a code hash cannot reach an access token and the reverse.
 */
const OAUTH_SECRET_HASH_SETTING = "app.oauth_secret_hash";

/** What a transaction is scoped to. At least one of the three is required. */
export interface TenantContext {
  readonly workspaceId?: string;
  readonly userId?: string;
  /** Opens instance-settings writes. Never set from a request handler. */
  readonly instanceAdmin?: boolean;
  /**
   * Names one provider workspace, for the installation lookup only (P5-T02a).
   *
   * Reveals exactly the `channel_installations` row whose `external_team_id`
   * equals it, and nothing else in the database.
   */
  readonly channelTeamId?: string;
  /**
   * Names one token hash, for the token lookup only (P5-T07a).
   *
   * Reveals exactly the `api_tokens` row whose `token_hash` equals it, and
   * nothing else in the database.
   */
  readonly apiTokenHash?: string;
  /**
   * Names one device code hash, for the device login only (P5-T07c-b).
   *
   * Reveals exactly the `device_authorisations` row whose device code or user
   * code hashes to it, and nothing else in the database.
   */
  readonly deviceCodeHash?: string;
  /**
   * Names one OAuth secret's hash, for the authorisation server only
   * (P5-T08a).
   *
   * Reveals exactly the `oauth_codes`, `oauth_access_tokens` or
   * `oauth_refresh_tokens` row whose own hash equals it, and nothing else in
   * the database.
   */
  readonly oauthSecretHash?: string;
}

/**
 * Opens a transaction that can find which workspace installed one provider
 * team (P5-T02a).
 *
 * Use it for that lookup and nothing else: it is the only read in the product
 * that runs before a tenant is known, and the one row it can reach is the one
 * the caller already named.
 */
export async function withProviderTeam<
  T,
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  db: NodePgDatabase<TSchema>,
  teamId: string,
  fn: (tx: WorkspaceTx<TSchema>) => Promise<T> | T,
): Promise<T> {
  return withContext(db, { channelTeamId: teamId }, fn);
}

/**
 * Opens a transaction that can resolve one bearer token (P5-T07a).
 *
 * Use it for that lookup and nothing else. The row it can reach is the one the
 * caller already named by hash, and the tenant setting for the workspace the
 * token names is applied afterwards, for the call itself.
 */
export async function withApiToken<
  T,
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  db: NodePgDatabase<TSchema>,
  tokenHash: string,
  fn: (tx: WorkspaceTx<TSchema>) => Promise<T> | T,
): Promise<T> {
  return withContext(db, { apiTokenHash: tokenHash }, fn);
}

/**
 * Opens a transaction that can read and write one device authorisation
 * (P5-T07c-b).
 *
 * Use it for the device login and nothing else. Either code's hash reaches the
 * request, which is what lets the terminal poll with one and the browser look
 * up with the other.
 */
export async function withDeviceCode<
  T,
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  db: NodePgDatabase<TSchema>,
  codeHash: string,
  fn: (tx: WorkspaceTx<TSchema>) => Promise<T> | T,
): Promise<T> {
  return withContext(db, { deviceCodeHash: codeHash }, fn);
}

/**
 * Opens a transaction that can resolve one OAuth secret (P5-T08a).
 *
 * Use it for the token endpoint and the access-token lookup, and nothing else.
 * The row it reaches is the one the caller already named by hash, and the
 * ordinary tenant setting is applied afterwards for the work itself.
 */
export async function withOAuthSecret<
  T,
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  db: NodePgDatabase<TSchema>,
  secretHash: string,
  fn: (tx: WorkspaceTx<TSchema>) => Promise<T> | T,
): Promise<T> {
  return withContext(db, { oauthSecretHash: secretHash }, fn);
}

/**
 * Opens a transaction that may write instance settings.
 *
 * Deliberately separate from `withWorkspace` and `withUser`: instance settings
 * are not workspace data, and a caller should have to name what it is doing.
 */
export async function withInstanceAdmin<
  T,
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  db: NodePgDatabase<TSchema>,
  fn: (tx: WorkspaceTx<TSchema>) => Promise<T> | T,
): Promise<T> {
  return withContext(db, { instanceAdmin: true }, fn);
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
  const {
    workspaceId,
    userId,
    instanceAdmin,
    channelTeamId,
    apiTokenHash,
    deviceCodeHash,
    oauthSecretHash,
  } = context;

  if (workspaceId !== undefined && !UUID.test(workspaceId)) {
    throw new Error("Invalid workspace id: expected a UUID.");
  }
  // User ids come from Better Auth, which uses opaque text rather than UUIDs,
  // so the check is a sanity bound rather than a format.
  if (userId !== undefined && (userId === "" || userId.length > 255)) {
    throw new Error("Invalid user id: expected a non-empty identifier.");
  }
  if (
    channelTeamId !== undefined &&
    (channelTeamId === "" || channelTeamId.length > 255)
  ) {
    throw new Error(
      "Invalid provider team id: expected a non-empty identifier.",
    );
  }
  // A hash, not a token: the caller has already digested it, so a length
  // check is a shape check rather than a bound on a secret.
  if (deviceCodeHash !== undefined && !/^[0-9a-f]{64}$/.test(deviceCodeHash)) {
    throw new Error("Invalid device code hash: expected a SHA-256 hex digest.");
  }
  if (apiTokenHash !== undefined && !/^[0-9a-f]{64}$/.test(apiTokenHash)) {
    throw new Error("Invalid token hash: expected a SHA-256 hex digest.");
  }
  if (
    oauthSecretHash !== undefined &&
    !/^[0-9a-f]{64}$/.test(oauthSecretHash)
  ) {
    throw new Error(
      "Invalid OAuth secret hash: expected a SHA-256 hex digest.",
    );
  }
  if (
    workspaceId === undefined &&
    userId === undefined &&
    channelTeamId === undefined &&
    apiTokenHash === undefined &&
    deviceCodeHash === undefined &&
    oauthSecretHash === undefined &&
    !instanceAdmin
  ) {
    throw new Error(
      "A tenant context needs a workspace id, a user id, a provider team id, a token hash, a device code hash, an OAuth secret hash, or instance admin.",
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
    if (instanceAdmin) {
      await tx.execute(
        sql`select set_config(${INSTANCE_ADMIN_SETTING}, 'on', true)`,
      );
    }
    if (channelTeamId !== undefined) {
      await tx.execute(
        sql`select set_config(${CHANNEL_TEAM_SETTING}, ${channelTeamId}, true)`,
      );
    }
    if (apiTokenHash !== undefined) {
      await tx.execute(
        sql`select set_config(${API_TOKEN_HASH_SETTING}, ${apiTokenHash}, true)`,
      );
    }
    if (deviceCodeHash !== undefined) {
      await tx.execute(
        sql`select set_config(${DEVICE_CODE_HASH_SETTING}, ${deviceCodeHash}, true)`,
      );
    }
    if (oauthSecretHash !== undefined) {
      await tx.execute(
        sql`select set_config(${OAUTH_SECRET_HASH_SETTING}, ${oauthSecretHash}, true)`,
      );
    }
    return fn(tx);
  });
}
