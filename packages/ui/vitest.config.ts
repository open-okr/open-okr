import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The absolute path to tokens.css, baked in at config load.
 *
 * tokens-contrast.test.ts parses that file, and nothing available inside a
 * test can point at it reliably. `process.cwd()` is the package under
 * `pnpm test` (Turbo runs a task per package) and the repository root under
 * `pnpm test:ci` (one Vitest over `projects: ["packages/*", "apps/*"]`).
 * `import.meta.url` differs between the two as well. Vite's `?raw` import is
 * no help either: Vitest stubs CSS imports to an empty string unless
 * `css: true`, which would put PostCSS in the path of every component test to
 * serve one.
 *
 * A config file does know where it is, so it is the right place to answer the
 * question once.
 */
const tokensCssPath = fileURLToPath(
  new URL("./src/styles/tokens.css", import.meta.url),
);

// Component tests render real DOM (Testing Library) and need matchMedia/
// localStorage, which only jsdom provides. No database dependency anywhere
// in this package, unlike packages/core and packages/db.
export default defineConfig({
  define: {
    __TOKENS_CSS_PATH__: JSON.stringify(tokensCssPath),
  },
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
