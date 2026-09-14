#!/usr/bin/env node
/**
 * `pnpm cloud:sweep`: lists the closed workspaces whose retention window has
 * passed (P8-T02c).
 *
 * **It deletes nothing, and it is not a dry run of something that does.** The
 * erasure itself is a data-change script and does not exist yet, deliberately:
 * `cloud.closureRetentionDays` is zero on every instance until an operator
 * sets it, and nothing can set it until the operator console lands at P8-T03.
 * Writing an untriggerable destructive path now, months before anybody can
 * reach it, is how a delete gets shipped without ever being exercised.
 *
 * So this is the reporting half, and it is useful on its own: an operator
 * running it sees whether retention is on, what number it is running, and
 * exactly which workspaces a future erasure would name.
 *
 * The same shape as `pnpm audit:chain` and `pnpm cadence:sweep`: a command for
 * an operator who wants the answer now.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { sweepClosedTenants } from "../tenancy/index.ts";

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

try {
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
        "Nothing was deleted. Erasure is a data-change script and arrives with P8-T03.",
      );
    }
  }
} finally {
  await pool.end();
}
