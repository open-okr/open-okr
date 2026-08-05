import { join } from "node:path";
import { defineConfig } from "vitest/config";

// This package's tests use the shared database harness, but the package
// itself must not depend on @openokr/test-support: test-support already
// depends on db, and a cycle would break the task graph. The alias reaches
// the harness sources directly; tsconfig `paths` mirrors it for type checking.
const testSupport = join(import.meta.dirname, "../test-support");

export default defineConfig({
  resolve: {
    alias: {
      "@openokr/test-support/db-fixtures": join(
        testSupport,
        "fixtures/db/schema.ts",
      ),
      "@openokr/test-support/db": join(testSupport, "src/db-harness.ts"),
    },
  },
  test: {
    globalSetup: [join(testSupport, "src/db-harness.ts")],
    env: {
      // Keeps this project's per-worker database names distinct from other
      // projects running in the same Vitest process pool.
      OPENOKR_DB_PROJECT: "db",
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
