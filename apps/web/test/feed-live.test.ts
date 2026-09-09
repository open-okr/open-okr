import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The feed's live insert at every scope (S-31, P6-G11c).
 *
 * The producing half, one thin outbox row per activity, is proved against a
 * real database in `packages/core/test/activities.test.ts`. The browser half is
 * proved end to end. What is checked here is the wiring neither of those can
 * see: that each scope authorises through its own read, that nothing about the
 * event reaches the browser, and that all four scopes are actually mounted.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const route = at("../app/api/feed/live/route.ts");
const client = at("../lib/feed-live.tsx");
const panel = at("../lib/feed-panel.tsx");

const SURFACES: ReadonlyArray<readonly [string, string]> = [
  ["../app/goals/[id]/page.tsx", "goal"],
  ["../app/spaces/[id]/page.tsx", "space"],
  ["../app/people/[id]/page.tsx", "profile"],
];

describe("the feed stream", () => {
  test("authorises each scope through that scope's own read", () => {
    // A failed read is a 404 rather than an open stream that never carries
    // anything, which is the board route's rule. Here it also settles what the
    // stream may say: a reader who could not open the panel never opens the
    // stream behind it.
    expect(route).toContain('"activities.workspaceFeed"');
    expect(route).toContain('"activities.spaceFeed"');
    expect(route).toContain('"activities.goalFeed"');
    expect(route).toContain('"activities.profileFeed"');
    expect(route).toContain("status: 404");
    expect(route).toContain("status: 401");
    // An unknown scope, or a scope with no subject, is refused before any read.
    expect(route).toContain("status: 400");
  });

  test("sends a bare ping, so nothing about the event reaches a browser", () => {
    // The event on the channel carries an activity id and an actor. The route
    // reads both and forwards neither: a member learns their feed may have
    // moved and nothing about what moved or where.
    expect(route).toContain('"event: feed.changed\\ndata: {}\\n\\n"');
    // And a member is not pinged for their own write, compared on the server
    // so the actor's id stays there.
    expect(route).toContain("event.data?.actorMemberId === memberId");
  });

  test("the client re-reads, coalescing a burst into one refresh", () => {
    expect(client).toContain('addEventListener("feed.changed"');
    expect(client).toContain("router.refresh()");
    expect(client).toContain("setTimeout(");
    // A stream left open outlives the page that opened it.
    expect(client).toContain("source.close()");
  });

  test("all four scopes mount it", () => {
    // The workspace scope renders its own list rather than the shared panel,
    // so it mounts the component directly and would be the easy one to miss.
    expect(at("../app/activity/page.tsx")).toContain(
      '<FeedLive scope="workspace" />',
    );
    expect(panel).toContain("<FeedLive");
    for (const [path, scope] of SURFACES) {
      expect(at(path), scope).toContain(`scope: "${scope}"`);
    }
  });

  test("a paged view does not refresh under the reader", () => {
    // Paging is a link, so a later page is a window the reader chose. Moving
    // its boundary while they read across it is worse than showing them a
    // page that is a few seconds old.
    expect(panel).toContain("live && !paged");
    expect(at("../app/activity/page.tsx")).toContain("cursor ? null :");
  });
});
