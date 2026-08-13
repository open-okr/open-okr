/**
 * The staleness sweep, as a command (P3-T06).
 *
 * A goal is `outdated` once its grace window passes, and nothing writes to a
 * neglected goal by definition, so the flip cannot wait for the next write. This
 * is the job that does it. Until a scheduler host exists it runs from cron or by
 * hand, which is the same shape `pnpm audit:verify` already has.
 *
 * Every workspace, or named ones. Idempotent: a second run over the same rows
 * changes nothing, because they already read `outdated`.
 *
 * It goes through the Operation pipeline per workspace, so the health change is
 * audited like any other write rather than appearing from nowhere.
 */
import { loadEnv } from "@openokr/config";
import { activeOnly, workspaces } from "@openokr/db";
import { isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sweepStaleness } from "../cadence/service.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow } from "../cycles/service.ts";
import { runOperation } from "../operations/operation.ts";

async function main(): Promise<void> {
  const named = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const now = new Date();

  try {
    const db = drizzle(pool);
    const rows = await db
      .select({ id: workspaces.id, slug: workspaces.slug })
      // openokr:allow-raw-read: a maintenance command has no acting member, so
      // there is no getter to go through. Enumerating tenants is the one thing it
      // must do before it can scope anything, the same shape `pnpm audit:verify`
      // already uses.
      .from(workspaces)
      .where(activeOnly(workspaces, isNull(workspaces.deletedAt)));

    const targets =
      named.length === 0
        ? rows
        : rows.filter(
            (row) => named.includes(row.slug) || named.includes(row.id),
          );

    if (targets.length === 0) {
      console.error(
        named.length === 0
          ? "No workspaces to sweep."
          : `No workspace matched: ${named.join(", ")}`,
      );
      process.exitCode = 1;
      return;
    }

    let flipped = 0;
    for (const workspace of targets) {
      const result = await runOperation(
        { pool },
        {
          action: "cadence.sweepStaleness",
          workspaceId: workspace.id,
          actor: { kind: "system" },
          async execute({ tx, workspaceId }) {
            const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
            const swept = await sweepStaleness(
              tx,
              workspaceId,
              rhythm.thresholds,
              now,
            );
            return {
              result: swept,
              activity: {
                kind: "cadence.staleness_swept",
                subjectType: "workspace",
                subjectId: workspaceId,
                payload: { examined: swept.examined, flipped: swept.flipped },
              },
              audit: {
                action: "cadence.sweepStaleness",
                targetType: "workspace",
                targetId: workspaceId,
                payload: { examined: swept.examined, flipped: swept.flipped },
              },
            };
          },
        },
      );
      flipped += result.flipped;
      console.log(
        `${workspace.slug}: examined ${result.examined}, flipped ${result.flipped}`,
      );
    }

    console.log(
      `Swept ${targets.length} workspace(s). ${flipped} goal(s) now read outdated.`,
    );
  } finally {
    await pool.end();
  }
}

await main();
