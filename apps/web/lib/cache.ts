/**
 * The process-wide cache, used for rate limiting (P5-T02a).
 *
 * Postgres-backed, because Postgres is the only service this product requires.
 * The rate limit an inbound channel request is checked against has to be shared
 * across replicas, so an in-process counter would give each replica its own
 * allowance and the limit would be the limit times the replica count.
 *
 * Cached on `globalThis` for the same reason the pool is: Next.js reloads
 * modules in development.
 */
import { type Cache, PostgresCache } from "@openokr/adapters";
import { getPool } from "./pool";

const globals = globalThis as typeof globalThis & {
  openokrCache?: Cache;
};

export function getCache(): Cache {
  const existing = globals.openokrCache;
  if (existing) {
    return existing;
  }
  const built = new PostgresCache(getPool());
  globals.openokrCache = built;
  return built;
}
