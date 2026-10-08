import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { readScreen } from "./screen-text.ts";

/**
 * §7.5's moves row has a surface (P9-T19a-d-d).
 *
 * What a stop does to an objective, and what the record reads back, is proved
 * against a real database in `packages/core/test/monthly-review.test.ts`. What
 * is checked here is the wiring: that the review stops through the one write
 * §2.9's rules live in, rather than a second path that could skip the reason.
 */

const at = (path: string) =>
  readScreen(fileURLToPath(new URL(path, import.meta.url)));

const actions = at("../app/session/[id]/actions.ts");
const panel = at("../app/session/[id]/monthly-review.tsx");
const page = at("../app/session/[id]/page.tsx");

describe("the monthly review's moves", () => {
  test("stop through goals.stop, the write that keeps §2.9's reason", () => {
    expect(actions).toContain('"goals.stop"');
    expect(panel).toContain("stopObjectiveAction");
  });

  test("read the stops and the updates the record returns", () => {
    expect(page).toContain("stops={monthly.stops}");
    expect(page).toContain("updates={monthly.updates}");
  });

  test("choose no objective for the room", () => {
    // A stop closes an objective. The first in the list is not one anybody
    // chose, so the select starts empty and the button stays off until both
    // an objective and a reason are given.
    expect(panel).toContain('useState("")');
    expect(panel).toContain('<option value="">');
    expect(panel).toContain('stopGoalId === ""');
    expect(panel).toContain("stopReason.trim().length === 0");
  });
});
