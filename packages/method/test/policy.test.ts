import { describe, expect, it } from "vitest";
import {
  type CycleFacts,
  decide,
  draftingWaitsForPhases,
  isEasing,
  type PolicyIntent,
  planningWindow,
  policyNeedsPhases,
} from "../src/policy.ts";
import {
  PROFILE_KEYS,
  type ProfileKey,
  resolvePractice,
} from "../src/practice.ts";
import { canonThresholds } from "../src/thresholds.ts";
import type { PhaseResult } from "../src/workflow.ts";

/**
 * The one policy (P9-T02, METHOD.md §2.3, §2.9).
 *
 * The matrix at the bottom is robustness rule R8's unit half: every profile
 * against every intent, at a moment inside the planning window and one outside
 * it, with the phases incomplete. Each cell is asserted, so a profile that
 * starts refusing what its §12.2 row says it allows fails here by name.
 */

const thresholds = canonThresholds();

const phase = (n: number, missing: string[] = []): PhaseResult => ({
  phase: n,
  title: `Phase ${n}`,
  state: missing.length === 0 ? "pass" : "todo",
  missing,
  blocked: [],
  conditions: { met: 0, total: missing.length },
});

/** Q1 2027, with phase 2 incomplete the way the demo's unscored prior cycle leaves it. */
const unready: CycleFacts = {
  mode: "quarterly",
  startsOn: "2027-01-01",
  today: "2026-12-16",
  phases: [
    phase(0),
    phase(1),
    phase(2, ["The prior cycle is not scored"]),
    phase(3),
    phase(4, ["Nothing drafted yet"]),
  ],
};

const ready: CycleFacts = {
  ...unready,
  phases: [
    phase(0),
    phase(1),
    phase(2),
    phase(3),
    phase(4, ["Nothing drafted yet"]),
  ],
};

const createObjective = (cycle: CycleFacts | null): PolicyIntent => ({
  kind: "objective.create",
  cycle,
});
const createKeyResult = (cycle: CycleFacts | null): PolicyIntent => ({
  kind: "keyResult.create",
  cycle,
});

describe("the recommended profile refuses nothing", () => {
  const practice = resolvePractice("recommended");

  it("lets anybody draft while earlier phases are incomplete", () => {
    expect(decide(createObjective(unready), practice, thresholds)).toEqual({
      outcome: "allow",
      rules: [],
      reasons: [],
    });
    expect(decide(createKeyResult(unready), practice, thresholds).outcome).toBe(
      "allow",
    );
  });

  it("lets anybody add an objective in week 9, long after the window", () => {
    const late = { ...unready, today: "2027-03-01" };
    expect(decide(createObjective(late), practice, thresholds).outcome).toBe(
      "allow",
    );
  });

  it("never needs the phases, so a caller can skip reading them", () => {
    expect(policyNeedsPhases(createObjective(unready), practice)).toBe(false);
    const { phases: _phases, ...withoutPhases } = unready;
    expect(
      decide(createObjective(withoutPhases), practice, thresholds).outcome,
    ).toBe("allow");
  });
});

describe("binding phases", () => {
  const practice = resolvePractice("recommended", {
    "phases.enforcement": "binding",
  });

  it("refuses drafting until phases 1 to 3 are complete, citing the setting and what is missing", () => {
    const decision = decide(createObjective(unready), practice, thresholds);
    expect(decision.outcome).toBe("block");
    expect(decision.rules).toEqual(["phases.enforcement"]);
    expect(decision.reasons[0]).toContain(
      "Phase 2: The prior cycle is not scored",
    );
    // Phase 4 is drafting itself, so its own gaps are never a reason to refuse it.
    expect(decision.reasons[0]).not.toContain("Phase 4");
  });

  it("allows drafting once phases 1 to 3 are complete", () => {
    expect(decide(createObjective(ready), practice, thresholds).outcome).toBe(
      "allow",
    );
  });

  it("never waits for phase 0, which an annual OKR itself completes", () => {
    const annual: CycleFacts = {
      ...ready,
      mode: "annual",
      phases: [
        phase(0, ["No annual OKR with key results"]),
        ...(ready.phases ?? []).slice(1),
      ],
    };
    expect(decide(createObjective(annual), practice, thresholds).outcome).toBe(
      "allow",
    );
  });

  it("refuses to answer without the phases rather than allowing by accident", () => {
    const { phases: _phases, ...withoutPhases } = unready;
    expect(policyNeedsPhases(createObjective(unready), practice)).toBe(true);
    expect(() =>
      decide(createObjective(withoutPhases), practice, thresholds),
    ).toThrow(/needs the cycle's phases/);
  });

  it("leaves an objective with its own timeframe alone", () => {
    expect(decide(createObjective(null), practice, thresholds).outcome).toBe(
      "allow",
    );
  });
});

describe("writing after the phases", () => {
  it("waits for the phases as binding does, and cites the writing setting", () => {
    const practice = resolvePractice("recommended", {
      "writing.when": "afterPhases",
    });
    expect(draftingWaitsForPhases(practice)).toBe(true);
    const decision = decide(createObjective(unready), practice, thresholds);
    expect(decision.outcome).toBe("block");
    expect(decision.rules).toEqual(["writing.when"]);
  });
});

describe("the planning window", () => {
  const practice = resolvePractice("recommended", {
    "writing.when": "planningWindow",
  });

  it("runs from planning-open to the close of the team publication window", () => {
    // 3 weeks before a quarter today, and 2 weeks into it (§11).
    expect(planningWindow(unready, thresholds)).toEqual({
      opensOn: "2026-12-11",
      closesOn: "2027-01-14",
    });
  });

  it("allows a new objective inside it and refuses one outside it", () => {
    for (const today of ["2026-12-11", "2027-01-01", "2027-01-14"]) {
      expect(
        decide(createObjective({ ...ready, today }), practice, thresholds)
          .outcome,
        today,
      ).toBe("allow");
    }
    for (const today of ["2026-12-10", "2027-01-15", "2027-03-01"]) {
      const decision = decide(
        createObjective({ ...ready, today }),
        practice,
        thresholds,
      );
      expect(decision.outcome, today).toBe("block");
      expect(decision.rules).toEqual(["writing.when"]);
      expect(decision.reasons[0]).toContain("2026-12-11 to 2027-01-14");
    }
  });

  it("keeps changes to existing objectives open, including a new key result", () => {
    expect(
      decide(
        createKeyResult({ ...ready, today: "2027-03-01" }),
        practice,
        thresholds,
      ).outcome,
    ).toBe("allow");
  });
});

describe("every profile against every intent", () => {
  // What §12.2 says each profile does with a new objective while phases 1 to
  // 3 are incomplete, inside the window and in week 9.
  const expected: Record<
    ProfileKey,
    { draftUnready: "allow" | "block"; objectiveLate: "allow" | "block" }
  > = {
    recommended: { draftUnready: "allow", objectiveLate: "allow" },
    googleStyle: { draftUnready: "allow", objectiveLate: "allow" },
    radicalFocus: { draftUnready: "allow", objectiveLate: "allow" },
    lightweight: { draftUnready: "allow", objectiveLate: "allow" },
    governed: { draftUnready: "block", objectiveLate: "block" },
  };

  for (const profile of PROFILE_KEYS) {
    it(`${profile}`, () => {
      const practice = resolvePractice(profile);
      expect(
        decide(createObjective(unready), practice, thresholds).outcome,
        "objective while phases are incomplete",
      ).toBe(expected[profile].draftUnready);
      expect(
        decide(createKeyResult(unready), practice, thresholds).outcome,
        "key result while phases are incomplete",
      ).toBe(expected[profile].draftUnready);
      expect(
        decide(
          createObjective({ ...ready, today: "2027-03-01" }),
          practice,
          thresholds,
        ).outcome,
        "objective in week 9",
      ).toBe(expected[profile].objectiveLate);
      expect(
        decide(
          createKeyResult({ ...ready, today: "2027-03-01" }),
          practice,
          thresholds,
        ).outcome,
        "key result in week 9",
      ).toBe("allow");
    });
  }
});

describe("publishing", () => {
  const publish = (cycle: CycleFacts): PolicyIntent => ({
    kind: "set.publish",
    cycle,
  });

  it("never waits on the recommended practice, and never needs the phases", () => {
    const practice = resolvePractice("recommended");
    expect(policyNeedsPhases(publish(unready), practice)).toBe(false);
    expect(decide(publish(unready), practice, thresholds).outcome).toBe(
      "allow",
    );
  });

  it("waits for phase 4 under binding phases, naming what drafting still misses", () => {
    const practice = resolvePractice("recommended", {
      "phases.enforcement": "binding",
    });
    expect(policyNeedsPhases(publish(unready), practice)).toBe(true);
    const decision = decide(publish(unready), practice, thresholds);
    expect(decision.outcome).toBe("block");
    expect(decision.rules).toEqual(["phases.enforcement"]);
    expect(decision.reasons[0]).toContain("Nothing drafted yet");
    const drafted: CycleFacts = {
      ...ready,
      phases: (ready.phases ?? []).map((result) =>
        result.phase === 4 ? phase(4) : result,
      ),
    };
    expect(decide(publish(drafted), practice, thresholds).outcome).toBe(
      "allow",
    );
  });
});

describe("the reviewer setting", () => {
  it("refuses an objective with no reviewer, or removing one, only where reviewers are required", () => {
    const optional = resolvePractice("recommended");
    const required = resolvePractice("recommended", { reviewer: "required" });
    const create: PolicyIntent = {
      kind: "objective.create",
      cycle: null,
      hasReviewer: false,
    };
    expect(decide(create, optional, thresholds).outcome).toBe("allow");
    const refused = decide(create, required, thresholds);
    expect(refused.outcome).toBe("block");
    expect(refused.rules).toEqual(["reviewer"]);
    expect(
      decide({ kind: "reviewer.remove" }, required, thresholds).outcome,
    ).toBe("block");
    expect(
      decide({ kind: "reviewer.remove" }, optional, thresholds).outcome,
    ).toBe("allow");
  });
});

describe("changing a target (P9-T06b, METHOD v2 §2.9)", () => {
  const required = resolvePractice("recommended");
  const optional = resolvePractice("recommended", {
    "reasons.easingTarget": "optional",
  });
  const change = (
    from: number,
    to: number,
    baseline: number,
    hasReason = false,
  ): PolicyIntent => ({
    kind: "target.change",
    from,
    to,
    baseline,
    hasReason,
  });

  it("judges easing by distance from the baseline, for an increase and a reduce alike", () => {
    // Increase from 40: 100 to 80 eases, 100 to 110 is harder.
    expect(isEasing({ from: 100, to: 80, baseline: 40 })).toBe(true);
    expect(isEasing({ from: 100, to: 110, baseline: 40 })).toBe(false);
    // Reduce from 100: 50 to 70 eases, 50 to 30 is harder.
    expect(isEasing({ from: 50, to: 70, baseline: 100 })).toBe(true);
    expect(isEasing({ from: 50, to: 30, baseline: 100 })).toBe(false);
    // The same target is no change at all.
    expect(isEasing({ from: 100, to: 100, baseline: 40 })).toBe(false);
  });

  it("refuses easing without a reason by default, citing the setting", () => {
    const refused = decide(change(100, 80, 40), required, thresholds);
    expect(refused.outcome).toBe("block");
    expect(refused.rules).toEqual(["reasons.easingTarget"]);
    expect(refused.reasons[0]).toMatch(
      /^Easing a target needs a written reason/,
    );
    expect(
      decide(change(100, 80, 40, true), required, thresholds).outcome,
    ).toBe("allow");
  });

  it("never asks a reason for a harder target", () => {
    expect(decide(change(100, 110, 40), required, thresholds).outcome).toBe(
      "allow",
    );
    expect(decide(change(50, 30, 100), required, thresholds).outcome).toBe(
      "allow",
    );
  });

  it("lets easing through without a reason where the workspace made it optional", () => {
    expect(decide(change(100, 80, 40), optional, thresholds).outcome).toBe(
      "allow",
    );
  });

  it("needs no phases to decide", () => {
    expect(policyNeedsPhases(change(100, 80, 40), required)).toBe(false);
  });
});
