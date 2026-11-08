#!/usr/bin/env node
/**
 * `pnpm cloud:sweep`: lists the closed workspaces whose retention window has
 * passed (P8-T02c), and with `--erased`, the receipt of every erasure
 * (docs/design/workspace-erasure.md §7).
 *
 * **It deletes nothing.** `pnpm cloud:erase` does, as the owner role, on the
 * deployment's schedule. This is the reporting half: whether retention is on,
 * what number it is running, which workspaces are due, and what has gone.
 *
 * The same shape as `pnpm audit:chain` and `pnpm cadence:sweep`: a command for
 * an operator who wants the answer now.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { listErasureReceipts } from "../tenancy/erasure.ts";
import { sweepClosedTenants } from "../tenancy/index.ts";

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

try {
  if (process.argv.includes("--erased")) {
    // The receipts hold no name, no email and no content: an id, a digest of the
    // address, dates and counts. A customer quoting their address is matched by
    // its SHA-256.
    const receipts = await listErasureReceipts(pool);
    if (receipts.length === 0) {
      write("No workspace has been erased on this instance.");
    }
    for (const receipt of receipts) {
      write(`${receipt.at.toISOString()}  ${JSON.stringify(receipt.payload)}`);
    }
    process.exit(0);
  }
  const result = await sweepClosedTenants(pool);

  if (result.reason === "not_a_cloud") {
    write(
      "cloud.enabled is off, so this instance has no tenants and no closures to sweep.",
    );
  } else if (result.reason === "retention_off") {
    // Said out loud rather than reported as "nothing found". A sweep that
    // silently did nothing and a sweep that found nothing look identical in a
    // log, and only one of them is a configuration somebody should know
    // about (P7-T08c's own lesson, applied here).
    write(
      "cloud.closureRetentionDays is 0, which means never erase. " +
        "No row was read. Set a number of days to turn retention on.",
    );
  } else {
    write(`Retention is ${result.retentionDays} days.`);
    if (result.due.length === 0) {
      write("No closed workspace is past its window.");
    } else {
      write(`${result.due.length} closed workspace(s) past the window:`);
      for (const row of result.due) {
        write(`  ${row.workspaceId}  closed ${row.closedAt.toISOString()}`);
      }
      write("");
      write(
        "Nothing was deleted. pnpm cloud:erase --write erases them, as the owner role.",
      );
    }
  }
} finally {
  await pool.end();
}
