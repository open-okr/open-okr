import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The feed reaches all four scopes S-31 names (P6-G11b, GAP-AUDIT G-01).
 *
 * **`queryFeed` could answer all four and only one was reachable.** P6-G11a
 * built the workspace feed at `/activity`; the space, goal and profile scopes
 * had no read action, so nothing could show them.
 *
 * The three reads and their access rules are proved against a real database in
 * `packages/core/test/activities.test.ts`. What is checked here is that each
 * surface carries the panel, and that each pages on its own url, which is what
 * "each scope pages independently" means for a screen.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const panel = at("../lib/feed-panel.tsx");

const SURFACES: ReadonlyArray<readonly [string, string, string]> = [
  ["../app/goals/[id]/page.tsx", "activities.goalFeed", "/goals/${id}"],
  ["../app/spaces/[id]/page.tsx", "activities.spaceFeed", "/spaces/${id}"],
  ["../app/people/[id]/page.tsx", "activities.profileFeed", "/people/${id}"],
];

describe("the feed at every scope", () => {
  test("each surface calls its own read and renders the panel", () => {
    for (const [path, action, base] of SURFACES) {
      const page = at(path);
      expect(page, action).toContain(`"${action}"`);
      expect(page, action).toContain("<FeedPanel");
      // Its own base path, so paging one feed does not move another.
      expect(page, action).toContain(base);
    }
  });

  test("the workspace scope still has its own screen", () => {
    // P6-G11a's page is untouched by this task, and a regression there would
    // be the easiest thing to miss.
    expect(at("../app/activity/page.tsx")).toContain(
      '"activities.workspaceFeed"',
    );
  });

  test("a half cursor is ignored rather than passed on", () => {
    // Both or neither: a half cursor is a link somebody edited by hand, and
    // sending it would be a schema refusal instead of a page.
    for (const [path] of SURFACES) {
      expect(at(path)).toContain("feedParams.at && feedParams.id");
    }
  });

  test("the panel names the actor from the directory, never from the row", () => {
    // A renderer describes the subject and never the actor, so a page that
    // read the actor's name off the row would print nothing.
    expect(panel).toContain("names.get(item.actorMemberId)");
    expect(panel).toContain('"OpenOKR"');
  });

  test("the older link carries the last row's own key", () => {
    // Which is what keeps a page stable while new rows arrive above it.
    expect(panel).toContain("const last = items.at(-1)");
    expect(panel).toContain("at=${encodeURIComponent(last.at)}&id=${last.id}");
  });
});
