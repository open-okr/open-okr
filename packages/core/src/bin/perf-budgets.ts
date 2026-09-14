#!/usr/bin/env node
/**
 * `pnpm perf:budgets`: measures TECHNICAL-PLAN §13.1 against a workspace
 * (P7-T01b).
 *
 * A command rather than a unit test, because the dataset it is meant to run
 * against takes ninety seconds to build and §13.1 is explicit that the budgets
 * are measured on it. Build it with `pnpm db:seed:large`, run `ANALYZE`, then
 * run this. Exits 1 if any measured row is over its ceiling, so a continuous
 * integration job is `pnpm db:seed:large && pnpm perf:budgets`.
 *
 * Rows §13.1 lists that this cannot time are printed too, naming the task that
 * owns them. A table that showed only the rows it could measure would report
 * green while saying nothing about a browser paint or a channel delivery.
 */
import { loadEnv } from "@openokr/config";
import { evaluateObjective, resolveThresholds } from "@openokr/method";
import pg from "pg";
import { callAction } from "../actions/registry.ts";
import { BUDGETS, type Budget, statisticOf } from "../perf/budgets.ts";

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const slug = flag("workspace");
if (!slug) {
  process.stderr.write(
    "Usage: pnpm perf:budgets --workspace <slug> [--runs <n>]\n",
  );
  process.exit(2);
}
const runs = Number(flag("runs") ?? "20");
if (!Number.isInteger(runs) || runs < 1) {
  process.stderr.write("--runs takes a positive whole number.\n");
  process.exit(2);
}

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

const workspace = (
  await pool.query<{ id: string; name: string }>(
    "select id, name from workspaces where slug = $1 and deleted_at is null",
    [slug],
  )
).rows[0];
if (!workspace) {
  process.stderr.write(`No workspace has the slug "${slug}".\n`);
  await pool.end();
  process.exit(1);
}

/** The member every read is made as: the first human in the workspace. */
const actor = (
  await pool.query<{ user_id: string | null }>(
    "select user_id from workspace_members where workspace_id = $1 and kind = 'human' and user_id is not null and deleted_at is null order by created_at limit 1",
    [workspace.id],
  )
).rows[0];
if (!actor?.user_id) {
  process.stderr.write(
    "That workspace has no human member with a user account, so there is nobody to measure a read as.\n",
  );
  await pool.end();
  process.exit(1);
}

/** Ids the inputs need, read once. */
const sample = {
  goalId: (
    await pool.query<{ id: string }>(
      "select id from goals where workspace_id = $1 and deleted_at is null limit 1",
      [workspace.id],
    )
  ).rows[0]?.id,
  spaceId: (
    await pool.query<{ id: string }>(
      "select id from spaces where workspace_id = $1 and deleted_at is null limit 1",
      [workspace.id],
    )
  ).rows[0]?.id,
  cycleId: (
    await pool.query<{ id: string }>(
      "select id from cycles where workspace_id = $1 and deleted_at is null order by starts_on desc limit 1",
      [workspace.id],
    )
  ).rows[0]?.id,
};

const context = {
  pool,
  workspaceId: workspace.id,
  actor: { kind: "human" as const, userId: actor.user_id },
};

/** Fills the ids a row's input needs, which only exist once a dataset does. */
function inputFor(budget: Budget): Record<string, unknown> {
  const base = { ...(budget.input ?? {}) };
  if (budget.action === "goals.read") {
    return { ...base, id: sample.goalId };
  }
  if (budget.action === "tasks.board") {
    return { ...base, spaceId: sample.spaceId };
  }
  if (budget.action === "alignment.read") {
    return { ...base, cycleId: sample.cycleId };
  }
  return base;
}

/** One timed call, in milliseconds. */
async function once(budget: Budget): Promise<number> {
  const started = performance.now();
  if (budget.action === "method.evaluateDraft") {
    // In process, not through the registry: §13.1's point about this row is
    // that it runs as the user types and never reaches a server.
    evaluateObjective(
      {
        title: "Grow activation among new teams this quarter",
        hasCycle: true,
        hasTimeframe: false,
        championId: sample.goalId ?? null,
        reviewerId: sample.spaceId ?? null,
        objectivesInUnit: 4,
        level: "team",
      },
      resolveThresholds({}),
    );
  } else {
    await callAction(
      context as never,
      budget.action as never,
      inputFor(budget) as never,
    );
  }
  return performance.now() - started;
}

write(`§13.1 budgets against "${workspace.name}", ${runs} runs each.`);
write("");

let failed = 0;
let skipped = 0;

for (const budget of BUDGETS) {
  if (budget.measuredBy !== "here") {
    skipped += 1;
    write(
      `  ~  ${budget.surface.padEnd(46)} ${String(budget.ms).padStart(6)}ms  ${budget.measuredBy}`,
    );
    continue;
  }

  const samples: number[] = [];
  try {
    // One warm-up outside the sample: the first call pays for a connection,
    // a plan and a cold cache, and §13.1 is about the steady state.
    await once(budget);
    for (let run = 0; run < runs; run += 1) {
      samples.push(await once(budget));
    }
  } catch (error) {
    failed += 1;
    write(
      `  ✗  ${budget.surface.padEnd(46)} ${String(budget.ms).padStart(6)}ms  failed: ${(error as Error).message}`,
    );
    continue;
  }

  const measured = statisticOf(samples, budget.statistic);
  const over = measured > budget.ms;
  if (over) {
    failed += 1;
  }
  write(
    `  ${over ? "✗" : "✓"}  ${budget.surface.padEnd(46)} ${String(budget.ms).padStart(6)}ms  ${budget.statistic} ${measured.toFixed(1)}ms`,
  );
}

write("");
write(
  `${BUDGETS.length - skipped} measured, ${skipped} owned by another task, ${failed} over budget.`,
);
await pool.end();
process.exit(failed === 0 ? 0 : 1);
