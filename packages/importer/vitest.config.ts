import { join } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Two databases, because this package reads one and writes the other.
 *
 * The spreadsheet command's own tests need neither: argument parsing and report
 * rendering are pure, and the engine's tests moved with the engine into
 * `packages/core`. The FlowyTeam connector needs a real MySQL, because its one
 * acceptance criterion is that it provably cannot write to a source (P6-T02).
 * The mappers need a real Postgres too, because what they prove is that a
 * second run of the same company writes nothing (P6-T03a).
 *
 * The Postgres harness is the same one `packages/core` and `packages/agents`
 * use. MySQL has no harness of its own: `test/support/flowyteam-source.ts`
 * builds and drops its database per suite and skips when nothing answers.
 */
const testSupport = join(import.meta.dirname, "../test-support");

export default defineConfig({
  test: {
    globalSetup: [join(testSupport, "src/db-harness.ts")],
    env: {
      OPENOKR_DB_PROJECT: "importer",
    },
    testTimeout: 30_000,
    // The connector's tests build a throwaway MySQL database with forty tables
    // in it before they run. That is a setup step, not a slow test.
    hookTimeout: 60_000,
  },
});
