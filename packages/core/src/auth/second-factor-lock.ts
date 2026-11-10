/**
 * Noticing the moment Better Auth locks a second factor
 * (docs/design/account-lockout.md D9 and D13, plan 0.7.0 P10b).
 *
 * Better Auth counts wrong codes per account and, at the tenth in a row, sets
 * `locked_until` on the account's `two_factors` row. It does that in one
 * adapter call of its own and tells nobody: no hook and no plugin callback
 * sees it. The adapter is the one place every write passes, so this wraps it,
 * as session hashing and token sealing already do.
 *
 * The lock is the only `incrementOne` on that model that sets a `lockedUntil`
 * date; the lazy unlock sets it to null. Two wrong codes landing at the same
 * moment can both set it, which writes a second row; that is rare and bounded,
 * because only somebody who knows the password reaches a second factor.
 */
import type { AdapterLike, TransactionFn } from "./session-hashing.ts";

const TWO_FACTOR_MODEL = "twoFactor";

// biome-ignore lint/suspicious/noExplicitAny: Better Auth's adapter methods take loosely typed queries, as session-hashing.ts notes.
type IncrementOne = (query: any) => Promise<any>;

export function withSecondFactorLockAudit<T extends AdapterLike>(
  adapter: T,
  onLock: (userId: string) => Promise<void>,
): T {
  const incrementOne = adapter.incrementOne as IncrementOne | undefined;
  if (typeof incrementOne !== "function") {
    return adapter;
  }
  const wrapped: AdapterLike = {
    ...adapter,
    async incrementOne(query: {
      model?: unknown;
      set?: { lockedUntil?: unknown };
    }) {
      const result = (await incrementOne(query)) as {
        userId?: unknown;
      } | null;
      if (
        query.model === TWO_FACTOR_MODEL &&
        query.set?.lockedUntil instanceof Date &&
        result &&
        typeof result.userId === "string"
      ) {
        // The lock stands either way; a failed audit write never undoes it.
        await onLock(result.userId).catch(() => undefined);
      }
      return result;
    },
    ...(typeof adapter.transaction === "function"
      ? {
          transaction: ((callback) =>
            (adapter.transaction as TransactionFn)((trx) =>
              callback(withSecondFactorLockAudit(trx, onLock)),
            )) satisfies TransactionFn,
        }
      : {}),
  };
  return wrapped as T;
}
