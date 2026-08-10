import { join } from "node:path";
import { defineConfig } from "vitest/config";

// The run-executor tests need a real database, the same harness
// packages/core's own database-backed tests use.
const testSupport = join(import.meta.dirname, "../test-support");

export default defineConfig({
  test: {
    globalSetup: [join(testSupport, "src/db-harness.ts")],
    env: {
      OPENOKR_DB_PROJECT: "agents",
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
