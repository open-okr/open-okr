import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

/**
 * Screens that are a single decision, where a full-width input is its own
 * defect.
 *
 * **The four account screens left this list on 2026-09-10.** They were on it
 * because each is a form, and the reasoning stopped there: a narrow column is
 * one way to keep an input from growing to a thousand pixels, and it is not
 * the only one. Sitting beside the rest of the product they read as a
 * different application, which is the failure this file exists to catch. What
 * replaced it is a bound on the field rather than on the page: `max-w-xs` on a
 * password or a one-time code, `max-w-sm` on a setting, `max-w-prose` on the
 * sentence that explains it, inside a card that fills the content area like
 * every other card.
 *
 * What is left is the two screens that are one decision and nothing else. A
 * device approval and an OAuth consent are read, answered and closed, they
 * carry no navigation of their own, and there is nothing beside them for a
 * wide column to line up with.
 */
const BOUNDED = ["account/device", "oauth/authorize"];

/**
 * Screens outside the app shell, which draw their own centred card (S-35).
 *
 * `welcome/` joined them at P6-G26: somebody who has never used the product
 * has nothing to navigate to yet, and a sidebar full of empty screens is the
 * state onboarding exists to get them out of.
 *
 * `join/` joined them at P6-G06b. A visitor following an invitation has no
 * membership anywhere yet, so there is no workspace to render a shell for and
 * nothing in the sidebar they could reach. It is the same shape as sign-in and
 * the first-run wizard, and it is centred for the same reason.
 */
const OUTSIDE_SHELL = ["(auth)/", "join/", "setup/", "welcome/"];

// Resolved from this file, not from `process.cwd()`. Under `pnpm test` the cwd
// is this package; under `pnpm test:ci` it is the repository root, which made
// the glob find nothing and every assertion here pass on an empty list until
// CI failed on the one that checks the list is not empty. CLAUDE.md warns about
// exactly this for tokens-contrast.test.ts.
const APP = fileURLToPath(new URL("../app/", import.meta.url));

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

  test("the bounded list names only single-decision screens", async () => {
    // Guards the exemption itself: a screen added to BOUNDED to silence the
    // first test would otherwise never be noticed.
    const files = await pageFiles();
    for (const prefix of BOUNDED) {
      expect(files).toContain(`${prefix}/page.tsx`);
    }
    // Two, and the bound is the length rather than a round number above it.
    // It was six while the account screens were on the list, which meant a
    // seventh could be added without anybody arguing for it. Bounding the
    // field instead of the page is the answer for a screen inside the shell,
    // so growing this list needs a reason and this line asks for one.
    expect(BOUNDED.length).toBeLessThanOrEqual(2);
  });
});
