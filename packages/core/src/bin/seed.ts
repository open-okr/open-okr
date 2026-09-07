#!/usr/bin/env node
/**
 * `pnpm db:seed`: fills the first workspace with demo content (P3-T17).
 *
 * Meant for a fresh install: register through the setup wizard, then run this,
 * and the instance has an organisation running a real quarter instead of an
 * empty shell. The walkthrough that goes with it is
 * `docs/stakeholder/DEMO-SCRIPT.md`.
 *
 * Everything is written through the action registry, so a demo goal gets the
 * same access bindings, activity row, audit row and outbox row a real one does.
 * Idempotent: a workspace that already has company objectives is left alone.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { buildDemoWorkspace } from "../demo/builder.ts";

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
    name: string;
  }>(
    `select w.id as workspace_id, w.name, wm.user_id
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
    write("");
    write("Worth knowing before you present it:");
    for (const note of outcome.notes) {
      write(bullet(note));
    }
    write("");
    write("The walkthrough is docs/stakeholder/DEMO-SCRIPT.md.");
  }
} finally {
  await pool.end();
}
