/**
 * The blocker ranking (METHOD.md §7.3 and §11, P4-T15b-b, P9-T19a-a).
 *
 * **§7.3 states no ranking, and this file is where the derivation is written
 * down.** §7.3 gives the types, the clock, and one sentence about it: "a
 * blocker whose action passes that point is escalated to the coordinator, not
 * re-discussed". IMPLEMENTATION-PLAN asks for a board "ranked by age and
 * impact", so the order is derived from canon rather than invented: §11's
 * ladder for urgency, then §3.2's band for what is held up, then age.
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
import type { BlockerClock } from "../src/escalation.ts";
import { resolveThresholds } from "../src/thresholds.ts";

/** §11's own defaults. */
const CANON = resolveThresholds({});

/** Days to the check-in, and whether the one after has passed too. */
const clock = (
  daysUntilDue: number,
  followingPassed = false,
): BlockerClock => ({
  daysUntilDue,
  followingPassed,
});

const blocker = (
  nextAction: string,
  daysUntilDue: number,
  ageHours: number,
  blockedHealth: string | null = null,
  followingPassed = false,
): RankableBlocker => ({
  id: nextAction,
  type: "dependency",
  nextAction,
  ownerName: "Ada",
  ageHours,
  clock: clock(daysUntilDue, followingPassed),
  blockedHealth,
  blockedTitle: null,
});

const order = (input: readonly RankableBlocker[], sponsor = false) =>
  rankBlockers(input, CANON, sponsor).map((entry) => entry.nextAction);

describe("§11's ladder, on the check-in's clock", () => {
  it("reminds the day before the check-in, and tells the coordinator once it has passed", () => {
    expect(escalationFor(clock(6), CANON, false)).toBe("none");
    expect(escalationFor(clock(2), CANON, false)).toBe("none");
    expect(escalationFor(clock(1), CANON, false)).toBe("owner");
    expect(escalationFor(clock(0), CANON, false)).toBe("owner");
    expect(escalationFor(clock(-1), CANON, false)).toBe("coordinator");
  });

  it("reaches the sponsor only where the workspace adds them, a check-in later", () => {
    expect(escalationFor(clock(-8, true), CANON, false)).toBe("coordinator");
    expect(escalationFor(clock(-1, false), CANON, true)).toBe("coordinator");
    expect(escalationFor(clock(-8, true), CANON, true)).toBe("sponsor");
  });

  it("reads a workspace's own reminder, not the default", () => {
    const tuned = resolveThresholds({
      "cadence.blockerLadderDays": { reminder: 3 },
    });
    expect(escalationFor(clock(3), tuned, false)).toBe("owner");
    expect(escalationFor(clock(3), CANON, false)).toBe("none");
  });
});

describe("the order", () => {
  it("is the ladder first, whatever the ages say", () => {
    expect(
      order([
        blocker("young", 5, 2),
        blocker("coordinator", -2, 200),
        blocker("owner", 1, 140),
      ]),
    ).toEqual(["coordinator", "owner", "young"]);
  });

  it("puts the sponsor's above the coordinator's where the workspace adds them", () => {
    expect(
      order(
        [
          blocker("coordinator", -1, 200),
          blocker("sponsor", -9, 100, null, true),
        ],
        true,
      ),
    ).toEqual(["sponsor", "coordinator"]);
  });

  it("breaks a ladder tie on what is held up", () => {
    expect(
      order([
        blocker("holds up nothing named", -1, 30, null),
        blocker("holds up a caution", -1, 30, "caution"),
        blocker("holds up an off-track", -1, 30, "off_track"),
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
        blocker("newer", -1, 26, "off_track"),
        blocker("older", -1, 30, "off_track"),
      ]),
    ).toEqual(["older", "newer"]);
  });

  it("is stable, so a board does not shuffle between reads", () => {
    // Two blockers alike on all three keys. A reader who says "the third one"
    // has to be understood, so equal items keep the order they arrived in.
    const input = [blocker("first", 4, 30), blocker("second", 4, 30)];
    expect(order(input)).toEqual(["first", "second"]);
    expect(order(input)).toEqual(["first", "second"]);
  });

  it("marks a blocker past its check-in, and only then", () => {
    const ranked = rankBlockers(
      [blocker("past", -1, 25), blocker("on the day", 0, 150)],
      CANON,
      false,
    );
    expect(ranked[0]?.pastTheClock).toBe(true);
    expect(ranked[1]?.pastTheClock).toBe(false);
    // The clock stays inside the ranking and is not part of what it returns.
    expect(ranked[0]).not.toHaveProperty("clock");
  });

  it("keeps an empty board empty", () => {
    expect(rankBlockers([], CANON, false)).toEqual([]);
  });
});
