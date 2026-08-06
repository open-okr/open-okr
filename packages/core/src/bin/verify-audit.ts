#!/usr/bin/env node
/**
 * `pnpm audit:verify`: checks every workspace's audit chain
 * (TECHNICAL-PLAN §8.2, "with a verification tool").
 *
 * Run it after a restore, before an export, and as part of the Phase 1 exit
 * checklist. Exits non-zero if any chain is broken, so it can gate a pipeline
 * rather than only inform a person reading the output.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import {
  AuditVisibilityError,
  verifyAllChains,
  verifyWorkspaceChain,
} from "../audit/verify.ts";

const env = loadEnv();
// The admin connection when there is one: enumerating tenants needs a role the
// tenant floor does not apply to.
const pool = new pg.Pool({
  connectionString: env.DATABASE_ADMIN_URL ?? env.DATABASE_URL,
});

/** Verify only these workspaces, which any role can do. */
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));

try {
  const results =
    requested.length > 0
      ? await Promise.all(
          requested.map(async (workspaceId) => ({
            workspaceId,
            verdict: await verifyWorkspaceChain(pool, workspaceId),
          })),
        )
      : await verifyAllChains(pool);

  if (results.length === 0) {
    process.stdout.write("No workspaces yet, so no chains to verify.\n");
  }

  let broken = 0;
  for (const { workspaceId, verdict } of results) {
    if (verdict.ok) {
      process.stdout.write(
        `  ok      ${workspaceId}  ${verdict.checked} event(s)\n`,
      );
      continue;
    }
    broken++;
    process.stderr.write(
      `  BROKEN  ${workspaceId}  at sequence ${verdict.brokenAtSeq}: ${verdict.reason}\n`,
    );
  }

  if (broken > 0) {
    process.stderr.write(
      `\n${broken} of ${results.length} chain(s) failed verification. ` +
        `Treat this as evidence of tampering or corruption, not a bug to retry.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `\nAudit verification passed. ${results.length} chain(s) intact.\n`,
  );
} catch (error) {
  if (error instanceof AuditVisibilityError) {
    // Not a broken chain: a tool that cannot see. Saying so beats reporting
    // that nothing is wrong.
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
  throw error;
} finally {
  await pool.end();
}
