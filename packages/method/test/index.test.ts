/**
 * A wiring check, not a behaviour test.
 *
 * This package has no implementation yet. Asserting its name equals itself
 * proves only that the workspace link, the TypeScript path and the vitest
 * config all resolve, which is worth knowing before there is code to break.
 * It is replaced by real tests when the package is built, and should never be
 * read as coverage.
 */
import { expect, test } from "vitest";
import { PACKAGE_NAME } from "../src/index";

test("entry point resolves", () => {
  expect(PACKAGE_NAME).toBe("@openokr/method");
});
