import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Authentication tests need a real database. `packages/core` must not depend
// on `@openokr/test-support`, which already depends on core, so the alias
// reaches the harness sources directly; tsconfig `paths` mirrors it.
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
      OPENOKR_DB_PROJECT: "core",
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
