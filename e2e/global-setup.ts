/**
 * A clean instance for every end-to-end run.
 *
 * The registration policy closes an instance once somebody has claimed it
 * (TECHNICAL-PLAN §4.14), so a suite that registers cannot reuse a database
 * between runs, and specs that register cannot casually share one. Building
 * the isolation in now, with a single spec, costs nothing; retrofitting it
 * once invitations land at P2-T04 would not.
 *
 * Everything here reuses what already ships: the same role provisioning, the
 * same migration runner and the same privilege model production uses, so a
 * bug in any of them fails here rather than hiding behind a bespoke setup.
 */
import {
  ensureRoles,
  grantAppPrivileges,
  runMigrations,
} from "@openokr/db";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import { join } from "node:path";
import pg from "pg";

/** The database this suite owns outright. Dropped and rebuilt every run. */
export const E2E_DATABASE = "openokr_e2e";

const MIGRATIONS = join(import.meta.dirname, "../packages/db/migrations");

export default async function globalSetup(): Promise<void> {
  const admin = new pg.Client(
    connectionOptions("postgres", testDbEnv.superuser),
  );

  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach the test database at ${testDbEnv.host}:${testDbEnv.port}. ` +
        "Start it with: pnpm db:up",
      { cause: error },
    );
  }

  try {
    await ensureRoles(admin, {
      ownerRole: testDbEnv.ownerRole,
      appRole: testDbEnv.appRole,
      password: testDbEnv.password,
    });
    // Force, because a browser left holding a connection would otherwise keep
    // the previous run's database alive and the next run would inherit its
    // registered user.
    await admin.query(`drop database if exists ${E2E_DATABASE} with (force)`);
    await admin.query(
      `create database ${E2E_DATABASE} owner ${testDbEnv.ownerRole}`,
    );
  } finally {
    await admin.end();
  }

  const owner = new pg.Client(
    connectionOptions(E2E_DATABASE, testDbEnv.ownerRole),
  );
  await owner.connect();
  try {
    // Migrations run as the owner, exactly as production does, so an
    // accidental superuser assumption fails here rather than on a customer's
    // first deploy.
    await runMigrations(owner, { dirs: [MIGRATIONS] });
    await grantAppPrivileges(owner, { appRole: testDbEnv.appRole });
  } finally {
    await owner.end();
  }
}
