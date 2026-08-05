/**
 * Session tokens hashed at rest (TECHNICAL-PLAN §8.2).
 *
 * Better Auth generates a session token, puts it in the browser's cookie and
 * stores it. Stored as issued, that column is a set of live credentials: a
 * database dump, a stray backup or a read-only SQL injection would let
 * someone sign in as anybody. Hashed, the stored value is useless to replay,
 * because the lookup hashes what the browser presents and compares hashes.
 *
 * This wraps the database adapter, which is Better Auth's documented
 * extension point, rather than reaching into its internals:
 *
 *  - writing a session hashes the token, while the row handed back keeps the
 *    raw one, so the cookie the caller sets still works;
 *  - any query whose predicate is `session.token` has that value hashed too.
 *
 * The wrapper must also be idempotent. Better Auth reads a session row back,
 * whose token column now holds the hash, and re-queries with that value;
 * hashing it a second time would match nothing. Telling the two apart is
 * exact rather than a guess: Better Auth's tokens are 32 characters of
 * `[a-zA-Z0-9]` and a SHA-256 hex digest is 64 of `[0-9a-f]`, so no raw token
 * can ever look like a digest.
 */
import { createHash } from "node:crypto";

const SESSION_MODEL = "session";
const TOKEN_FIELD = "token";
const DIGEST = /^[0-9a-f]{64}$/;

/** SHA-256 hex of a session token. Already-hashed values pass through. */
export function hashSessionToken(token: string): string {
  if (DIGEST.test(token)) {
    return token;
  }
  return createHash("sha256").update(token).digest("hex");
}

interface WhereClause {
  field: string;
  value: unknown;
  [key: string]: unknown;
}

interface Query {
  model: string;
  where?: WhereClause[];
  [key: string]: unknown;
}

/**
 * A database adapter, structurally.
 *
 * Better Auth's own `DBAdapter` type is generic over its options and its
 * methods are heavily overloaded, so the wrapper describes only the shape it
 * touches. Every method is typed loosely on purpose: this code inspects two
 * fields and forwards everything else untouched, and a precise mirror of the
 * upstream signatures would break on every minor release without catching a
 * single real mistake. The behaviour is pinned by tests instead.
 */
// biome-ignore lint/suspicious/noExplicitAny: see the note above.
type AdapterMethod = (query: any) => Promise<any>;

interface AdapterLike {
  create: AdapterMethod;
  findOne: AdapterMethod;
  findMany: AdapterMethod;
  update: AdapterMethod;
  updateMany: AdapterMethod;
  delete: AdapterMethod;
  deleteMany: AdapterMethod;
  count: AdapterMethod;
  /** Present on adapters that support transactions. Better Auth creates
   * sessions inside one, so this handle must be wrapped too. */
  transaction?: unknown;
  [key: string]: unknown;
}

type TransactionFn = (
  callback: (trx: AdapterLike) => Promise<unknown>,
) => Promise<unknown>;

const isSession = (model: string): boolean => model === SESSION_MODEL;

/** Hashes a `token` predicate on the session model, leaving all else alone. */
const hashWhere = (query: Query): Query => {
  if (!isSession(query.model) || !query.where) {
    return query;
  }
  return {
    ...query,
    where: query.where.map((clause) =>
      clause.field === TOKEN_FIELD && typeof clause.value === "string"
        ? { ...clause, value: hashSessionToken(clause.value) }
        : clause,
    ),
  };
};

/**
 * Wraps an adapter so session tokens are stored and queried as hashes.
 * Every other model and field passes through untouched.
 */
export function withHashedSessionTokens<T extends AdapterLike>(adapter: T): T {
  const wrapped: AdapterLike = {
    ...adapter,

    async create(query) {
      if (!isSession(query.model) || typeof query.data.token !== "string") {
        return adapter.create(query);
      }
      const rawToken = query.data.token;
      const created = (await adapter.create({
        ...query,
        data: { ...query.data, token: hashSessionToken(rawToken) },
      })) as Record<string, unknown> | null;

      // The caller sets a cookie from this row, so it must carry the token
      // the browser will present, not the digest we stored.
      return created && typeof created === "object"
        ? { ...created, token: rawToken }
        : created;
    },

    findOne: (query) => adapter.findOne(hashWhere(query)),
    findMany: (query) => adapter.findMany(hashWhere(query)),
    update: (query) => adapter.update(hashWhere(query)),
    updateMany: (query) => adapter.updateMany(hashWhere(query)),
    delete: (query) => adapter.delete(hashWhere(query)),
    deleteMany: (query) => adapter.deleteMany(hashWhere(query)),
    count: (query) => adapter.count(hashWhere(query)),

    // Better Auth writes sessions inside a transaction, and the handle it
    // passes the callback comes from the adapter underneath. Left alone it
    // is an unhashed way into the same table, so it is wrapped in turn.
    ...(typeof adapter.transaction === "function"
      ? {
          transaction: ((callback) =>
            (adapter.transaction as TransactionFn)((trx) =>
              callback(withHashedSessionTokens(trx)),
            )) satisfies TransactionFn,
        }
      : {}),
  };

  return wrapped as T;
}
