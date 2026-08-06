import { loadEnv } from "@openokr/config";
import { createAuth } from "@openokr/core";
import { Pool } from "pg";

/**
 * The process-wide authentication instance.
 *
 * The configuration lives in `packages/core` because it needs the database,
 * which TECHNICAL-PLAN §1 does not allow this app to reach directly. Here we
 * only supply the environment and hold the pool.
 *
 * Built on first use rather than on import, so that loading a page module
 * does not open a database connection as a side effect. The environment is
 * still validated at boot, by `instrumentation.node.ts`, so a bad
 * configuration fails immediately rather than at the first sign-in.
 *
 * Next.js reloads modules in development, so both the pool and the instance
 * are cached on `globalThis`. Without that, every reload would open another
 * pool and eventually exhaust the database's connection limit.
 */
const globals = globalThis as typeof globalThis & {
  openokrPool?: Pool;
  openokrAuth?: ReturnType<typeof createAuth>;
};

export function getPool(): Pool {
  globals.openokrPool ??= new Pool({
    connectionString: loadEnv().DATABASE_URL,
  });
  return globals.openokrPool;
}

export function getAuth(): ReturnType<typeof createAuth> {
  if (!globals.openokrAuth) {
    const env = loadEnv();
    globals.openokrAuth = createAuth({
      pool: getPool(),
      secret: env.BETTER_AUTH_SECRET,
      baseUrl: env.BETTER_AUTH_URL,
    });
  }
  return globals.openokrAuth;
}
