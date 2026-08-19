/**
 * Playwright config for running e2e tests against the local dev server.
 *
 * Use this for rapid QA during development — the dev server must already be
 * running (`pnpm dev`). Does not start or stop any server.
 *
 *   npx playwright test --config playwright.dev.config.ts --headed e2e/sessions.spec.ts
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
