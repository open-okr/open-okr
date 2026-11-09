/**
 * The address limiter's count, kept where every process can see it
 * (docs/design/account-lockout.md D10, plan 0.7.0 P10b).
 *
 * Better Auth keeps its count in a `Map` in each process unless it is handed
 * a storage, so two replicas allowed twice the limit. This turns the cache
 * port's own `rateLimit`, which the device login, OAuth registration and the
 * token endpoint already count against, into the one method Better Auth asks
 * for. The web app passes the Postgres cache; Postgres is the only service
 * this product requires.
 *
 * Typed by shape rather than by the port, because `packages/core` does not
 * depend on `packages/adapters`.
 */

/** The part of the cache port this needs. */
export interface LimiterCache {
  rateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ readonly allowed: boolean; readonly resetSeconds: number }>;
}

/** Better Auth's `rateLimit.customStorage`. */
export interface AuthLimiterStorage {
  consume(
    key: string,
    rule: { readonly window: number; readonly max: number },
  ): Promise<{ allowed: boolean; retryAfter: number | null }>;
}

/** The most keys the in-process counter holds, as Better Auth's own does. */
const IN_PROCESS_MAX_KEYS = 100_000;

/**
 * A fixed-window count in this process, for the paths whose count need not be
 * shared: Better Auth's own default, which a custom storage replaces.
 * Bounded, so addresses that never come back cannot grow it without end.
 */
export function inProcessLimiter(): AuthLimiterStorage {
  const counts = new Map<string, { count: number; resetAt: number }>();
  return {
    async consume(key, rule) {
      const now = Date.now();
      if (counts.size >= IN_PROCESS_MAX_KEYS) {
        for (const [stored, entry] of counts) {
          if (entry.resetAt <= now) {
            counts.delete(stored);
          }
        }
        // Still full of live windows: the oldest go first.
        for (const stored of counts.keys()) {
          if (counts.size < IN_PROCESS_MAX_KEYS) {
            break;
          }
          counts.delete(stored);
        }
      }
      const entry = counts.get(key);
      if (!entry || entry.resetAt <= now) {
        counts.set(key, { count: 1, resetAt: now + rule.window * 1000 });
        return { allowed: true, retryAfter: null };
      }
      if (entry.count >= rule.max) {
        return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
        };
      }
      entry.count += 1;
      return { allowed: true, retryAfter: null };
    },
  };
}

/**
 * Sends the named paths to one storage and every other path to another.
 * Better Auth's key is `address|path`, and an address never holds a `|`.
 */
export function routedByPath(
  paths: ReadonlySet<string>,
  shared: AuthLimiterStorage,
  local: AuthLimiterStorage,
): AuthLimiterStorage {
  return {
    consume(key, rule) {
      const path = key.slice(key.lastIndexOf("|") + 1);
      return (paths.has(path) ? shared : local).consume(key, rule);
    },
  };
}

export function authLimiterStorage(cache: LimiterCache): AuthLimiterStorage {
  return {
    async consume(key, rule) {
      // Namespaced, because the same cache counts other doors by address.
      const result = await cache.rateLimit(
        `auth:${key}`,
        rule.max,
        rule.window,
      );
      return result.allowed
        ? { allowed: true, retryAfter: null }
        : { allowed: false, retryAfter: Math.max(1, result.resetSeconds) };
    },
  };
}
