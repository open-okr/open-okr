import { defineConfig } from "vitest/config";

// Component tests render real DOM (Testing Library) and need matchMedia/
// localStorage, which only jsdom provides. No database dependency anywhere
// in this package, unlike packages/core and packages/db.
export default defineConfig({
  test: {
    environment: "jsdom",
    // Testing Library's own auto-cleanup-between-tests only registers
    // when it detects a global `afterEach`, which `globals: true` is what
    // provides under Vitest (its docs' own documented requirement) —
    // without it, every test's render stays in the DOM for the next one.
    globals: true,
    setupFiles: ["./test/setup.ts"],
  },
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
    },
  },
});
