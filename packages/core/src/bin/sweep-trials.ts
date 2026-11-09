#!/usr/bin/env node
/**
 * `pnpm cloud:trials`: lists every trial past its date and what ending it
 * would do; `--write` ends them (docs/design/tenant-lifecycle.md §11 T11,
 * plan 0.7.0 P4).
 *
 * The scheduler host runs the same sweep every hour. This is for an operator
 * who wants it now, and for an instance running with `OPENOKR_SCHEDULER=off`.
 * **A dry run unless `--write` is given**, like `pnpm cloud:erase`. Nothing
 * with the cloud flag off.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { dueTrials, sweepTrials } from "../tenancy/index.ts";

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const write = process.argv.includes("--write");

const WORDS = {
  subscribed: "has a live subscription; only the date is cleared",
  moved: "moves to the default plan",
  suspended: "becomes read-only: its people do not fit the default plan",
} as const;

try {
  const due = write ? (await sweepTrials(pool)).due : await dueTrials(pool);
  if (due.length === 0) {
    process.stdout.write("No trial is past its date.\n");
  }
  for (const trial of due) {
    process.stdout.write(
      `${trial.workspaceId}  ended ${trial.trialEndsAt.toISOString().slice(0, 10)}  ${trial.people} people  ${WORDS[trial.outcome]}\n`,
    );
  }
  if (!write && due.length > 0) {
    process.stdout.write("Dry run. Run with --write to end them.\n");
  }
} finally {
  await pool.end();
}
