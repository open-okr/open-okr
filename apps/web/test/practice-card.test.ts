import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import { PRACTICE, PRACTICE_KEYS } from "@openokr/method";
import { describe, expect, test } from "vitest";

/**
 * The practice settings screen (S-36, METHOD.md §12, P9-T05).
 *
 * Read as source, the way the rhythm card's test reads its card, because what
 * is worth protecting is how the screen is built rather than what one render
 * shows: that it is generated from the registry, that it saves only what
 * changed, and that its profile preview and the profile write are one
 * function.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const form = at("../app/admin/practice/practice-form.tsx");
const actions = at("../app/admin/practice/practice-actions.ts");
const page = at("../app/admin/practice/page.tsx");
const rhythmForm = at("../app/admin/rhythm/rhythm-form.tsx");

describe("the practice screen", () => {
  test("is generated from the registry, and names no setting", () => {
    // A setting added to §12 next month appears with no change to this file.
    expect(form).toContain("practice.registry.filter");
    for (const key of PRACTICE_KEYS) {
      expect(form).not.toContain(`"${key}"`);
    }
  });

  test("gives every §12.1 group a card title", () => {
    const groups = new Set(PRACTICE_KEYS.map((key) => PRACTICE[key].group));
    for (const group of groups) {
      expect(form).toContain(`${group}: "admin.practice.groups.${group}"`);
    }
  });

  test("shows each option in §12.1's words rather than its stored key", () => {
    expect(form).toContain("setting.optionLabels[option]");
  });

  test("saves only what a card changed, and resets only what differs", () => {
    // Every select is submitted. Sending them all would record each one as a
    // change in the audit trail.
    expect(actions).toContain("current.practice[key] !== value");
    expect(actions).toContain("key in current.overrides");
  });

  test("previews a profile with the function the write runs", () => {
    expect(page).toContain("switchProfile(");
    expect(at("../../../packages/core/src/actions/practice.ts")).toContain(
      "switchProfile(",
    );
  });

  test("is in the admin navigation for whoever may change it", () => {
    const admin = navigationFor("admin", ACCESS_LEVELS.full);
    expect(admin.map((item) => item.href)).toContain("/admin/practice");
    expect(
      navigationFor("admin", ACCESS_LEVELS.edit).map((item) => item.href),
    ).not.toContain("/admin/practice");
  });
});

describe("strict mode has one home", () => {
  test("the rhythm card no longer offers coach strictness, and points to the practice", () => {
    // Two switches for one behaviour is two places to look. Data change 0015
    // carried a workspace that had chosen strict onto strict mode.
    expect(rhythmForm).not.toContain('name="coachStrictness"');
    expect(rhythmForm).toContain('href="/admin/practice"');
  });
});
