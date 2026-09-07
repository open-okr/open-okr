import { loadEnv } from "@openokr/config";
import { Pool } from "pg";

/**
 * The process-wide database pool.
 *
 * **Separate from `lib/auth.ts`, which is where it used to live.** A pool has
 * nothing to do with authentication, and while everything that needed one was a
 * request handler that also needed a session, nobody noticed. The relay host
 * (P5-T01a) is the first process that needs a pool and no session, and importing
 * `lib/auth.ts` for it would drag Better Auth and its Next.js cookie plugin into
 * a plain Node process that never serves a request.
 *
 * Built on first use rather than on import, so that loading a page module does
 * not open a database connection as a side effect. The environment is still
 * validated at boot, by `instrumentation.node.ts`, so a bad configuration fails
 * immediately rather than at the first query.
 *
 * Next.js reloads modules in development, so the pool is cached on
 * `globalThis`. Without that, every reload would open another pool and
 * eventually exhaust the database's connection limit.
 */
const globals = globalThis as typeof globalThis & {
  openokrPool?: Pool;
};

export function getPool(): Pool {
  globals.openokrPool ??= new Pool({
    connectionString: loadEnv().DATABASE_URL,
  });
  return globals.openokrPool;
}
