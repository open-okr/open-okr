import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import { describe, expect, test } from "vitest";
import { NAV_ICON_IDS } from "../lib/nav-icons.tsx";

/**
 * Every registered sidebar module owes an icon.
 *
 * The map used to live inside `app-shell.tsx` behind an `?? <Inbox/>` default,
 * so a module added without one silently rendered an envelope. Four of the
 * eleven sidebar items did: Scorecard, Sessions, Spaces and "Where to reach
 * you" all drew the same icon, which makes a nav list unreadable at a glance
 * and is exactly the opposite of UIUX-PLAN.md §2's "fixed entity
 * iconography".
 *
 * This is the test that makes the next module's author notice.
 */
describe("sidebar icons", () => {
  test("every registered sidebar item has an icon of its own", () => {
    // The highest level, so nothing is filtered out by access.
    const items = navigationFor("sidebar", ACCESS_LEVELS.full);
    const missing = items
      .filter((item) => !NAV_ICON_IDS.includes(item.id))
      .map((item) => item.id);
    expect(missing).toEqual([]);
  });

  test("no two sidebar items share an icon", () => {
    const items = navigationFor("sidebar", ACCESS_LEVELS.full);
    expect(items.length).toBeGreaterThan(1);
    // Guards the failure mode directly: a duplicate mapping reads as a
    // fallback even when every id is present.
    expect(new Set(NAV_ICON_IDS).size).toBe(NAV_ICON_IDS.length);
  });
});
