import { MODULE_REGISTRY } from "@openokr/core";
import { CATALOGUES, translate } from "@openokr/ui";
import { describe, expect, test } from "vitest";
import { builtinRoleLabel, navGroupLabel, navText } from "../lib/nav-groups.ts";

/**
 * UAT 0.8.0 F-08: in Bahasa Melayu the sidebar, the bottom bar, the palette
 * and the avatar menu's account rows stayed English, because the registry's
 * labels went to the screen untranslated, and so did the built-in role names.
 */

const items = MODULE_REGISTRY.flatMap((module) => module.navigation);
const tIn = (locale: "en" | "ms") => (key: string) =>
  translate(CATALOGUES[locale], key);

describe("navigation labels", () => {
  test("every registry item has a key, in English the registry's own label", () => {
    for (const item of items) {
      expect(CATALOGUES.en[`nav.item.${item.id}`], item.id).toBe(item.label);
      expect(CATALOGUES.ms[`nav.item.${item.id}`], item.id).toBeTruthy();
    }
  });

  test("are read in the reader's language", () => {
    const ms = tIn("ms");
    expect(navText({ id: "overview", label: "Home" }, ms)).toBe("Utama");
    expect(navText({ id: "account-profile", label: "Your account" }, ms)).toBe(
      "Akaun anda",
    );
    expect(navText({ id: "overview", label: "Home" }, tIn("en"))).toBe("Home");
  });

  test("still use the workspace's own word where it has one (M-14)", () => {
    expect(
      navText({ id: "spaces", label: "Spaces" }, tIn("ms"), {
        space: { singular: "team", plural: "teams" },
      }),
    ).toBe("Teams");
  });

  test("give each sidebar block its heading in the reader's language", () => {
    expect(navGroupLabel("primary", tIn("ms"))).toBeUndefined();
    expect(navGroupLabel("account", tIn("ms"))).toBe("Akaun");
    expect(navGroupLabel("okr", tIn("en"))).toBe("OKR");
  });
});

describe("role names", () => {
  test("a built-in role is read in the reader's language", () => {
    expect(builtinRoleLabel("member", "Member", tIn("ms"))).toBe("Ahli");
    expect(builtinRoleLabel("owner", "Owner", tIn("en"))).toBe("Owner");
  });

  test("a role the workspace made keeps the name it was given", () => {
    expect(builtinRoleLabel(null, "Coach", tIn("ms"))).toBe("Coach");
    expect(builtinRoleLabel(null, null, tIn("ms"))).toBeNull();
  });
});
