import { TranslationsProvider } from "@openokr/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  type NudgeEntry,
  NudgeProvenance,
} from "../app/review/nudge-provenance.tsx";

/**
 * "Why you got nudged" on the review inbox (OKRGoal UX review, T9 and H5).
 *
 * A nudge recorded but not yet delivered has no sent time, and the row
 * printed "Sent ." with nothing between the words. The snooze note read as
 * blame ("It does not clear what you owe, and the list above will not move").
 */

vi.mock("../app/review/actions.ts", () => ({ snoozeNudge: vi.fn() }));

const nudge = (overrides: Partial<NudgeEntry>): NudgeEntry => ({
  id: "33333333-3333-4333-8333-333333333333",
  ruleKey: "checkin.due",
  escalationStep: 1,
  sentAt: "2026-10-12T09:00:00Z",
  suppressedReason: null,
  channel: "in_app",
  ...overrides,
});

const render = (nudges: readonly NudgeEntry[]) =>
  renderToStaticMarkup(
    <TranslationsProvider locale="en">
      <NudgeProvenance nudges={nudges} />
    </TranslationsProvider>,
  );

describe("why you got nudged", () => {
  it("never prints an empty sent time", () => {
    for (const sentAt of [null, ""]) {
      const html = render([nudge({ sentAt })]);
      expect(html).not.toContain("Sent .");
      expect(html).toContain("Not sent yet.");
    }
  });

  it("prints the sent time when there is one", () => {
    expect(render([nudge({})])).toMatch(/Sent \S/);
  });

  it("says what a snooze does without blaming the reader", () => {
    const html = render([nudge({})]);
    expect(html).toContain(
      "Snoozing pauses these messages for a week. Your open items stay on the list.",
    );
    expect(html).not.toContain("will not move");
  });
});
