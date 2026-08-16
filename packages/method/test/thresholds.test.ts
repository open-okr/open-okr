import { describe, expect, it } from "vitest";
import {
  canonThresholds,
  isThresholdKey,
  resolveThresholds,
  THRESHOLD_KEYS,
  THRESHOLDS,
  thresholdsInGroup,
  validateOverrides,
} from "../src/thresholds.ts";

/**
 * The METHOD.md §11 threshold registry (P3-T02).
 *
 * What these tests actually guard is the sentence §11 opens with: nothing
 * numeric is hardcoded anywhere else, and a value not in this registry is not a
 * setting. So they check that every parameter is complete and self-describing,
 * that an override is validated rather than trusted, that an unknown key is
 * reported rather than ignored, and that a resolved read never depends on a
 * stored value the schema would now refuse.
 *
 * The suite that checks these *defaults* against METHOD.md itself is P4-T01's
 * `pnpm method:check`. This one checks the registry's own invariants.
 */

describe("the registry is complete and self-describing", () => {
  it("has parameters", () => {
    expect(THRESHOLD_KEYS.length).toBeGreaterThan(40);
  });

  it("gives every parameter a label, a section, a reason and a default", () => {
    for (const key of THRESHOLD_KEYS) {
      const parameter = THRESHOLDS[key];
      expect(parameter.label, `${key} label`).toBeTruthy();
      // A parameter that cannot say which part of the canon it came from is a
      // number somebody invented, which is the thing §11 exists to prevent.
      expect(parameter.section, `${key} section`).toMatch(/^§/);
      expect(parameter.why.length, `${key} why`).toBeGreaterThan(20);
      expect(parameter.default, `${key} default`).not.toBe(undefined);
    }
  });

  it("accepts its own default for every parameter", () => {
    // A default the schema refuses would be a registry that cannot resolve
    // itself, and every engine takes the resolved set as an argument.
    for (const key of THRESHOLD_KEYS) {
      const parameter = THRESHOLDS[key];
      const parsed = parameter.schema.safeParse(parameter.default);
      expect(
        parsed.success,
        `${key}: ${JSON.stringify(parsed.error?.issues)}`,
      ).toBe(true);
    }
  });

  it("uses dotted keys whose prefix is the group they belong to", () => {
    for (const key of THRESHOLD_KEYS) {
      expect(key, `${key} shape`).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
      expect(key.split(".")[0]).toBe(THRESHOLDS[key].group);
    }
  });

  it("groups every parameter into exactly one card", () => {
    const groups = [
      "cadence",
      "scoring",
      "quality",
      "alignment",
      "kpi",
      "sessions",
    ] as const;
    const counted = groups.flatMap((group) => [...thresholdsInGroup(group)]);
    expect(counted.sort()).toEqual([...THRESHOLD_KEYS].sort());
  });

  it("recognises its own keys and nothing else", () => {
    expect(isThresholdKey("cadence.stalenessGraceDays")).toBe(true);
    expect(isThresholdKey("cadence.nope")).toBe(false);
    expect(isThresholdKey("")).toBe(false);
  });
});

describe("the canon defaults are the ones METHOD.md §11 prints", () => {
  const canon = canonThresholds();

  it("cadence and escalation", () => {
    expect(canon["cadence.checkInFrequency"]).toBe("weekly");
    expect(canon["cadence.anchorDay"]).toBe(1);
    expect(canon["cadence.toleranceDays"]).toBe(1);
    expect(canon["cadence.stalenessGraceDays"]).toBe(3);
    expect(canon["cadence.checkInLadderDays"]).toEqual({
      championRepeat: 1,
      coordinator: 7,
      sponsor: 14,
    });
    expect(canon["cadence.acknowledgementLadderDays"]).toEqual({
      nudge: 1,
      escalate: 3,
    });
    expect(canon["cadence.blockerClockHours"]).toBe(24);
    expect(canon["cadence.blockerLadderHours"]).toEqual({
      owner: 20,
      coordinator: 24,
      sponsor: 48,
    });
    expect(canon["cadence.nudgeCeilingPerWeek"]).toBe(10);
    expect(canon["cadence.publicationCountdownDays"]).toEqual([14, 7, 1]);
  });

  it("confidence and scoring", () => {
    expect(canon["scoring.confidenceHigh"]).toBe(0.7);
    expect(canon["scoring.confidenceLow"]).toBe(0.4);
    expect(canon["scoring.confidenceCritical"]).toBe(0.3);
    expect(canon["scoring.draftSandbagging"]).toBe(0.9);
    expect(canon["scoring.draftComfortable"]).toBe(0.75);
    expect(canon["scoring.draftAmbitious"]).toBe(0.25);
    expect(canon["scoring.scoreBands"]).toEqual({
      achieved: 0.9,
      strong: 0.7,
      partial: 0.4,
    });
    expect(canon["scoring.portfolioVerdicts"]).toEqual({
      tooSafe: 0.85,
      healthy: 0.6,
      partial: 0.4,
    });
    expect(canon["scoring.progressSignalPass"]).toBe(75);
    expect(canon["scoring.progressSignalFail"]).toBe(50);
  });

  it("quality and planning", () => {
    expect(canon["quality.coachStrictness"]).toBe("warn");
    expect(canon["quality.strengthScoreBands"]).toEqual({ red: 45, green: 75 });
    expect(canon["quality.keyResultsPerObjective"]).toEqual({
      low: 2,
      high: 5,
    });
    expect(canon["quality.objectiveLengthWords"]).toEqual({ low: 4, high: 18 });
    expect(canon["quality.companyObjectiveCap"]).toBe(5);
    expect(canon["quality.objectivesPerUnitCap"]).toBe(3);
    expect(canon["quality.strategicIssueBounds"]).toEqual({ low: 3, high: 10 });
    expect(canon["quality.priorityBounds"]).toEqual({ low: 3, high: 5 });
    expect(canon["quality.annualStrategyBounds"]).toEqual({ low: 2, high: 5 });
    expect(canon["quality.carryForwardIssueImpact"]).toBe(4);
    expect(canon["quality.inputPackLeadWorkingDays"]).toBe(3);
  });

  it("alignment", () => {
    expect(canon["alignment.healthyThreshold"]).toBe(75);
    expect(canon["alignment.penalties"]).toEqual({
      noAnchor: 10,
      orphan: 12,
      noKeyResults: 4,
      levelSkip: 3,
      silo: 8,
      floor: 5,
    });
  });

  it("KPIs and recovery", () => {
    expect(canon["kpi.healthyThreshold"]).toBe(90);
    expect(canon["kpi.watchThreshold"]).toBe(70);
    expect(canon["kpi.recoveryKeyResultCap"]).toBe(4);
    expect(canon["kpi.recoveryProposalDelayPeriods"]).toBe(2);
  });

  it("sessions", () => {
    expect(canon["sessions.weeklyMinutes"]).toEqual({ low: 15, high: 30 });
    expect(canon["sessions.quarterlyMinutes"]).toBe(60);
    expect(canon["sessions.weeklyCommitmentBounds"]).toEqual({
      low: 2,
      high: 3,
    });
    expect(canon["sessions.roomPulseBands"]).toEqual({ high: 4, low: 3 });
    expect(canon["sessions.diagnosticCycleScore"]).toBe(0.7);
    expect(canon["sessions.diagnosticRhythmScore"]).toBe(3.5);
  });
});

describe("validating an override map", () => {
  it("accepts a value inside its range", () => {
    const result = validateOverrides({ "cadence.stalenessGraceDays": 5 });
    expect(result.problems).toEqual([]);
    expect(result.overrides["cadence.stalenessGraceDays"]).toBe(5);
  });

  it("reports an unknown key rather than ignoring it", () => {
    // §11: "a value not in this registry is not a setting". Dropping it in
    // silence would let a workspace believe it had configured something.
    const result = validateOverrides({ "cadence.madeUp": 5 });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.key).toBe("cadence.madeUp");
    expect(result.overrides).toEqual({});
  });

  it("reports a value outside its range", () => {
    const result = validateOverrides({ "scoring.confidenceHigh": 1.4 });
    expect(result.problems).toHaveLength(1);
    expect(result.overrides).toEqual({});
  });

  it("reports a value of the wrong shape", () => {
    const result = validateOverrides({ "cadence.checkInFrequency": "hourly" });
    expect(result.problems).toHaveLength(1);
  });

  it("reports an incomplete composite rather than merging it", () => {
    // A half-set ladder would leave the missing step reading the canon default
    // while the admin believed they had set the whole thing.
    const result = validateOverrides({
      "cadence.blockerLadderHours": { owner: 12 },
    });
    expect(result.problems).toHaveLength(1);
  });

  it("refuses a bounds pair whose low exceeds its high", () => {
    const result = validateOverrides({
      "quality.keyResultsPerObjective": { low: 5, high: 2 },
    });
    expect(result.problems).toHaveLength(1);
  });

  it("reports every problem at once, and keeps what parsed", () => {
    const result = validateOverrides({
      "cadence.stalenessGraceDays": 5,
      "cadence.madeUp": 1,
      "scoring.confidenceHigh": 9,
    });
    expect(result.problems).toHaveLength(2);
    expect(result.overrides).toEqual({ "cadence.stalenessGraceDays": 5 });
  });

  it("refuses anything that is not an object", () => {
    for (const input of [null, 4, "x", [], undefined]) {
      expect(validateOverrides(input).problems.length).toBeGreaterThan(0);
    }
  });
});

describe("resolving", () => {
  it("returns the canon when nothing is overridden", () => {
    expect(resolveThresholds()).toEqual(canonThresholds());
    expect(resolveThresholds({})).toEqual(canonThresholds());
    expect(resolveThresholds(null)).toEqual(canonThresholds());
  });

  it("applies only the keys a workspace deviated on", () => {
    const resolved = resolveThresholds({ "cadence.stalenessGraceDays": 5 });
    expect(resolved["cadence.stalenessGraceDays"]).toBe(5);
    expect(resolved["cadence.toleranceDays"]).toBe(1);
  });

  it("falls back to the canon for a stored value the schema now refuses", () => {
    // Writes are validated at the boundary, so this state means the schema
    // tightened after the value was stored. A threshold that cannot be parsed
    // has no business deciding what a member sees; the canon default always can.
    const resolved = resolveThresholds({
      "cadence.stalenessGraceDays": 5,
      "scoring.confidenceHigh": 99,
    });
    expect(resolved["cadence.stalenessGraceDays"]).toBe(5);
    expect(resolved["scoring.confidenceHigh"]).toBe(0.7);
  });

  it("resolves fresh each time, so a change needs no restart", () => {
    // The §11 promise the admin screen depends on: nothing caches a threshold.
    const before = resolveThresholds({ "cadence.stalenessGraceDays": 3 });
    const after = resolveThresholds({ "cadence.stalenessGraceDays": 9 });
    expect(before["cadence.stalenessGraceDays"]).toBe(3);
    expect(after["cadence.stalenessGraceDays"]).toBe(9);
  });
});
