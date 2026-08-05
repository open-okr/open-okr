import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The fixtures directory holds a deliberately flaky test that the reporter
    // suite runs in its own Vitest process. It must not run here.
    exclude: ["**/node_modules/**", "fixtures/**"],
    globalSetup: ["./src/db-harness.ts"],
    env: {
      // Keeps this project's per-worker database names distinct from other
      // projects running in the same Vitest process pool.
      OPENOKR_DB_PROJECT: "test_support",
    },
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
