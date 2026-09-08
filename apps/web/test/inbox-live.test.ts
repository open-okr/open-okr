import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The inbox's live insert (UIUX-PLAN §4 S-03, P6-G07c).
 *
 * P6-G07b was cut in two and this row owns the acceptance sentence: a row
 * arrives in an open inbox without a reload. The producing half, an outbox row
 * on the recipient's own channel, is proved against a real database in
 * `packages/core/test/notifications.test.ts`. The browser half is proved end to
 * end. What is checked here is the wiring the other two cannot see: that the
 * stream takes no resource id, that the page mounts the listener, and that the
 * client re-reads instead of drawing a row of its own.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const route = at("../app/api/inbox/live/route.ts");
const client = at("../app/inbox/inbox-live.tsx");
const page = at("../app/inbox/page.tsx");

describe("the inbox stream", () => {
  test("derives the channel from the session, and takes no id", () => {
    // The access check. The board and the session streams take a resource id
    // and prove the caller may read it; an inbox has no id to pass, so the
    // channel comes from `requireWorkspace()` and a caller cannot name
    // somebody else's. A route that accepted a member id would need a check
    // to refuse every value but one.
    expect(route).toContain("memberInboxChannel(");
    expect(route).toContain("workspace.memberId");
    expect(route).not.toContain("params");
    expect(route).toContain("status: 401");
  });

  test("the page mounts the listener", () => {
    expect(page).toContain("<InboxLive />");
  });

  test("the client re-reads rather than drawing the row itself", () => {
    // This is the deduplication answer. The event carries identifiers only, so
    // a row the client drew would have to be matched against the one the next
    // server render returns. Refreshing makes the server render the only
    // writer of the list, so there is nothing to deduplicate.
    expect(client).toContain('new EventSource("/api/inbox/live")');
    expect(client).toContain('addEventListener("inbox.added"');
    expect(client).toContain("router.refresh()");
    // And it closes the stream, or a reader who navigates away leaves a
    // LISTEN connection open on the server for the life of the tab.
    expect(client).toContain("source.close()");
  });
});
