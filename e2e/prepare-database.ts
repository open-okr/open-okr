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
 *
 * **Run from the web server's own command, not from `globalSetup`.** Playwright
 * starts `webServer` first and waits for it to answer, so a database prepared
 * in `globalSetup` is prepared too late: the server spends the whole readiness
 * window erroring against a schema that is not there yet. Making the server
 * command depend on this script puts the ordering in one place instead of
 * relying on the order Playwright happens to use.
 */
import {
  ensureRoles,
  grantAppPrivileges,
  runMigrations,
} from "@openokr/db";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import { join } from "node:path";
import pg from "pg";

/**
 * The database this server owns outright. Dropped and rebuilt every run.
 *
 * Named per server, because the two suites need instances in different states:
 * the dashboard suite needs one that is already set up, and the wizard suite
 * needs one that never has been. Sharing a database would mean one suite
 * leaving the other's precondition behind.
 */
export const E2E_DATABASE = process.env.E2E_DATABASE_NAME ?? "openokr_e2e";

/**
 * Whether to record setup as finished.
 *
 * The dashboard suite is about the session and the dashboard, so it skips the
 * wizard. The wizard suite is about the wizard, so it must not.
 */
const MARK_CONFIGURED = process.env.E2E_MARK_CONFIGURED !== "0";

const MIGRATIONS = join(import.meta.dirname, "../packages/db/migrations");

export async function prepareDatabase(): Promise<void> {
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

    // Mark setup finished (P1-T09). An unconfigured instance sends every
    // authentication route to the first-run wizard, which is right for a real
    // deployment and wrong for the dashboard suite: those specs are about the
    // session and the dashboard, not about first run.
    //
    // Registration is left on 'auto', so it stays open until a spec claims the
    // instance, which is what the registration spec asserts.
    //
    // The instance-admin opt-in is set explicitly, in a transaction, because
    // `system_settings` forces row-level security and that applies to the
    // table owner as well. Even this script cannot write instance settings by
    // accident, which is the point of the policy.
    if (MARK_CONFIGURED) {
      await owner.query("begin");
      await owner.query("select set_config('app.instance_admin', 'on', true)");
      await owner.query(
        `insert into system_settings (key, value, source)
           values ('setup.completed_at', to_jsonb(now()::text), 'test')
         on conflict (key) do nothing`,
      );
      await owner.query("commit");
    }
  } finally {
    await owner.end();
  }
}

// Invoked directly by the web server's command, so this file is both a module
// and a script.
await prepareDatabase();
process.stdout.write(`openokr: ${E2E_DATABASE} is ready.\n`);
