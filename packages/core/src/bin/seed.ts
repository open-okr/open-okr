#!/usr/bin/env node
/**
 * `pnpm db:seed`: seeds demo data into the first workspace (P3-T17).
 *
 * Runs through the action system so every write gets its access bindings,
 * activity row, audit row and outbox row. Uses a system actor so no
 * notifications are dispatched.
 *
 * Idempotent: if the workspace already has goals, reports that and exits.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { buildDemoWorkspace } from "../demo/builder.ts";

const env = loadEnv();
const url = env.DATABASE_URL;

const pool = new pg.Pool({ connectionString: url });

try {
  // Find the first workspace and its admin (the founding member)
  const result = await pool.query(
    `select w.id as workspace_id, wm.user_id
     from workspaces w
     join workspace_members wm on wm.workspace_id = w.id
     where w.deleted_at is null and wm.deleted_at is null
     order by w.created_at, wm.created_at
     limit 1`,
  );
  const row = result.rows[0] as
    | { workspace_id: string; user_id: string }
    | undefined;

  if (!row) {
    console.error("No workspace found. Run the setup wizard first.");
    process.exit(1);
  }

  console.log(`Seeding demo data into workspace ${row.workspace_id}...`);

  const outcome = await buildDemoWorkspace({
    pool,
    workspaceId: row.workspace_id,
    adminUserId: row.user_id,
  });

  if (outcome.alreadySeeded) {
    console.log("Demo data already exists. Nothing to do.");
  } else {
    console.log(
      `Done. Created ${outcome.spacesCreated} spaces, ${outcome.goalsCreated} goals, ${outcome.kpisCreated} KPIs.`,
    );
  }
} finally {
  await pool.end();
}
