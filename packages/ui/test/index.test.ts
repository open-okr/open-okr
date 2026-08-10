/**
 * A wiring check, not a behaviour test.
 *
 * Asserting the package's own name equals itself proves the workspace
 * link, the TypeScript path and the vitest config all resolve — worth
 * keeping now that there is real code (P2-T10), since a broken import
 * graph would otherwise show up as confusing failures in every other test
 * file instead of this one obvious one. The real coverage is the rest of
 * this directory.
 */
import { expect, test } from "vitest";
import { PACKAGE_NAME } from "../src/index";

test("entry point resolves", () => {
  expect(PACKAGE_NAME).toBe("@openokr/ui");
});
