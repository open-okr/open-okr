#!/usr/bin/env node
/**
 * `pnpm audit:chain`: gives every recorded audit row its position in the
 * chain (P7-T02a).
 *
 * The write path records the row and stops there, so this is what makes the
 * trail verifiable. The scheduler runs it on a short cadence; this command is
 * for an operator who wants it now, for an instance running with
 * `OPENOKR_SCHEDULER=off`, and for the moment after an upgrade when a backlog
 * has built up.
 *
 * Names workspaces as arguments, or chains every one. Enumerating them needs
 * a role that can see past the tenant floor, which is the same bar
 * `pnpm audit:verify` sets and for the same reason: a pass that could see no
 * workspaces would report success having done nothing.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { chainAllWorkspaces, chainWorkspace } from "../audit/chainer.ts";
import { canEnumerateWorkspaces } from "../audit/verify.ts";

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const named = process.argv.slice(2).filter((one) => !one.startsWith("--"));
const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

try {
  if (named.length === 0 && !(await canEnumerateWorkspaces(pool))) {
    process.stderr.write(
      "This database role cannot list workspaces: the tenant floor hides them, " +
        "and forced row-level security applies to the table owner too. " +
        "Connect as a maintenance role with BYPASSRLS, or name the workspaces to chain.\n",
    );
    await pool.end();
    process.exit(1);
  }

  const reports =
    named.length === 0
      ? await chainAllWorkspaces(pool)
      : await Promise.all(named.map((id) => chainWorkspace(pool, id)));

  let chained = 0;
  let pending = 0;
  for (const report of reports) {
    chained += report.chained;
    pending += report.pending;
    if (report.chained > 0 || report.pending > 0) {
      write(
        `  ${report.workspaceId}  ${report.chained} chained, ${report.pending} still pending`,
      );
    }
  }
  write(
    `${chained} row(s) chained across ${reports.length} workspace(s), ${pending} pending.`,
  );
  await pool.end();
  // Pending after a full pass means rows arrived while it ran, which is
  // normal on a busy instance and not a failure.
  process.exit(0);
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  await pool.end();
  process.exit(1);
}
