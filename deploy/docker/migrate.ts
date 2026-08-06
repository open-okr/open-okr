#!/usr/bin/env node
/**
 * Migrations on boot, for the container (P1-T09).
 *
 * Separate from `pnpm db:migrate` because the container's job is larger: it
 * also re-applies the privilege model. A migration that adds a table leaves the
 * application role holding whatever the default privileges gave it, and the
 * append-only exception on `audit_events` has to be re-stated afterwards or an
 * upgrade quietly re-opens what a migration closed.
 *
 * `runMigrations` takes a Postgres advisory lock, so several replicas starting
 * at once is safe: one migrates, the rest wait and then find nothing to do.
 */
import { join } from "node:path";
import pg from "pg";
// Imported by path rather than by package name. pnpm links workspace packages
// with symlinks into a store that does not survive a Docker COPY, so
// `@openokr/db` does not resolve inside the image. These two modules import
// nothing but Node built-ins, so a path import needs no workspace linking at
// all, and the migration runner stays the same code the tests exercise.
import { grantAppPrivileges } from "../../packages/db/src/grants.ts";
import { runMigrations } from "../../packages/db/src/migrate.ts";

const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("openokr: DATABASE_URL is not set.\n");
  process.exit(1);
}

/**
 * The role the application connects as. Only granted when an admin connection
 * is in use: with a single role, the role already owns everything and there is
 * nothing to grant.
 */
const appRole = process.env.OPENOKR_APP_ROLE ?? "";

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  const applied = await runMigrations(client, {
    dirs: [join(import.meta.dirname, "../../packages/db/migrations")],
  });

  process.stdout.write(
    applied.length === 0
      ? "openokr: schema is up to date.\n"
      : `openokr: applied ${applied.length} migration(s): ${applied.join(", ")}\n`,
  );

  if (appRole !== "" && process.env.DATABASE_ADMIN_URL) {
    await grantAppPrivileges(client, { appRole });
    process.stdout.write(`openokr: privileges applied for ${appRole}.\n`);
  }
} finally {
  await client.end();
}
