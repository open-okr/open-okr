import { describe, expect, test } from "vitest";
import { isLicenceAllowed } from "../src/licence-policy.ts";

/**
 * The gate must never wave through a licence we cannot distribute under
 * AGPL-3.0, and must not block a package whose expression offers us an
 * acceptable choice. Both directions are tested.
 */

const ALLOWED = new Set([
  "MIT",
  "CC0-1.0",
  "ISC",
  "Apache-2.0",
  "BSD-3-Clause",
]);

describe("isLicenceAllowed", () => {
  test("accepts a single allowed identifier", () => {
    expect(isLicenceAllowed("MIT", ALLOWED)).toBe(true);
  });

  test("rejects a single identifier that is not allowed", () => {
    expect(isLicenceAllowed("GPL-3.0-only", ALLOWED)).toBe(false);
  });

  test("accepts an OR expression when one operand is allowed", () => {
    expect(isLicenceAllowed("(MIT OR CC0-1.0)", ALLOWED)).toBe(true);
    expect(isLicenceAllowed("GPL-3.0-only OR MIT", ALLOWED)).toBe(true);
  });

  test("rejects an OR expression when no operand is allowed", () => {
    expect(isLicenceAllowed("(GPL-3.0-only OR SSPL-1.0)", ALLOWED)).toBe(false);
  });

  test("requires every operand of an AND expression", () => {
    expect(isLicenceAllowed("MIT AND ISC", ALLOWED)).toBe(true);
    expect(isLicenceAllowed("MIT AND GPL-3.0-only", ALLOWED)).toBe(false);
  });

  test("handles nesting and mixed operators", () => {
    expect(isLicenceAllowed("(MIT AND ISC) OR GPL-3.0-only", ALLOWED)).toBe(
      true,
    );
    expect(
      isLicenceAllowed("(MIT AND GPL-3.0-only) OR SSPL-1.0", ALLOWED),
    ).toBe(false);
    expect(isLicenceAllowed("MIT AND (ISC OR GPL-3.0-only)", ALLOWED)).toBe(
      true,
    );
  });

  test("does not mistake an identifier containing the letters or and and", () => {
    // "Sendmail" and "Condor-1.1" embed the operator letters; word boundaries
    // must keep them intact.
    expect(isLicenceAllowed("Sendmail", ALLOWED)).toBe(false);
    expect(isLicenceAllowed("Sendmail OR MIT", ALLOWED)).toBe(true);
  });

  test("refuses WITH exception clauses so a human reads them", () => {
    expect(isLicenceAllowed("Apache-2.0 WITH LLVM-exception", ALLOWED)).toBe(
      false,
    );
  });

  test("is case-insensitive about operators but not identifiers", () => {
    expect(isLicenceAllowed("GPL-3.0-only or MIT", ALLOWED)).toBe(true);
    expect(isLicenceAllowed("mit", ALLOWED)).toBe(false);
  });
});
