#!/usr/bin/env node
/**
 * `pnpm alignment:fill`: stores the alignment scores no structural write has
 * stored yet (design `alignment-engine.md` §10, plan 0.7.0 D2).
 *
 * After an upgrade to 0.7, every cycle planned before it has no stored score
 * until somebody changes its structure. `alignment.score` computes such a
 * cycle on read, so nothing on screen is wrong meanwhile; this stores it, so
 * the Work Map reads one row. The scheduler runs the same fill hourly.
 *
 * The same shape as `pnpm cloud:usage` and `pnpm audit:chain`: a command for
 * an operator who wants it now, and for an instance running with
 * `OPENOKR_SCHEDULER=off`. A second run stores nothing.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { fillAlignmentScores } from "../alignment/fill.ts";

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

try {
  const started = Date.now();
  const result = await fillAlignmentScores(pool);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(
    `Stored ${result.filled} alignment score(s) across ${result.workspaces} workspace(s) in ${seconds}s.\n`,
  );
} finally {
  await pool.end();
}
