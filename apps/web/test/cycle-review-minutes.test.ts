import { describe, expect, it } from "vitest";
import {
  type CycleSession,
  reviewMinutesFor,
} from "../lib/cycle-review-minutes.ts";

/**
 * A closed cycle links to its review minutes (sessions.md §9, release 0.7.0
 * S3): one link per review that was held, whichever space held it.
 */
const CYCLE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function session(overrides: Partial<CycleSession> & { id: string }) {
  return {
    cycleId: CYCLE,
    kind: "quarterly",
    title: "Quarterly review",
    spaceName: "Company",
    state: "closed",
    reviewPart: null,
    reviewSessionId: null,
    scheduledFor: "2027-03-29T09:00:00.000Z",
    startedAt: "2027-03-29T09:02:00.000Z",
    ...overrides,
  } satisfies CycleSession;
}

describe("reviewMinutesFor", () => {
  it("links each held review of the cycle, oldest first", () => {
    const minutes = reviewMinutesFor(CYCLE, [
      session({
        id: "b",
        spaceName: "Sales",
        startedAt: "2027-03-30T09:00:00.000Z",
      }),
      session({ id: "a" }),
    ]);
    expect(minutes).toEqual([
      {
        sessionId: "a",
        title: "Quarterly review",
        spaceName: "Company",
        heldOn: "2027-03-29T09:02:00.000Z",
      },
      {
        sessionId: "b",
        title: "Quarterly review",
        spaceName: "Sales",
        heldOn: "2027-03-30T09:00:00.000Z",
      },
    ]);
  });

  it("leaves out another cycle's review, a weekly session and a skipped one", () => {
    expect(
      reviewMinutesFor(CYCLE, [
        session({ id: "other", cycleId: OTHER }),
        session({ id: "none", cycleId: null }),
        session({ id: "weekly", kind: "weekly" }),
        session({ id: "skipped", state: "skipped", startedAt: null }),
      ]),
    ).toEqual([]);
  });

  it("leaves out a review that was never held, since its minutes are empty", () => {
    expect(
      reviewMinutesFor(CYCLE, [
        session({ id: "booked", state: "scheduled", startedAt: null }),
      ]),
    ).toEqual([]);
  });

  it("counts a review held apart from its retrospective once, at the review half", () => {
    const minutes = reviewMinutesFor(CYCLE, [
      session({
        id: "retro",
        title: "Quarterly retrospective",
        reviewPart: "retrospective",
        reviewSessionId: "review",
        startedAt: "2027-04-01T09:00:00.000Z",
      }),
      session({ id: "review", reviewPart: "review" }),
    ]);
    expect(minutes.map((one) => one.sessionId)).toEqual(["review"]);
    expect(minutes[0]?.heldOn).toBe("2027-03-29T09:02:00.000Z");
  });

  it("links the retrospective when its review half is not in the list", () => {
    // Either half's minutes are the whole review's (sessions.minutes).
    const minutes = reviewMinutesFor(CYCLE, [
      session({
        id: "retro",
        reviewPart: "retrospective",
        reviewSessionId: "gone",
      }),
    ]);
    expect(minutes.map((one) => one.sessionId)).toEqual(["retro"]);
  });

  it("lists a review whose review half was held and whose retrospective was not", () => {
    const minutes = reviewMinutesFor(CYCLE, [
      session({ id: "review", reviewPart: "review" }),
      session({
        id: "retro",
        reviewPart: "retrospective",
        reviewSessionId: "review",
        state: "scheduled",
        startedAt: null,
      }),
    ]);
    expect(minutes.map((one) => one.sessionId)).toEqual(["review"]);
  });
});
