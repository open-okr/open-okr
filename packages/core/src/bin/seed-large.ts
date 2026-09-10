#!/usr/bin/env node
/**
 * `pnpm db:seed:large`: builds the performance dataset (P7-T01a).
 *
 * TECHNICAL-PLAN §13.1's budgets are all measured "on the large seeded
 * dataset: 100,000 goals and key results plus 1,000,000 tasks in one
 * workspace". This is that dataset. It is not demo content and it is not for
 * a workspace anybody uses: the titles are `Objective 1`, the people are
 * `Member 1`, and the point is the row count and the shape of the tree, not
 * anything a reader would want to look at.
 *
 * Meant for a throwaway database. It refuses a workspace that already holds
 * goals, and it says so rather than adding a second dataset on top of the
 * first.
 *
 * `--workspace <slug>` names the target. `--counts` scales everything down
 * proportionally for a quick check that the command still works, because
 * waiting for a million rows to find out the flag was misspelt is a poor
 * trade.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import {
  buildLargeDataset,
  LARGE_DATASET,
  type LargeDatasetCounts,
} from "../perf/large-dataset.ts";

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/** Exit 2 is a usage error decided here, before anything is sent. */
function usage(problem: string): never {
  process.stderr.write(`${problem}\n\n`);
  process.stderr.write(
    [
      "Usage: pnpm db:seed:large --workspace <slug> [options]",
      "",
      "  --workspace <slug>   The workspace to fill. Required.",
      "  --scale <n>          Multiply every count by n (default 1).",
      "                       --scale 0.001 is a hundred goals, for a smoke test.",
      "  --spread-days <n>    How far back the oldest row is dated (default 365).",
      "  --batch <n>          Rows per statement (default 5000).",
      "",
      `Full size: ${LARGE_DATASET.goals.toLocaleString("en")} goals, ${LARGE_DATASET.keyResults.toLocaleString("en")} key results, ${LARGE_DATASET.tasks.toLocaleString("en")} tasks.`,
    ].join("\n"),
  );
  process.exit(2);
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function scaled(counts: LargeDatasetCounts, scale: number): LargeDatasetCounts {
  const at = (value: number): number => Math.max(Math.round(value * scale), 0);
  return {
    // Spaces and members do not scale below a floor: a workspace with no
    // space cannot hold a goal, and one member cannot be both champion and a
    // different reviewer.
    spaces: Math.max(at(counts.spaces), 1),
    members: Math.max(at(counts.members), 2),
    // At least one quarter to hang a goal on.
    cycles: Math.max(at(counts.cycles), 1),
    goals: at(counts.goals),
    keyResults: at(counts.keyResults),
    initiatives: at(counts.initiatives),
    tasks: at(counts.tasks),
  };
}

const slug = flag("workspace");
if (!slug) {
  usage("Name the workspace to fill with --workspace <slug>.");
}

const scale = Number(flag("scale") ?? "1");
if (!Number.isFinite(scale) || scale <= 0) {
  usage("--scale takes a positive number.");
}
const spreadDays = Number(flag("spread-days") ?? "365");
if (!Number.isInteger(spreadDays) || spreadDays <= 0) {
  usage("--spread-days takes a positive whole number of days.");
}
const batchSize = Number(flag("batch") ?? "5000");
if (!Number.isInteger(batchSize) || batchSize <= 0) {
  usage("--batch takes a positive whole number of rows.");
}

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

const found = await pool.query<{ id: string; name: string }>(
  "select id, name from workspaces where slug = $1 and deleted_at is null",
  [slug],
);
const workspace = found.rows[0];
if (!workspace) {
  process.stderr.write(`No workspace has the slug "${slug}".\n`);
  await pool.end();
  process.exit(1);
}

const counts = scaled(LARGE_DATASET, scale);
write(`Filling "${workspace.name}" with the performance dataset.`);
write("");
for (const [name, value] of Object.entries(counts)) {
  write(`  ${name.padEnd(12)} ${value.toLocaleString("en")}`);
}
write("");

try {
  const report = await buildLargeDataset({
    pool,
    workspaceId: workspace.id,
    counts,
    spreadDays,
    batchSize,
    onProgress: (table, rows, seconds) => {
      const rate = seconds > 0 ? Math.round(rows / seconds) : rows;
      write(
        `  ${table.padEnd(26)} ${rows.toLocaleString("en").padStart(10)} rows in ${seconds.toFixed(1)}s (${rate.toLocaleString("en")}/s)`,
      );
    },
  });
  write("");
  write(`Done in ${report.seconds.toFixed(1)}s.`);
  write("");
  write(
    "Run ANALYZE before measuring anything: the planner has no statistics for rows this fresh, and a plan chosen without them is not the plan production uses.",
  );
  await pool.end();
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  await pool.end();
  process.exit(1);
}
