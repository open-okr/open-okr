import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NOTIFICATION_REASONS } from "@openokr/db";
import { describe, expect, test } from "vitest";

/**
 * The watch control reaches every subject that has a subscription list
 * (S-03, P6-G07b).
 *
 * **`subscriptions.toggle` shipped at P2-T06 and no page ever called it.** It
 * could subscribe and unsubscribe, and nothing could answer "am I watching
 * this", so the only control anybody could have built was a button that
 * guessed its own state. That is why six detail pages had none.
 *
 * The read, the toggle and the visibility rule are proved against a real
 * database in `packages/core`. What is checked here is that all six pages
 * carry the control, and that the reasons it renders come from the table
 * rather than from a list typed into the component.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const control = at("../lib/watch-control.tsx");
const action = at("../lib/watch-action.ts");

/** Every detail page §6 gives a subscription list, and its subject type. */
const PAGES: ReadonlyArray<readonly [string, string]> = [
  ["../app/goals/[id]/page.tsx", "goal"],
  ["../app/initiatives/[id]/page.tsx", "initiative"],
  ["../app/tasks/[id]/page.tsx", "task"],
  ["../app/documents/[id]/page.tsx", "document"],
  ["../app/kpis/[id]/page.tsx", "kpi"],
  ["../app/spaces/[id]/page.tsx", "space"],
];

describe("the watch control", () => {
  test("is on all six subjects the task names", () => {
    for (const [path, subjectType] of PAGES) {
      const page = at(path);
      expect(page, `${subjectType} page`).toContain("<WatchControl");
      expect(page, `${subjectType} page`).toContain(
        `subjectType="${subjectType}"`,
      );
      // And each reads its own state server-side, so the first paint is right
      // rather than a button that flickers into its real state.
      expect(page, `${subjectType} page`).toContain('"subscriptions.read"');
    }
  });

  test("calls the read that P6-G07b added beside the toggle", () => {
    expect(action).toContain('"subscriptions.toggle"');
    expect(action).toContain('"subscriptions.read"');
  });

  test("names every reason the table can store", () => {
    // A reason the component does not know would render as nothing at all,
    // which is worse than the raw word: the member would be told they are
    // watching and not told why.
    for (const reason of NOTIFICATION_REASONS) {
      expect(control, `no wording for ${reason}`).toContain(`${reason}:`);
    }
  });

  test("says when turning a watch off does not end the obligation", () => {
    // §6.4's rule that a snooze never hides a review obligation, one layer
    // down: a member subscribed because they are the reviewer should not
    // discover later that they switched an obligation off.
    expect(control).toContain("Turning this off does not remove the");
    expect(control).toContain(
      'OBLIGATION = new Set(["review", "role", "check_in"])',
    );
  });

  test("returns the new state rather than nothing", () => {
    // A control that toggled and then refetched would show a stale watcher
    // count for as long as the second call took.
    expect(action).toContain("Promise<WatchState | { error: string }>");
  });
});
