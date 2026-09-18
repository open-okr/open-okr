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
  const env = loadEnv();
  globals.openokrPool ??= new Pool({
    connectionString: env.DATABASE_URL,
    // **A ceiling, because there was none** (P8-T06b). Without `max`, `pg`
    // uses its own default of ten, which is a number a library chose rather
    // than a number this product measured. P7-T02 held every §13.1 budget at
    // twenty concurrent members with a pool of twenty and put the drag on
    // the line at twenty-five, so twenty is the measurement.
    //
    // It is a ceiling rather than a limit: the per-tenant concurrency cap
    // (P8-T06a) sits below it, so one workspace cannot hold every slot, and
    // this stops the process as a whole from asking the database for more
    // connections than it agreed to serve.
    max: env.OPENOKR_DB_POOL_MAX,
  });
  return globals.openokrPool;
}
