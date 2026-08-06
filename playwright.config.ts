import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (P1-T08).
 *
 * Deliberately small. One browser, one project, and specs that prove the whole
 * stack rather than the details of a page. Unit and integration tests are far
 * cheaper and already cover the parts; this exists for the claims only a real
 * browser can settle, starting with "server-rendered with client hydration".
 *
 * It runs the built application through `next start`, not the development
 * server, so what is tested is what ships.
 */

const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Matches the database the global setup builds. */
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgres://${process.env.TEST_DB_APP_ROLE ?? "openokr_app"}:${
    process.env.TEST_DB_PASSWORD ?? "postgres"
  }@${process.env.TEST_DB_HOST ?? "localhost"}:${
    process.env.TEST_DB_PORT ?? "55432"
  }/openokr_e2e`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // The suite registers, and registration closes the instance. Parallel specs
  // would race for the one account a fresh instance allows.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    // Kept only for a failure, so a green run leaves nothing behind.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: {
    command: "pnpm --filter @openokr/web exec next start -p " + String(PORT),
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      DATABASE_URL,
      // A throwaway value for a throwaway instance. Production refuses a
      // placeholder secret; this is not production.
      BETTER_AUTH_SECRET: "e2e-secret-of-sufficient-length-for-signing-32",
      BETTER_AUTH_URL: BASE_URL,
      NODE_ENV: "production",
    },
  },
});
