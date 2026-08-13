import { describe, expect, it } from "vitest";
import {
  isTermKey,
  resolveTerminology,
  TERM_KEYS,
  TERMINOLOGY,
  validateTerminology,
} from "../src/terminology.ts";

/**
 * Terminology labels (P3-T02, TECHNICAL-PLAN §4.14, METHOD.md §11).
 *
 * A workspace renames a concept the method already has, and cannot invent one.
 * These tests hold that line: the key set is fixed, both grammatical forms are
 * required, and a label is presentation that no rule reads.
 */

describe("the canon terms", () => {
  it("names every term METHOD.md's own vocabulary table defines", () => {
    expect(TERM_KEYS).toContain("objective");
    expect(TERM_KEYS).toContain("keyResult");
    expect(TERM_KEYS).toContain("champion");
    expect(TERM_KEYS).toContain("reviewer");
    expect(TERM_KEYS).toContain("sponsor");
    expect(TERM_KEYS).toContain("facilitator");
    expect(TERM_KEYS).toContain("coordinator");
    expect(TERM_KEYS).toContain("checkIn");
  });

  it("gives every term both forms and an explanation of what it is", () => {
    for (const key of TERM_KEYS) {
      const term = TERMINOLOGY[key];
      expect(term.singular, `${key} singular`).toBeTruthy();
      expect(term.plural, `${key} plural`).toBeTruthy();
      // An admin renaming a word needs to know what the word means, or the
      // rename is a guess.
      expect(term.meaning.length, `${key} meaning`).toBeGreaterThan(20);
    }
  });

  it("recognises its own keys and nothing else", () => {
    expect(isTermKey("objective")).toBe(true);
    expect(isTermKey("initiative")).toBe(false);
  });
});

describe("renaming", () => {
  it("applies a rename to both forms", () => {
    const resolved = resolveTerminology({
      objective: { singular: "Ambition", plural: "Ambitions" },
    });
    expect(resolved.objective).toEqual({
      singular: "Ambition",
      plural: "Ambitions",
    });
  });

  it("leaves every other term at the canon word", () => {
    const resolved = resolveTerminology({
      champion: { singular: "Owner", plural: "Owners" },
    });
    expect(resolved.champion.singular).toBe("Owner");
    expect(resolved.objective.singular).toBe("Objective");
  });

  it("refuses a term the method does not define", () => {
    const result = validateTerminology({
      initiative: { singular: "Project", plural: "Projects" },
    });
    expect(result.problems).toHaveLength(1);
    expect(result.labels).toEqual({});
  });

  it("refuses a rename that sets only one form", () => {
    // A plural nobody set reads wrong everywhere a list is rendered.
    const result = validateTerminology({ objective: { singular: "Ambition" } });
    expect(result.problems).toHaveLength(1);
  });

  it("refuses an empty or whitespace label", () => {
    expect(
      validateTerminology({ objective: { singular: "  ", plural: "x" } })
        .problems,
    ).toHaveLength(1);
  });

  it("returns the canon set when nothing is renamed", () => {
    expect(resolveTerminology()).toEqual(resolveTerminology({}));
    expect(resolveTerminology(null).objective.singular).toBe("Objective");
  });

  it("falls back to the canon for a stored label the schema now refuses", () => {
    const resolved = resolveTerminology({
      objective: { singular: "Ambition", plural: "Ambitions" },
      champion: { singular: "" },
    });
    expect(resolved.objective.singular).toBe("Ambition");
    expect(resolved.champion.singular).toBe("Champion");
  });
});
