#!/usr/bin/env node
/**
 * `pnpm cloud:usage`: refreshes the per-tenant usage snapshot (P8-T03b).
 *
 * The operator console reads a snapshot rather than counting live, because
 * `force row level security` applies to the table owner too and no view or
 * security-definer function can count a content table. See
 * `packages/core/src/operator/usage.ts` for the whole argument.
 *
 * Each workspace is opened properly through its own tenant setting and
 * counted the way a member of it would count, so no policy is loosened and no
 * role is privileged to make this work.
 *
 * The same shape as `pnpm audit:chain` and `pnpm cadence:sweep`: a command for
 * an operator who wants the numbers now, and for an instance running with
 * `OPENOKR_SCHEDULER=off`.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { measureAllWorkspaces } from "../operator/index.ts";

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

try {
  const started = Date.now();
  const result = await measureAllWorkspaces(pool);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(
    `Measured ${result.measured} workspace(s) in ${seconds}s.\n`,
  );
  if (result.measured === 0) {
    // Said out loud. Zero workspaces and a connection that cannot see them
    // look identical in a log, and the second is what happened the first time
    // this ran.
    process.stdout.write(
      "No workspace was found. On an instance that has some, check the " +
        "database role can read `workspaces` under instance administration.\n",
    );
  }
} finally {
  await pool.end();
}
