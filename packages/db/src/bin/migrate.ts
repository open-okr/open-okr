#!/usr/bin/env node
/**
 * `pnpm db:migrate`: applies pending migrations, forward-only.
 *
 * Connects with DATABASE_ADMIN_URL when set — the owner role, which owns the
 * tables — and falls back to DATABASE_URL for setups that run everything as
 * one role, such as local development against the compose stack.
 *
 * A migration that names a data change it needs gets it run first, through
 * the data-change runner, and the log says so (plan 0.8.0 C1).
 */
import { join } from "node:path";
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { registeredDataChanges } from "../data-changes/registry.ts";
import { runMigrations } from "../migrate.ts";

const env = loadEnv();
const url = env.DATABASE_ADMIN_URL ?? env.DATABASE_URL;

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const applied = await runMigrations(client, {
    dirs: [join(import.meta.dirname, "../../migrations")],
    dataChanges: registeredDataChanges(process.env.OPENOKR_ENCRYPTION_KEY),
    log: (line) => process.stdout.write(`${line}\n`),
  });
  process.stdout.write(
    applied.length === 0
      ? "Nothing to apply. The database is up to date.\n"
      : `Applied ${applied.length} migration(s):\n${applied.map((name) => `  ${name}`).join("\n")}\n`,
  );
} finally {
  await client.end();
}
