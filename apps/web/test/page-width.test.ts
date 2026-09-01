import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * One content width, and it is the mockups' (UIUX-PLAN.md §10).
 *
 * Nine mockups draw the content area as `.body { flex: 1; padding: 18px }`:
 * no `max-width`, no centring. Comfortable reading comes from composition
 * instead, and the mockups' own examples are `250px 1fr`
 * (`02-cycle-workspace`), `1fr 292px` (`07-weekly-session`) and
 * `repeat(4, 1fr)` (`09-channels`). `AppShell` already supplies the 18px.
 *
 * UIUX-PLAN says nothing about content width, so each page invented one. By
 * 2026-09-01 there were eight: 576, 672, 768, 896, 1024 and 1152px centred,
 * plus two variants of full bleed, and the admin layout's own 768px wrapping a
 * 160px nav. Three screens side by side looked like three products.
 *
 * This test is the floor. A page that centres itself fails here rather than in
 * somebody's eye six screens later.
 */

/** Screens that are a single form, where a full-width input is its own defect. */
const BOUNDED = [
  "account/api-tokens",
  "account/channels",
  "account/connections",
  "account/device",
  "account/security",
  "oauth/authorize",
];

/** Screens outside the app shell, which draw their own centred card (S-35). */
const OUTSIDE_SHELL = ["(auth)/", "setup/"];

const APP = join(process.cwd(), "app");

async function pageFiles(): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of glob("**/page.tsx", { cwd: APP })) {
    found.push(entry.replaceAll("\\", "/"));
  }
  return found.sort();
}

describe("content width", () => {
  test("no page inside the shell centres itself", async () => {
    const offenders: string[] = [];
    for (const relative of await pageFiles()) {
      if (OUTSIDE_SHELL.some((prefix) => relative.startsWith(prefix))) {
        continue;
      }
      if (BOUNDED.some((prefix) => relative.startsWith(prefix))) {
        continue;
      }
      const source = readFileSync(join(APP, relative), "utf8");
      if (/className="[^"]*\bmx-auto\b[^"]*\bmax-w-/.test(source)) {
        offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the admin layout fills the width too", () => {
    const source = readFileSync(join(APP, "admin/layout.tsx"), "utf8");
    // Its side nav plus content is already the mockups' composition; it was
    // the centred 768px around it that made admin the narrowest screen.
    expect(/className="[^"]*\bmx-auto\b[^"]*\bmax-w-/.test(source)).toBe(false);
  });

  test("the bounded list names only single-form screens", async () => {
    // Guards the exemption itself: a screen added to BOUNDED to silence the
    // first test would otherwise never be noticed.
    const files = await pageFiles();
    for (const prefix of BOUNDED) {
      expect(files).toContain(`${prefix}/page.tsx`);
    }
    expect(BOUNDED.length).toBeLessThanOrEqual(6);
  });
});
