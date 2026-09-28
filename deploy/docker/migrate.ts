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
// `@openokr/db` does not resolve inside the image. These modules import
// nothing but Node built-ins and each other, so a path import needs no
// workspace linking at all, and the migration runner stays the same code the
// tests exercise.
import { grantAppPrivileges } from "../../packages/db/src/grants.ts";
import { runMigrations } from "../../packages/db/src/migrate.ts";
import { ensureLoginRole } from "../../packages/db/src/roles.ts";

const adminUrl = process.env.DATABASE_ADMIN_URL;
const url = adminUrl ?? process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("openokr: DATABASE_URL is not set.\n");
  process.exit(1);
}

/**
 * The role the application connects as. Only created and granted when an
 * admin connection is in use: with a single role, the role already owns
 * everything and there is nothing to grant.
 */
const appRole = process.env.OPENOKR_APP_ROLE ?? "";

/**
 * The application role's password, read from the URL the application itself
 * uses (completeness review H-01).
 *
 * One secret in one place: the migrator creates the role with exactly what the
 * server will sign in with, so the two cannot drift. A URL that connects as
 * some other role is refused rather than guessed at, because granting one role
 * while the server signs in as another is how an install ends up running as
 * the superuser without anybody deciding it should.
 */
function appRolePassword(): string {
  const appUrl = process.env.DATABASE_URL;
  if (!appUrl) {
    throw new Error("DATABASE_URL is not set.");
  }
  const parsed = new URL(appUrl);
  const user = decodeURIComponent(parsed.username);
  if (user !== appRole) {
    throw new Error(
      `DATABASE_URL connects as "${user}", but OPENOKR_APP_ROLE names "${appRole}". They must be the same role.`,
    );
  }
  return decodeURIComponent(parsed.password);
}

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

  if (appRole !== "" && adminUrl) {
    await ensureLoginRole(client, {
      role: appRole,
      password: appRolePassword(),
    });
    await grantAppPrivileges(client, { appRole });
    process.stdout.write(
      `openokr: ${appRole} is ready, and cannot bypass row-level security.\n`,
    );
  }
} finally {
  await client.end();
}
