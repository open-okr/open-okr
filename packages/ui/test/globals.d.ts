/**
 * The absolute path to `src/styles/tokens.css`, inlined by `define` in
 * vitest.config.ts and read by tokens-contrast.test.ts.
 *
 * It comes from the config rather than from the test because no path
 * expression inside a test survives both of this repository's runners:
 * `pnpm test` runs Vitest per package through Turbo, `pnpm test:ci` runs one
 * Vitest from the repository root, and `process.cwd()` and `import.meta.url`
 * both differ between them. The config file knows where it is.
 */
declare const __TOKENS_CSS_PATH__: string;
