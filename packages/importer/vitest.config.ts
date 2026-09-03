import { defineConfig } from "vitest/config";

// No database and no harness: what is left in this package is the command's
// argument parsing and its report rendering, both pure. The engine's tests
// moved with the engine into `packages/core`, where they run against a real
// Postgres.
export default defineConfig({
  test: {
    testTimeout: 10_000,
  },
});
