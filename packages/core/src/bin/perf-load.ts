#!/usr/bin/env node
/**
 * `pnpm perf:load`: the load and soak run (P7-T02).
 *
 * Hundreds of virtual members using one workspace at once, against the dataset
 * `pnpm db:seed:large` builds. Reads and writes both, weighted like a working
 * day rather than evenly, because a profile that wrote as often as it read
 * would measure a product nobody uses.
 *
 * `--soak` is the same run held for longer and judged on drift instead of the
 * absolute number: a second half materially slower than the first is leaking
 * something, and that is what a soak is for.
 *
 * Exits 1 on any error, on a p95 over `--budget`, or on drift past 1.5.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { type LoadActor, type LoadWorld, runLoad } from "../perf/load.ts";

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const slug = flag("workspace");
if (!slug) {
  process.stderr.write(
    [
      "Usage: pnpm perf:load --workspace <slug> [options]",
      "",
      "  --members <n>   Virtual members acting at once (default 200).",
      "  --seconds <n>   How long to run (default 60, or 900 with --soak).",
      "  --think <ms>    Pause between one member's actions (default 250).",
      "  --budget <ms>   The p95 every scenario must stay inside (default 500).",
      "  --pool <n>      Database connections the run may hold (default 20).",
      "  --soak          A long hold, judged on drift rather than the number.",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

const soak = has("soak");
const members = Number(flag("members") ?? "200");
const seconds = Number(flag("seconds") ?? (soak ? "900" : "60"));
const thinkMs = Number(flag("think") ?? "250");
const budgetMs = Number(flag("budget") ?? "500");
for (const [name, value] of [
  ["members", members],
  ["seconds", seconds],
  ["think", thinkMs],
  ["budget", budgetMs],
] as const) {
  if (!Number.isFinite(value) || value < 0) {
    process.stderr.write(`--${name} takes a number.\n`);
    process.exit(2);
  }
}

const env = loadEnv();
// **The pool size is a flag because it turned out to be the answer**
// (P7-T02). With the audit lock gone from the write path, every scenario
// settled into the same 2 to 5 second band at fifty members, which is the
// shape of a queue for connections rather than of any one slow query. A
// number nobody can change is a number nobody can test.
const poolMax = Number(flag("pool") ?? "20");
if (!Number.isInteger(poolMax) || poolMax < 1) {
  process.stderr.write("--pool takes a positive whole number.\n");
  process.exit(2);
}
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: poolMax,
});

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

// The spaces each member can edit in, resolved through the `space_standard`
// group they belong to. A drag needs edit, so a run that ignored this would
// ask people to move cards in teams they are not on and report the refusals
// as product errors.
const actors: LoadActor[] = (
  await pool.query<{ id: string; user_id: string; space_ids: string[] }>(
    `select m.id, m.user_id,
            coalesce(array_agg(g.space_id) filter (where g.space_id is not null), '{}') as space_ids
       from workspace_members m
       left join access_group_memberships gm
         on gm.member_id = m.id and gm.deleted_at is null
       left join access_groups g
         on g.id = gm.group_id and g.kind = 'space_standard' and g.deleted_at is null
      where m.workspace_id = $1 and m.kind = 'human' and m.status = 'active'
        and m.user_id is not null and m.deleted_at is null
      group by m.id, m.user_id, m.created_at
      order by m.created_at limit $2`,
    [workspace.id, members],
  )
).rows.map((row) => ({
  memberId: row.id,
  userId: row.user_id,
  spaceIds: row.space_ids,
}));

if (actors.length === 0) {
  process.stderr.write(
    "That workspace has no human members with user accounts, so there is nobody to act as. Seed it with `pnpm db:seed:large`.\n",
  );
  await pool.end();
  process.exit(1);
}

const spaceIds = (
  await pool.query<{ id: string }>(
    "select id from spaces where workspace_id = $1 and deleted_at is null order by created_at",
    [workspace.id],
  )
).rows.map((row) => row.id);

// A pool of cards per space. Bounded, because the run only needs something
// to drag, not every task in the workspace.
const tasksBySpace = new Map<string, string[]>();
for (const spaceId of spaceIds) {
  const rows = await pool.query<{ id: string }>(
    "select id from tasks where workspace_id = $1 and space_id = $2 and deleted_at is null order by created_at desc limit 200",
    [workspace.id, spaceId],
  );
  tasksBySpace.set(
    spaceId,
    rows.rows.map((row) => row.id),
  );
}

// The same, for goals, which the check-in burst publishes against.
const goalsBySpace = new Map<string, string[]>();
for (const spaceId of spaceIds) {
  const rows = await pool.query<{ id: string }>(
    "select id from goals where workspace_id = $1 and space_id = $2 and deleted_at is null order by created_at desc limit 200",
    [workspace.id, spaceId],
  );
  goalsBySpace.set(
    spaceId,
    rows.rows.map((row) => row.id),
  );
}

const cycleId = (
  await pool.query<{ id: string }>(
    "select id from cycles where workspace_id = $1 and deleted_at is null order by starts_on desc limit 1",
    [workspace.id],
  )
).rows[0]?.id;

if (spaceIds.length === 0 || !cycleId) {
  process.stderr.write("That workspace has no space or no cycle to act on.\n");
  await pool.end();
  process.exit(1);
}

const world: LoadWorld = {
  pool,
  workspaceId: workspace.id,
  actors,
  spaceIds,
  tasksBySpace,
  goalsBySpace,
  cycleId,
};

write(
  `${soak ? "Soaking" : "Loading"} "${workspace.name}": ${actors.length} members, ${seconds}s, ${thinkMs}ms think, ${poolMax} connections.`,
);
write("");

const result = await runLoad({
  world,
  concurrency: actors.length,
  seconds,
  thinkMs,
  onTick: (elapsed, calls, errors) => {
    write(
      `  ${String(elapsed).padStart(4)}s  ${calls} calls, ${errors} errors`,
    );
  },
});

write("");
write("  scenario         calls  errors      p50      p95      p99");
let failed = 0;
for (const scenario of result.scenarios) {
  // The scenario's own §13.1 ceiling, unless the caller overrode it.
  const ceiling = flag("budget") ? budgetMs : scenario.budgetMs;
  const over = scenario.p95 > ceiling;
  if (over || scenario.errors > 0) {
    failed += 1;
  }
  write(
    `  ${over || scenario.errors > 0 ? "✗" : "✓"} ${scenario.name.padEnd(14)} ${String(scenario.calls).padStart(5)} ${String(scenario.errors).padStart(7)} ${`${scenario.p50}ms`.padStart(8)} ${`${scenario.p95}ms`.padStart(8)} ${`${scenario.p99}ms`.padStart(8)}`,
  );
  if (scenario.firstError) {
    write(`      first failure: ${scenario.firstError.slice(0, 160)}`);
  }
}

write("");
write(
  `${result.calls} calls in ${result.seconds.toFixed(1)}s, ${result.errors} errors, ${(result.calls / result.seconds).toFixed(1)}/s.`,
);
// The drift line is the soak's whole point, so it is printed either way: a
// short run that already drifts is worth knowing about before the long one.
const DRIFT_CEILING = 1.5;
const drifted = result.drift > DRIFT_CEILING;
write(
  `p95 drift, second half against first: ${result.drift.toFixed(2)}x${drifted ? ` (over ${DRIFT_CEILING}x)` : ""}.`,
);

await pool.end();
process.exit(failed === 0 && !drifted ? 0 : 1);
