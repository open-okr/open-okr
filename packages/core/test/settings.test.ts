import { describe, expect, it } from "vitest";
import {
  findSetting,
  INSTANCE_DEFAULT_LANGUAGE,
  resolveMemberNotificationSettings,
  resolveMemberSettings,
  resolveWorkspaceSettings,
  SETTINGS_REGISTRY,
  settingsByCard,
} from "../src/settings/registry.ts";

/**
 * The settings registry (TECHNICAL-PLAN §4.14).
 *
 * The rule this file enforces: every setting has a working default, and a
 * setting that is not in the registry does not exist. These tests walk the
 * live registry rather than a fixed list, so a module that adds a setting
 * without a default fails here rather than in production on a fresh
 * workspace.
 */

describe("the registry itself", () => {
  it("declares at least one setting", () => {
    expect(SETTINGS_REGISTRY.length).toBeGreaterThan(0);
  });

  it("has no duplicate keys", () => {
    const keys = SETTINGS_REGISTRY.map((setting) => setting.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every setting a reason, so the map stays readable", () => {
    for (const setting of SETTINGS_REGISTRY) {
      expect(
        setting.why.length,
        `${setting.key} has no reason`,
      ).toBeGreaterThan(0);
    }
  });

  it("resolves every setting to a value with nothing supplied", () => {
    // The hard rule: registering must not require anyone to answer anything.
    //
    // **Null is a default when the setting is declared nullable, and never
    // otherwise.** This read `not.toBeNull()` until P6-G18b added the space
    // scope, where an override's default *is* null and null means "the
    // workspace's": a space that has decided nothing inherits a real value,
    // and storing the workspace's current one instead would freeze it. A
    // setting that resolves to null without declaring it nullable is still
    // the defect this guards against, and the schema is what says which is
    // which.
    for (const setting of SETTINGS_REGISTRY) {
      const value = setting.resolve({});
      expect(value, `${setting.key} resolved to nothing`).toBeDefined();
      if (value === null) {
        expect(
          setting.schema.safeParse(null).success,
          `${setting.key} resolved to null without being nullable`,
        ).toBe(true);
      }
    }
  });

  it("scopes every setting to a storage home that exists today", () => {
    // A scope with no table behind it is a setting nothing can store. Each
    // scope is paired with the home that holds it, so adding a scope without
    // deciding where it lives fails here rather than at the first write.
    const homesByScope: Record<string, readonly string[]> = {
      workspace: ["workspaces.settings"],
      member: ["workspace_members", "notification_settings"],
      space: ["spaces.settings"],
    };
    for (const setting of SETTINGS_REGISTRY) {
      const homes = homesByScope[setting.scope];
      expect(homes, `${setting.key} has an unknown scope`).toBeDefined();
      expect(
        homes,
        `${setting.key} is ${setting.scope}-scoped and stored in ${setting.home}`,
      ).toContain(setting.home);
    }
  });

  it("validates every setting's own default against its own write schema (P2-T08)", () => {
    // The registry's `resolve` answers "does this default exist"; `schema`
    // answers a stricter question for the admin write path. A default that
    // fails its own setting's schema would make a fresh workspace's stored
    // value invalid the moment an admin screen tried to round-trip it.
    for (const setting of SETTINGS_REGISTRY) {
      const result = setting.schema.safeParse(setting.resolve({}));
      expect(
        result.success,
        `${setting.key}'s default does not validate against its own schema`,
      ).toBe(true);
    }
  });

  it("puts every card-bearing setting's card on a workspace-scoped entry (P2-T08)", () => {
    for (const setting of SETTINGS_REGISTRY) {
      if (setting.card !== undefined) {
        expect(setting.scope).toBe("workspace");
      }
    }
  });
});

describe("settingsByCard and findSetting (P2-T08)", () => {
  it("finds a registered setting by key", () => {
    expect(findSetting("timezone")?.scope).toBe("workspace");
  });

  it("returns nothing for a key outside the registry", () => {
    expect(findSetting("doesNotExist")).toBeUndefined();
  });

  it("groups the general card's settings", () => {
    const general = settingsByCard("general").map((setting) => setting.key);
    expect(general).toEqual(
      expect.arrayContaining(["timezone", "language", "trustedEmailDomains"]),
    );
  });

  it("returns nothing for a card nothing is on", () => {
    expect(settingsByCard("no-such-card")).toEqual([]);
  });
});

describe("workspace settings", () => {
  it("covers every workspace-scoped key in the registry", () => {
    const resolved = resolveWorkspaceSettings({});
    for (const setting of SETTINGS_REGISTRY.filter(
      (entry) => entry.scope === "workspace",
    )) {
      expect(Object.hasOwn(resolved, setting.key)).toBe(true);
    }
  });

  it("defaults the language to the instance default", () => {
    expect(resolveWorkspaceSettings({}).language).toBe(
      INSTANCE_DEFAULT_LANGUAGE,
    );
  });

  it("starts with no trusted email domains, so joining is by invitation", () => {
    expect(resolveWorkspaceSettings({}).trustedEmailDomains).toEqual([]);
  });

  it("takes the timezone the browser reported", () => {
    expect(
      resolveWorkspaceSettings({ timezone: "Asia/Kuala_Lumpur" }).timezone,
    ).toBe("Asia/Kuala_Lumpur");
  });

  it("falls back to UTC when the timezone is missing or nonsense", () => {
    expect(resolveWorkspaceSettings({}).timezone).toBe("UTC");
    expect(
      resolveWorkspaceSettings({ timezone: "Mars/Olympus" }).timezone,
    ).toBe("UTC");
    // A crafted value must never reach the database as a timezone.
    expect(
      resolveWorkspaceSettings({ timezone: "'; drop table workspaces; --" })
        .timezone,
    ).toBe("UTC");
  });
});

describe("member settings", () => {
  it("covers every key stored as a member column", () => {
    // **Filtered on the home, not the scope, since P6-G08.** This asserted
    // that `resolveMemberSettings` covered every member-scoped key, which was
    // the same statement while every member setting was a member column. The
    // notification preferences are member-scoped too and live in
    // `notification_settings`, created lazily on first read, so including them
    // here would demand that provisioning write keys to columns that do not
    // exist. Their own coverage is the assertion below.
    const resolved = resolveMemberSettings({});
    for (const setting of SETTINGS_REGISTRY.filter(
      (entry) => entry.home === "workspace_members",
    )) {
      expect(Object.hasOwn(resolved, setting.key)).toBe(true);
    }
  });

  it("covers every key stored in the notification settings row", () => {
    const resolved = resolveMemberNotificationSettings({});
    for (const setting of SETTINGS_REGISTRY.filter(
      (entry) => entry.home === "notification_settings",
    )) {
      expect(Object.hasOwn(resolved, setting.key)).toBe(true);
    }
  });

  it("leaves no member-scoped setting without a resolver", () => {
    // The invariant the split could have lost: a member setting whose home is
    // neither of the two above would be declared and resolved by nothing.
    const orphans = SETTINGS_REGISTRY.filter(
      (entry) =>
        entry.scope === "member" &&
        entry.home !== "workspace_members" &&
        entry.home !== "notification_settings",
    ).map((entry) => entry.key);
    expect(orphans).toEqual([]);
  });

  it("defaults the primary channel to email beside the in-app inbox", () => {
    expect(resolveMemberSettings({}).primaryChannel).toBe("email");
  });

  it("defaults quiet hours to 19:00 through 08:00", () => {
    expect(resolveMemberSettings({}).quietHours).toEqual({
      start: "19:00",
      end: "08:00",
    });
  });
});
