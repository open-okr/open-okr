/**
 * Identity-provider tokens sealed at rest (completeness review L-11).
 *
 * When somebody signs in through an OIDC provider, Better Auth keeps the
 * provider's access token, refresh token and ID token on their `accounts`
 * row. Stored as issued, those three columns are live credentials at the
 * organisation's own identity provider: a database dump, a stray backup or a
 * read-only SQL injection would hand them over. So they are sealed with the
 * envelope every other stored credential uses (`key-ring.ts`), under the
 * instance's root key, and `pnpm keys:rotate` re-wraps them with the rest.
 *
 * Like the session-token hashing beside it, this wraps the database adapter,
 * which is Better Auth's documented extension point, rather than reaching
 * into its internals:
 *
 *  - writing an account seals each token field that holds a value;
 *  - reading one opens them again, so Better Auth, and a token refresh it
 *    performs, sees exactly what the provider issued.
 *
 * **Better Auth's own `account.encryptOAuthTokens` is not used**, for three
 * reasons:
 *
 * | Its option | Why that does not fit |
 * |---|---|
 * | Encrypts under `BETTER_AUTH_SECRET` | `keys:rotate` cannot re-wrap it, and changing that secret strands every stored token |
 * | Covers the access and refresh tokens | Leaves the ID token, which carries the person's claims, in plain text |
 * | Recognises its own output as "hex of even length" | An opaque provider token that happens to be hex would be "decrypted", and fail |
 *
 * **The stored form is one text value**, because Better Auth owns the column
 * and reads and writes it itself:
 *
 *   openokr-sealed:v1:<key id>:<wrapped data key>:<ciphertext>
 *
 * The three parts are exactly what `encryptSecret` returns, so this is the
 * envelope `ai_credentials` and the others store in three columns, carried in
 * one. The key id is hex and the other two are base64, so none holds a colon.
 */
import {
  decryptSecret,
  encryptSecret,
  type KeyRing,
  newRootKey,
  parseKeyRing,
  rewrapSecret,
  type SealedSecret,
} from "../secrets/key-ring.ts";
import type { AdapterLike, TransactionFn } from "./session-hashing.ts";

const ACCOUNT_MODEL = "account";
const TOKEN_FIELDS = ["accessToken", "refreshToken", "idToken"] as const;

/**
 * How every sealed token starts. Exported for the SQL that finds them, which
 * is rotation's; the data change that seals old rows carries its own copy,
 * because a data change is frozen at the moment it was written.
 */
export const SEALED_ACCOUNT_TOKEN_PREFIX = "openokr-sealed:v1:";
const PREFIX = SEALED_ACCOUNT_TOKEN_PREFIX;

/** Whether a stored value is one this module sealed. */
export function isSealedAccountToken(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Seals a provider token for the `accounts` table. */
export function sealAccountToken(ring: KeyRing, token: string): string {
  const sealed = encryptSecret(ring, token);
  return `${PREFIX}${sealed.keyId}:${sealed.dataKey}:${sealed.ciphertext}`;
}

const parse = (value: string): SealedSecret | null => {
  if (!isSealedAccountToken(value)) {
    return null;
  }
  const [keyId, dataKey, ciphertext, ...rest] = value
    .slice(PREFIX.length)
    .split(":");
  if (!keyId || !dataKey || !ciphertext || rest.length > 0) {
    return null;
  }
  return { keyId, dataKey, ciphertext };
};

/**
 * Opens a stored token. A value written before sealing existed comes back as
 * it is, which is what it always was. Throws `KeyRingError` when the value is
 * sealed and cannot be opened.
 */
export function openAccountToken(ring: KeyRing, value: string): string {
  if (!isSealedAccountToken(value)) {
    return value;
  }
  const sealed = parse(value);
  if (!sealed) {
    // Never echo the value: it is a credential, or a damaged copy of one.
    throw new TypeError("A sealed account token is malformed.");
  }
  return decryptSecret(ring, sealed);
}

/**
 * Moves a sealed token onto the ring's current root key, for rotation.
 *
 * Returns the value unchanged when it is already current. Like every other
 * re-wrap, the token itself is never decrypted: only its data key is.
 */
export function rewrapAccountToken(ring: KeyRing, value: string): string {
  const sealed = parse(value);
  if (!sealed || sealed.keyId === ring.current.id) {
    return value;
  }
  const next = rewrapSecret(ring, sealed);
  return `${PREFIX}${next.keyId}:${next.dataKey}:${next.ciphertext}`;
}

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Wraps an adapter so provider tokens are sealed on the way in and opened on
 * the way out. Every other model and field passes through untouched.
 *
 * `ring` is read the first time a token is sealed or opened, not when the
 * wrapper is built, so building the auth instance needs no key and a
 * password sign-in never reads one.
 */
export function withSealedAccountTokens<T extends AdapterLike>(
  adapter: T,
  ring: () => KeyRing,
): T {
  const seal = (data: unknown): unknown => {
    if (!isRow(data)) {
      return data;
    }
    const out: Row = { ...data };
    for (const field of TOKEN_FIELDS) {
      const value = out[field];
      // An empty string is what the SAML path stores for "no token", and
      // there is nothing in it to protect.
      if (
        typeof value === "string" &&
        value !== "" &&
        !isSealedAccountToken(value)
      ) {
        out[field] = sealAccountToken(ring(), value);
      }
    }
    return out;
  };

  const open = (row: unknown): unknown => {
    if (!isRow(row)) {
      return row;
    }
    let out: Row | null = null;
    for (const field of TOKEN_FIELDS) {
      const value = row[field];
      if (typeof value !== "string" || !isSealedAccountToken(value)) {
        continue;
      }
      out ??= { ...row };
      try {
        out[field] = openAccountToken(ring(), value);
      } catch {
        // **An unreadable token reads as no token.** It happens when the key
        // that sealed it has left the ring, or on a development machine whose
        // key changes at every restart. Refusing here would refuse the
        // sign-in that is about to replace it: Better Auth reads the account
        // first and writes fresh tokens after. Nothing that could be the
        // token is written out, only the row and the key it was sealed under.
        out[field] = null;
        process.stderr.write(
          `auth: the ${field} on account ${String(row.id ?? "?")} could not be ` +
            `opened (sealed under key ${parse(value)?.keyId ?? "?"}), so it ` +
            "is treated as absent. The next sign-in through that provider replaces it.\n",
        );
      }
    }
    return out ?? row;
  };

  const openEach = (result: unknown): unknown =>
    Array.isArray(result) ? result.map(open) : open(result);

  /**
   * Opens what a query returns: account rows themselves, and the accounts
   * joined onto another model's row, which is how Better Auth reads a user
   * with their accounts when somebody signs in by email match.
   */
  const opened = (
    query: { model: string; join?: Record<string, unknown> },
    result: unknown,
  ): unknown => {
    if (query.model === ACCOUNT_MODEL) {
      return openEach(result);
    }
    if (!query.join || !(ACCOUNT_MODEL in query.join)) {
      return result;
    }
    const openJoined = (row: unknown): unknown =>
      isRow(row) && ACCOUNT_MODEL in row
        ? { ...row, [ACCOUNT_MODEL]: openEach(row[ACCOUNT_MODEL]) }
        : row;
    return Array.isArray(result) ? result.map(openJoined) : openJoined(result);
  };

  const isAccount = (query: { model: string }) => query.model === ACCOUNT_MODEL;

  const wrapped: AdapterLike = {
    ...adapter,

    create: async (query) =>
      opened(
        query,
        await adapter.create(
          isAccount(query) ? { ...query, data: seal(query.data) } : query,
        ),
      ),
    update: async (query) =>
      opened(
        query,
        await adapter.update(
          isAccount(query) ? { ...query, update: seal(query.update) } : query,
        ),
      ),
    updateMany: (query) =>
      adapter.updateMany(
        isAccount(query) ? { ...query, update: seal(query.update) } : query,
      ),
    findOne: async (query) => opened(query, await adapter.findOne(query)),
    findMany: async (query) => opened(query, await adapter.findMany(query)),

    // Better Auth creates a user and their first account inside one
    // transaction, and the handle it passes the callback comes from the
    // adapter underneath. Left alone it is a way into the table that stores
    // tokens as issued, so it is wrapped in turn.
    ...(typeof adapter.transaction === "function"
      ? {
          transaction: ((callback) =>
            (adapter.transaction as TransactionFn)((trx) =>
              callback(withSealedAccountTokens(trx, ring)),
            )) satisfies TransactionFn,
        }
      : {}),
  };

  return wrapped as T;
}

/**
 * A ring for an auth instance that was given none.
 *
 * Only the web process signs anybody in through a provider, and it passes the
 * instance's own ring, which rotation covers. A command or a test that builds
 * an auth instance for something else gets this: tokens are still never
 * stored as issued, and one sealed here reads as absent after the process
 * ends, which the next sign-in through that provider replaces.
 */
export function processOnlyKeyRing(): () => KeyRing {
  let ring: KeyRing | undefined;
  return () => {
    ring ??= parseKeyRing({ current: newRootKey() });
    return ring;
  };
}
