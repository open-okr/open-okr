#!/usr/bin/env node
/**
 * `pnpm db:seed`: fills the first workspace with demo content.
 *
 * Meant for a fresh install: register through the setup wizard, then run this,
 * and the instance has an organisation running a real year instead of an
 * empty shell. The story it tells is `docs/scenarios/northwind-year`.
 *
 * Everything is written through the action registry, so a demo goal gets the
 * same access bindings, activity row, audit row and outbox row a real one does.
 * Idempotent: a workspace that already has company objectives is left alone.
 *
 * **It builds the Northwind year** by default: the scenario in
 * `docs/scenarios/northwind-year` placed on the real calendar, with every
 * step dated before today true and nothing after it. **`--quarter` builds the
 * smaller one-quarter demo instead**: a quarter in flight and a quarter
 * finished, relative to today.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { buildDemoWorkspace } from "../demo/builder.ts";
import { buildNorthwindYear } from "../demo/year/build.ts";

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/** Wraps a note to a readable width, indented under a bullet. */
const bullet = (text: string): string => {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length + word.length + 1 > 74) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  lines.push(line);
  return lines
    .map((text, index) => (index === 0 ? `  - ${text}` : `    ${text}`))
    .join("\n");
};

try {
  // The first workspace and its founding member. A self-hosted instance has
  // exactly one until somebody creates a second.
  const result = await pool.query<{
    workspace_id: string;
    user_id: string;
    member_id: string;
    name: string;
  }>(
    `select w.id as workspace_id, w.name, wm.user_id, wm.id as member_id
       from workspaces w
       join workspace_members wm on wm.workspace_id = w.id
      where w.deleted_at is null
        and wm.deleted_at is null
        and wm.user_id is not null
      order by w.created_at, wm.created_at
      limit 1`,
  );
  const row = result.rows[0];

  if (!row) {
    process.stderr.write(
      "No workspace found. Open the app and finish the setup wizard first.\n",
    );
    process.exit(1);
  }

  if (!process.argv.includes("--quarter")) {
    write(`Building the Northwind year into "${row.name}".`);
    const year = await buildNorthwindYear({
      pool,
      workspaceId: row.workspace_id,
      adminUserId: row.user_id,
      adminMemberId: row.member_id,
    });
    write("");
    write(
      year.alreadySeeded
        ? "This workspace already has company objectives, so nothing was written."
        : `Done. ${year.events} events of the year written, as of ${year.today}.`,
    );
    write("The story is docs/scenarios/northwind-year/README.md.");
    process.exit(0);
  }

  write(`Seeding demo content into "${row.name}".`);

  const outcome = await buildDemoWorkspace({
    pool,
    workspaceId: row.workspace_id,
    adminUserId: row.user_id,
  });

  if (outcome.alreadySeeded) {
    write("");
    write(
      "This workspace already has company objectives, so nothing was written.",
    );
    write("Seed a fresh install, or remove the existing set first.");
  } else {
    write("");
    write("Done.");
    write(
      `  ${outcome.membersCreated} people, ${outcome.spacesCreated} spaces`,
    );
    write(
      `  ${outcome.goalsCreated} objectives with ${outcome.keyResultsCreated} key results`,
    );
    write(`  ${outcome.checkInsPublished} published check-ins`);
    write(
      `  ${outcome.kpisCreated} KPIs with ${outcome.kpiRecordsWritten} monthly readings`,
    );
    if (outcome.lastQuarterVerdict) {
      write(
        `  last quarter scored and closed, diagnostic: ${outcome.lastQuarterVerdict}`,
      );
    }
    write("");
    write("Worth knowing before you present it:");
    for (const note of outcome.notes) {
      write(bullet(note));
    }
  }
} finally {
  await pool.end();
}
