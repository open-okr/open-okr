import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (P1-T08, extended in P1-T09).
 *
 * Deliberately small. Specs that prove the whole stack rather than the details
 * of a page. Unit and integration tests are far cheaper and already cover the
 * parts; this exists for the claims only a real browser can settle, starting
 * with "server-rendered with client hydration" and now "a clean server reaches
 * a working instance".
 *
 * Two servers, because the two suites need instances in opposite states: the
 * wizard suite needs one that has never been set up, and the dashboard suite
 * needs one that already has. Each owns its own database and its own port, so
 * neither leaves the other's precondition behind.
 *
 * Both run the standalone build, which is the server the Docker image runs, so
 * what is tested is what ships.
 */

const APP_PORT = Number(process.env.E2E_PORT ?? 3210);
const WIZARD_PORT = Number(process.env.E2E_WIZARD_PORT ?? 3211);

const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const WIZARD_URL = `http://127.0.0.1:${WIZARD_PORT}`;

const databaseUrl = (name: string) =>
  `postgres://${process.env.TEST_DB_APP_ROLE ?? "openokr_app"}:${
    process.env.TEST_DB_PASSWORD ?? "postgres"
  }@${process.env.TEST_DB_HOST ?? "localhost"}:${
    process.env.TEST_DB_PORT ?? "55432"
  }/${name}`;

/** Shared by both servers. Only the database and the port differ. */
const serverEnv = (port: number, url: string) => ({
  // A throwaway value for a throwaway instance. Production refuses a
  // placeholder secret; this is not production.
  BETTER_AUTH_SECRET: "e2e-secret-of-sufficient-length-for-signing-32",
  BETTER_AUTH_URL: url,
  NODE_ENV: "production",
  PORT: String(port),
  // The standalone server binds every interface unless told otherwise.
  HOSTNAME: "127.0.0.1",
  // Production refuses to run without a root key. Fixed rather than generated,
  // so a restart mid-run does not orphan anything sealed before it.
  OPENOKR_ENCRYPTION_KEY: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

export default defineConfig({
  testDir: "./e2e",
  // Both suites claim their instance, and an instance can only be claimed
  // once. Parallel specs would race for it.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    // Kept only for a failure, so a green run leaves nothing behind.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "wizard",
      testMatch: /first-run-wizard\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: WIZARD_URL },
    },
    {
      name: "chromium",
      testIgnore: /first-run-wizard\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: APP_URL },
    },
  ],

  // The database is prepared by the server's own command rather than in
  // `globalSetup`, because Playwright starts these servers first and then
  // waits for them to answer. Preparing afterwards means a server spends its
  // whole readiness window erroring against a schema that is not there yet.
  webServer: [
    {
      command: "sh e2e/start-server.sh",
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...serverEnv(APP_PORT, APP_URL),
        E2E_DATABASE_NAME: "openokr_e2e",
        DATABASE_URL: databaseUrl("openokr_e2e"),
      },
    },
    {
      command: "sh e2e/start-server.sh",
      url: WIZARD_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...serverEnv(WIZARD_PORT, WIZARD_URL),
        E2E_DATABASE_NAME: "openokr_e2e_wizard",
        DATABASE_URL: databaseUrl("openokr_e2e_wizard"),
        // The whole point of this instance: never set up.
        E2E_MARK_CONFIGURED: "0",
      },
    },
  ],
});
