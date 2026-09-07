import { describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import {
  findNavigationItem,
  isRouteAllowed,
  MODULE_REGISTRY,
  navigationFor,
} from "../src/modules/registry.ts";

/**
 * The module registry (P2-T08 test plan, TECHNICAL-PLAN §4.14).
 *
 * Pure and DB-free by design, so this exercises exactly what the acceptance
 * criterion asks for: a navigation item that requires an access level is
 * hidden below it, and the route it names is denied below it too, without
 * a member or a workspace anywhere in sight.
 */

describe("the registry itself", () => {
  it("gives every item a unique id", () => {
    const ids = MODULE_REGISTRY.flatMap((module) =>
      module.navigation.map((item) => item.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every item a unique href within its own section", () => {
    for (const section of ["sidebar", "admin"] as const) {
      const hrefs = MODULE_REGISTRY.flatMap((module) =>
        module.navigation
          .filter((item) => item.section === section)
          .map((item) => item.href),
      );
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });
});

describe("navigationFor", () => {
  it("hides an item a member's level does not reach", () => {
    const shown = navigationFor("admin", ACCESS_LEVELS.edit);
    expect(shown.some((item) => item.id === "admin-general")).toBe(false);
  });

  it("shows an item at exactly its required level", () => {
    const shown = navigationFor("admin", ACCESS_LEVELS.full);
    expect(shown.some((item) => item.id === "admin-general")).toBe(true);
  });

  it("shows a view-level sidebar item to every active member", () => {
    const shown = navigationFor("sidebar", ACCESS_LEVELS.view);
    expect(shown.some((item) => item.id === "overview")).toBe(true);
  });
});

describe("isRouteAllowed", () => {
  it("denies the route a member's level does not reach", () => {
    expect(isRouteAllowed("/admin/general", ACCESS_LEVELS.edit)).toBe(false);
  });

  it("allows the route once the level reaches it", () => {
    expect(isRouteAllowed("/admin/general", ACCESS_LEVELS.full)).toBe(true);
  });

  it("does not deny a route the registry has no entry for", () => {
    expect(isRouteAllowed("/some/future/route", 0)).toBe(true);
  });
});

describe("findNavigationItem", () => {
  it("finds a registered route", () => {
    expect(findNavigationItem("/admin/branding")?.id).toBe("admin-branding");
  });

  it("returns nothing for an unregistered route", () => {
    expect(findNavigationItem("/nowhere")).toBeUndefined();
  });
});

/**
 * Navigation blocks (UIUX-PLAN.md §3).
 *
 * §3 asks for three separated sidebar blocks, and the registry could not
 * express that: it carried `section` (which surface an item belongs to) but
 * nothing saying which block within it. So the sidebar rendered one flat list
 * of eleven items, which is what STATUS.md recorded as deferred to P3-T11
 * until the deferral was overridden on 2026-09-01.
 *
 * Every sidebar item declares its block. An item that does not is the bug this
 * catches: it would silently fall into the first, unlabelled block.
 */
describe("navigation blocks", () => {
  it("every sidebar item declares which block it belongs to", () => {
    const missing = navigationFor("sidebar", ACCESS_LEVELS.full)
      .filter((item) => item.group === undefined)
      .map((item) => item.id);
    expect(missing).toEqual([]);
  });

  it("admin items declare no block: they render as one entry", () => {
    for (const item of navigationFor("admin", ACCESS_LEVELS.full)) {
      expect(item.group).toBeUndefined();
    }
  });

  it("the practice block holds the cycle, not the account pages", () => {
    const byId = new Map(
      navigationFor("sidebar", ACCESS_LEVELS.full).map((i) => [i.id, i.group]),
    );
    expect(byId.get("cycle")).toBe("practice");
    expect(byId.get("goals")).toBe("practice");
    expect(byId.get("kpis")).toBe("practice");
    expect(byId.get("overview")).toBe("primary");
    expect(byId.get("review")).toBe("primary");
    expect(byId.get("spaces")).toBe("spaces");
    expect(byId.get("account-security")).toBe("account");
  });
});
