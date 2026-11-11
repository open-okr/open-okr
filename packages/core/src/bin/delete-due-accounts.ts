#!/usr/bin/env node
/**
 * `pnpm account:delete-due`: deletes the accounts whose fourteen days have
 * passed, and sends the day-before mails (docs/design/account-deletion.md §7,
 * plan 0.8.0 Y7).
 *
 * The scheduler host runs the same pass every hour. This is for an operator
 * who wants it now, and for an instance running with `OPENOKR_SCHEDULER=off`,
 * the same shape as `pnpm cloud:support-sweep`.
 *
 * A workspace whose erasure fails stops that account's run, and the next pass
 * resumes from the ledger, so a second run never erases a workspace twice.
 * Exit 1 when one failed.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { runDueDeletions } from "../auth/account-deletion.ts";

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

try {
  const { reminded, completed, cancelled, failed } =
    await runDueDeletions(pool);
  process.stdout.write(
    reminded + completed + cancelled + failed === 0
      ? "No account deletion was due.\n"
      : `Sent ${reminded} day-before mail(s). Deleted ${completed} account(s). Cancelled ${cancelled} because a refusal now holds.\n`,
  );
  if (failed > 0) {
    process.stdout.write(
      `${failed} account(s) failed partway. The next run resumes each from its ledger.\n`,
    );
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
