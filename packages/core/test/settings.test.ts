import { describe, expect, it } from "vitest";
import {
  INSTANCE_DEFAULT_LANGUAGE,
  resolveMemberSettings,
  resolveWorkspaceSettings,
  SETTINGS_REGISTRY,
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
    for (const setting of SETTINGS_REGISTRY) {
      const value = setting.resolve({});
      expect(value, `${setting.key} resolved to nothing`).toBeDefined();
      expect(value, `${setting.key} resolved to null`).not.toBeNull();
    }
  });

  it("scopes every setting to a storage home that exists today", () => {
    for (const setting of SETTINGS_REGISTRY) {
      expect(["workspace", "member"]).toContain(setting.scope);
    }
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
  it("covers every member-scoped key in the registry", () => {
    const resolved = resolveMemberSettings({});
    for (const setting of SETTINGS_REGISTRY.filter(
      (entry) => entry.scope === "member",
    )) {
      expect(Object.hasOwn(resolved, setting.key)).toBe(true);
    }
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
