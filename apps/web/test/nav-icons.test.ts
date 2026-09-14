import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import { iconFor, NAV_ICON_IDS } from "../lib/nav-icons.tsx";

/**
 * Every registered navigation module owes an icon of its own.
 *
 * The map used to live inside `app-shell.tsx` behind an `?? <Inbox/>` default,
 * so a module added without one silently rendered an envelope. Four of the
 * eleven sidebar items did: Scorecard, Sessions, Spaces and "Where to reach
 * you" all drew the same icon, which makes a nav list unreadable at a glance
 * and is exactly the opposite of UIUX-PLAN.md §2's "fixed entity
 * iconography".
 *
 * This is the test that makes the next module's author notice.
 *
 * **The admin sections joined on 2026-09-10**, when the section navigation
 * started drawing icons. They had been outside this gate for as long as they
 * had been unillustrated, which is the same hole in a different section.
 */
const SECTIONS = ["sidebar", "admin"] as const;

describe("navigation icons", () => {
  for (const section of SECTIONS) {
    test(`every registered ${section} item has an icon`, () => {
      // The highest level, so nothing is filtered out by access.
      const items = navigationFor(section, ACCESS_LEVELS.full);
      expect(items.length).toBeGreaterThan(1);
      const missing = items
        .filter((item) => !NAV_ICON_IDS.includes(item.id))
        .map((item) => item.id);
      expect(missing).toEqual([]);
    });
  }

  test("no two items share an icon", () => {
    // **Compares the components, not the keys.** This asserted that the map's
    // own ids were unique, which an object literal guarantees on its own, so
    // the check named the right failure and could not catch it. Two ids
    // pointing at one Lucide component is the failure, and it is the one that
    // reads as the old `?? <Inbox/>` fallback even when every id is present.
    const drawn = NAV_ICON_IDS.map((id) => (iconFor(id) as ReactElement).type);
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  test("the fallback is not one of the mapped icons", () => {
    // An unmapped id has to look unmapped. If the deliberately meaningless
    // circle were also some module's real icon, a missing mapping would render
    // as that module instead of as nothing.
    const fallback = (iconFor("no-such-module") as ReactElement).type;
    const drawn = NAV_ICON_IDS.map((id) => (iconFor(id) as ReactElement).type);
    expect(drawn).not.toContain(fallback);
  });
});
