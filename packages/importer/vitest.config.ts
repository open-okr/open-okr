import { defineConfig } from "vitest/config";

// No database and no harness: what is left in this package is the command's
// argument parsing and its report rendering, both pure. The engine's tests
// moved with the engine into `packages/core`, where they run against a real
// Postgres.
export default defineConfig({
  test: {
    testTimeout: 20_000,
    // The FlowyTeam connector's tests build a throwaway MySQL database with
    // forty tables in it before they run (P6-T02). That is a setup step, not a
    // slow test, and the default ten seconds is not enough for it on a cold
    // server.
    hookTimeout: 60_000,
  },
});
