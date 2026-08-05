import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Driver contract tests need a real database, but `packages/adapters` must
// not depend on `@openokr/test-support` (TECHNICAL-PLAN §1 allows `config`
// only, and test-support depends on db). The alias reaches the harness
// sources directly; tsconfig `paths` mirrors it for type checking.
const testSupport = join(import.meta.dirname, "../test-support");

export default defineConfig({
  resolve: {
    alias: {
      "@openokr/test-support/db": join(testSupport, "src/db-harness.ts"),
    },
  },
  test: {
    globalSetup: [join(testSupport, "src/db-harness.ts")],
    env: {
      OPENOKR_DB_PROJECT: "adapters",
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
