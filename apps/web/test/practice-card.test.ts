import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import { PRACTICE, PRACTICE_KEYS, PROFILE_KEYS } from "@openokr/method";
import { describe, expect, test } from "vitest";
import { methodDocumentUrl, RUNNING_VERSION } from "../lib/app-version.ts";

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
const comparison = at("../app/admin/practice/profile-comparison.tsx");
const rhythmForm = at("../app/admin/rhythm/rhythm-form.tsx");
const methodDocument = at("../../../docs/specification/METHOD.md");

/** The anchor GitHub gives a heading: "12.3 The profiles compared" is "123-the-profiles-compared". */
const anchorOf = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");

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

  test("compares the profiles with the function METHOD.md's table is held to", () => {
    // `method:check` compares METHOD.md §12.3 with `compareProfiles`, so the
    // dialog drawing anything else would be a second table to drift.
    expect(page).toContain("compareProfiles()");
    for (const key of [...PRACTICE_KEYS, ...PROFILE_KEYS]) {
      expect(comparison).not.toContain(`"${key}"`);
    }
  });

  test("names a setting the way the comparison does", () => {
    expect(page).toContain("practiceSettingName(key)");
    expect(form).not.toContain("checkTitles");
  });

  test("sends a reader to METHOD.md as this release shipped it, at a heading it has", () => {
    expect(methodDocumentUrl("x")).toBe(
      `https://github.com/open-okr/open-okr/blob/v${RUNNING_VERSION}/docs/specification/METHOD.md#x`,
    );
    const anchors = [...page.matchAll(/methodDocumentUrl\("([^"]+)"\)/g)].map(
      (match) => match[1],
    );
    expect(anchors).toHaveLength(2);
    const headings = new Set(
      [...methodDocument.matchAll(/^#{2,4} (.+)$/gm)].map((match) =>
        anchorOf(match[1] ?? ""),
      ),
    );
    for (const anchor of anchors) {
      expect(headings).toContain(anchor);
    }
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
