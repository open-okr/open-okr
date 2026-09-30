import { fileURLToPath } from "node:url";
import { resolveSpaceSettings, SETTINGS_REGISTRY } from "@openokr/core";
import { describe, expect, test } from "vitest";
import { readScreen } from "./screen-text.ts";

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
  readScreen(fileURLToPath(new URL(path, import.meta.url)));

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
      "slackChannel",
      "teamVoting",
      "teamsChannel",
    ]);
    for (const key of declared) {
      // The two channels are drawn from one table of fields, one per
      // provider, so their name is a property there rather than an attribute.
      expect(
        card.includes(`name="${key}"`) || card.includes(`name: "${key}"`),
        `${key} has no field on the card`,
      ).toBe(true);
    }
  });

  test("a channel is offered only for a provider the workspace connected (M-23)", () => {
    // A channel id on a provider nobody connected is a link that never posts.
    expect(card).toContain("connected.includes(field.provider)");
    expect(card).toContain("Neither Slack nor Teams is connected");
    expect(page).toContain('"channels.mySettings"');
    expect(page).toContain("connectedProviders={connectedProviders}");
  });

  test("an absent channel field is left alone, and an empty one unlinks (M-23)", () => {
    // The card leaves out a provider that is not connected, and that must not
    // read as the manager clearing a channel they were never shown.
    expect(actions).toContain("if (value === null) {\n      return {};");
    expect(actions).toContain('trimmed === "" ? null : trimmed');
  });

  test("every default resolves without anybody visiting the card", () => {
    // The hard rule: nothing must be configured before the product works. A
    // space that never opens this screen still has all three.
    const defaults = resolveSpaceSettings() as Record<string, unknown>;
    expect(defaults.teamVoting).toBe(true);
    expect(defaults.coachStrictness).toBeNull();
    expect(defaults.defaultCheckInFrequency).toBeNull();
    // And a space posts nowhere until somebody links a channel (M-23).
    expect(defaults.slackChannel).toBeNull();
    expect(defaults.teamsChannel).toBeNull();
  });

  test("empty means the workspace's, and is never a stored value", () => {
    // Pre-selecting the workspace's current value would harden into a stored
    // one the moment somebody pressed save, and the space would then keep it
    // after the workspace changed.
    expect(card).toContain('<option value="">');
    // The words moved into one catalogue message at P6-G22d-b, so what this
    // file can see is the empty option carrying the workspace value as a hole
    // rather than as a selection.
    expect(card).toContain("theWorkspaceS");
    expect(card).toContain("workspaceStrictness");
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
