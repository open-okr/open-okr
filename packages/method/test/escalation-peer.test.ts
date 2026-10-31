import { describe, expect, it } from "vitest";
import { escalation } from "../src/escalation.ts";
import { canonThresholds } from "../src/thresholds.ts";

/**
 * §12's "Peer step in the check-in ladder" (OKRGoal UX review, backlog 15):
 * "Escalation stays, but starts later and goes to peers before it goes up the
 * hierarchy." Off by default, so the ladder a workspace has today is unchanged
 * until it chooses otherwise.
 */
const thresholds = canonThresholds();
const grace = thresholds["cadence.stalenessGraceDays"];
const { coordinator } = thresholds["cadence.checkInLadderDays"];

describe("the peer step", () => {
  it("leaves the ladder as it is while off", () => {
    expect(escalation(grace + 1, grace, thresholds).targets).toEqual([
      "champion",
      "reviewer",
    ]);
  });

  it("asks one peer instead of the reviewer once grace is exceeded", () => {
    expect(escalation(grace + 1, grace, thresholds, false, true)).toEqual({
      step: 3,
      targets: ["champion", "peer"],
    });
  });

  it("brings the reviewer in at the coordinator's day, and drops the peer", () => {
    expect(
      escalation(coordinator, grace, thresholds, false, true).targets,
    ).toEqual(["champion", "reviewer", "coordinator"]);
  });

  it("changes nothing before grace", () => {
    expect(escalation(1, grace, thresholds, false, true)).toEqual(
      escalation(1, grace, thresholds),
    );
  });
});
