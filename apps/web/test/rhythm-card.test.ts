import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveThresholds } from "@openokr/method";
import { describe, expect, test } from "vitest";

/**
 * The rhythm card covers the whole §11 registry (S-36, P6-G20, GAP-AUDIT
 * G-03).
 *
 * The card was already generated from the registry rather than from a list of
 * fields, which is the part that matters most and was true from P3-T02. Three
 * things were not.
 *
 * A composite parameter rendered as `JSON.stringify` of its resolved value
 * with a note saying no screen specified how to edit one, so every escalation
 * ladder, every band set and every bounds pair could be read and not changed.
 * A refusal was caught and dropped, so an impossible value looked exactly like
 * a successful save. And there was no way to put a card back.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const form = at("../app/admin/rhythm/rhythm-form.tsx");
const actions = at("../app/admin/rhythm/rhythm-actions.ts");

/** The registry's shapes, counted from the registry itself. */
const resolved = resolveThresholds() as Record<string, unknown>;
const composite = Object.entries(resolved).filter(
  ([, value]) =>
    value !== null &&
    typeof value === "object" &&
    Object.values(value as Record<string, unknown>).every(
      (part) => typeof part === "number",
    ),
);
const lists = composite.filter(([, value]) => Array.isArray(value));

describe("the rhythm and thresholds card", () => {
  test("is generated from the registry, not from a list of fields", () => {
    // The claim worth protecting: a threshold added to METHOD.md next month
    // appears here with no change to this file.
    expect(form).toContain("rhythm.registry.filter");
    expect(form).toContain("rhythm.thresholds[entry.key]");
    // And no threshold key is written into the component.
    for (const key of Object.keys(resolved)) {
      expect(form).not.toContain(`"${key}"`);
    }
  });

  test("every composite parameter is editable, not just readable", () => {
    // There are eighteen of these and they were all read-only.
    expect(composite.length).toBeGreaterThan(10);
    expect(form).toContain("numericParts(resolved)");
    expect(form).toContain("`${prefix}:${entry.key}:${part}`");
  });

  test("a list parameter goes back as a list", () => {
    // Two of the composites are `z.array` in §11, and an object keyed by
    // index is refused by the schema.
    expect(lists).toHaveLength(2);
    expect(form).toContain('Array.isArray(resolved) ? "list" : "composite"');
    expect(actions).toContain("isList");
  });

  test("a half-written set is refused rather than sent", () => {
    // A ladder with one rung filled in is worse than the canon's, and the
    // action would have taken it.
    expect(actions).toContain("values.some((part) => part === null)");
  });

  test("the refusal is returned rather than swallowed", () => {
    // This is the whole of what the previous save did with an OperationError:
    // `return;`. An impossible value and a successful save looked identical.
    expect(actions).toContain("return { error: error.message, saved: null }");
    expect(form).toContain('role="alert"');
  });

  test("reset sends nulls, not the canon's current numbers", () => {
    // Storing today's default is not the same as having no opinion: the
    // stored copy keeps winning after the canon itself moves.
    expect(actions).toContain("wanted.map((key) => [key, null])");
    expect(form).toContain("Reset to the canon");
  });

  test("a blank box is the canon, not zero", () => {
    // `Number("")` is 0, which would have written a real override of zero
    // every time somebody cleared a field.
    expect(actions).toContain('value === "" ? null : Number(value)');
  });
});
