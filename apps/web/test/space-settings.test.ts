import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveSpaceSettings, SETTINGS_REGISTRY } from "@openokr/core";
import { describe, expect, test } from "vitest";

/**
 * §4.14's space scope has a surface (P6-G18b, GAP-AUDIT B-09).
 *
 * **The scope existed in the map and nowhere else.** `spaces.settings` has
 * been a jsonb column since P3-T01, carrying a type whose comment named the
 * three settings this task declares, and nothing declared them, nothing
 * defaulted them and nothing wrote them.
 *
 * The defaults, the merge, the inheritance and the two enforcement points are
 * proved against a real database in `packages/core`. What is checked here is
 * that the card renders the registry's three rather than a list of its own,
 * and that it never offers the workspace's value as a stored choice.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const card = at("../app/spaces/[id]/space-settings.tsx");
const actions = at("../app/spaces/actions.ts");
const page = at("../app/spaces/[id]/page.tsx");

describe("the space settings card", () => {
  test("covers exactly the space scope the registry declares", () => {
    const declared = SETTINGS_REGISTRY.filter(
      (setting) => setting.scope === "space",
    ).map((setting) => setting.key);
    expect(declared.sort()).toEqual([
      "coachStrictness",
      "defaultCheckInFrequency",
      "teamVoting",
    ]);
    for (const key of declared) {
      expect(card).toContain(`name="${key}"`);
    }
  });

  test("every default resolves without anybody visiting the card", () => {
    // The hard rule: nothing must be configured before the product works. A
    // space that never opens this screen still has all three.
    const defaults = resolveSpaceSettings() as Record<string, unknown>;
    expect(defaults.teamVoting).toBe(true);
    expect(defaults.coachStrictness).toBeNull();
    expect(defaults.defaultCheckInFrequency).toBeNull();
  });

  test("empty means the workspace's, and is never a stored value", () => {
    // Pre-selecting the workspace's current value would harden into a stored
    // one the moment somebody pressed save, and the space would then keep it
    // after the workspace changed.
    expect(card).toContain('<option value="">');
    expect(card).toContain("The workspace's (");
    expect(actions).toContain('strictness === ""\n          ? null');
  });

  test("the enums come from the canon, not from three words typed here", () => {
    expect(card).toContain("COACH_STRICTNESS.map");
    expect(card).toContain("CHECK_IN_FREQUENCIES.map");
  });

  test("an unchecked box is a decision, not an absent field", () => {
    // A checkbox sends nothing when it is off, so the action reads its
    // absence rather than treating the key as untouched.
    expect(actions).toContain('formData.get("teamVoting") !== null');
  });

  test("the card is on the space page behind the manager's level", () => {
    expect(page).toContain("<SpaceSettingsCard");
    expect(page).toContain("canManage={canManage}");
  });
});
