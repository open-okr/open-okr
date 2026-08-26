/**
 * The blocker ranking (METHOD.md §7.3 and §11, P4-T15b-b).
 *
 * **§7.3 states no ranking, and this file is where the derivation is written
 * down.** §7.3 gives the five types, the clock, and one sentence about it: "a
 * blocker that ages past it is escalated, not re-discussed".
 * IMPLEMENTATION-PLAN asks for a board "ranked by age and impact", so the order
 * is derived from canon rather than invented: §11's ladder for urgency, then
 * §3.2's band for what is held up, then age.
 *
 * If that reading is wrong, changing it will break these tests, which is the
 * point of writing it down here rather than in a sort function nobody reads.
 */
import { describe, expect, it } from "vitest";
import {
  escalationFor,
  type RankableBlocker,
  rankBlockers,
} from "../src/blocker-board.ts";

/** §11's own defaults. */
const LADDER = { owner: 20, coordinator: 24, sponsor: 48 };
const CLOCK = 24;

const blocker = (
  nextAction: string,
  ageHours: number,
  blockedHealth: string | null = null,
): RankableBlocker => ({
  id: nextAction,
  type: "dependency",
  nextAction,
  ownerName: "Ada",
  ageHours,
  blockedHealth,
  blockedTitle: null,
});

const order = (input: readonly RankableBlocker[]) =>
  rankBlockers(input, LADDER, CLOCK).map((entry) => entry.nextAction);

describe("§11's ladder", () => {
  it("fires at the hour, not after it", () => {
    // "Owner warned at twenty hours" is the wording. A ladder that fired at
    // twenty and one would warn nobody at twenty.
    expect(escalationFor(19, LADDER)).toBe("none");
    expect(escalationFor(20, LADDER)).toBe("owner");
    expect(escalationFor(24, LADDER)).toBe("coordinator");
    expect(escalationFor(48, LADDER)).toBe("sponsor");
    expect(escalationFor(1000, LADDER)).toBe("sponsor");
  });

  it("reads a workspace's own numbers, not the defaults", () => {
    // §11 is a registry a workspace tunes. A ranking that hardcoded 24 would
    // rank one workspace by another's rules.
    const tuned = { owner: 2, coordinator: 4, sponsor: 6 };
    expect(escalationFor(3, tuned)).toBe("owner");
    expect(escalationFor(7, tuned)).toBe("sponsor");
  });
});

describe("the order", () => {
  it("is the ladder first, whatever the ages say", () => {
    expect(
      order([
        blocker("young", 2),
        blocker("sponsor", 50),
        blocker("owner", 21),
      ]),
    ).toEqual(["sponsor", "owner", "young"]);
  });

  it("breaks a ladder tie on what is held up", () => {
    expect(
      order([
        blocker("holds up nothing named", 30, null),
        blocker("holds up a caution", 30, "caution"),
        blocker("holds up an off-track", 30, "off_track"),
      ]),
    ).toEqual([
      "holds up an off-track",
      "holds up a caution",
      "holds up nothing named",
    ]);
  });

  it("breaks the rest on age, oldest first", () => {
    expect(
      order([
        blocker("newer", 26, "off_track"),
        blocker("older", 30, "off_track"),
      ]),
    ).toEqual(["older", "newer"]);
  });

  it("is stable, so a board does not shuffle between reads", () => {
    // Two blockers alike on all three keys. A reader who says "the third one"
    // has to be understood, so equal items keep the order they arrived in.
    const input = [blocker("first", 30), blocker("second", 30)];
    expect(order(input)).toEqual(["first", "second"]);
    expect(order(input)).toEqual(["first", "second"]);
  });

  it("marks the clock separately from the ladder", () => {
    // The clock and the coordinator rung are both 24 by default and they are not
    // the same thing: a workspace can move one without the other.
    const ranked = rankBlockers(
      [blocker("past", 25), blocker("inside", 5)],
      LADDER,
      CLOCK,
    );
    expect(ranked[0]?.pastTheClock).toBe(true);
    expect(ranked[1]?.pastTheClock).toBe(false);

    const patient = rankBlockers([blocker("past", 25)], LADDER, 72);
    expect(patient[0]?.pastTheClock).toBe(false);
    expect(patient[0]?.escalation).toBe("coordinator");
  });

  it("keeps an empty board empty", () => {
    expect(rankBlockers([], LADDER, CLOCK)).toEqual([]);
  });
});
