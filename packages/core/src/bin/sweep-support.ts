#!/usr/bin/env node
/**
 * `pnpm cloud:support-sweep`: ends every support session past its expiry
 * (docs/design/support-access.md §5, plan 0.7.0 B2).
 *
 * The scheduler host runs the same sweep every five minutes. This is for an
 * operator who wants it now, and for an instance running with
 * `OPENOKR_SCHEDULER=off`, the same shape as `pnpm cloud:usage` and
 * `pnpm audit:chain`.
 *
 * Access is refused at expiry whether or not this runs, because
 * `resolveActor` checks the expiry on every action. What the sweep does is
 * stamp `ended_at`, suspend the operator's member row and write the audit
 * row, so the owner's screen stops saying somebody is inside.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { sweepExpiredSessions } from "../operator/index.ts";

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

try {
  const { ended, failed } = await sweepExpiredSessions(pool);
  process.stdout.write(
    ended === 0 && failed === 0
      ? "No support session was past its expiry.\n"
      : `Ended ${ended} expired support session(s).\n`,
  );
  if (failed > 0) {
    process.stdout.write(
      `Could not end ${failed}. Access is refused at expiry regardless; a frozen workspace refuses the end until 0.7.0's support design lands.\n`,
    );
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
