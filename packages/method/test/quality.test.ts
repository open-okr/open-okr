import { describe, expect, it } from "vitest";
import {
  ALIGNMENT_CHECKS,
  applyStrictness,
  CYCLE_CHECKS,
  evaluateAlignment,
  evaluateCycle,
  evaluateKeyResults,
  evaluateObjective,
  KEY_RESULT_CHECKS,
  type KeyResultInput,
  OBJECTIVE_CHECKS,
  QUALITY_WORD_LISTS,
  strengthScore,
} from "../src/quality.ts";
import { canonThresholds } from "../src/thresholds.ts";

/**
 * The objective half of METHOD.md §4's quality catalogue (P4-T01).
 *
 * The cases are the corpus entries in `docs/design/p4-t00-method-package.md`
 * §15, which the human approved at the P4-T00 gate. They are the verdicts a
 * facilitator said were right, so they are what the engine has to produce.
 */

const thresholds = canonThresholds();

const verdict = (id: string, result: ReturnType<typeof evaluateObjective>) =>
  result.find((entry) => entry.id === id)?.status;

describe("the catalogue as data", () => {
  it("carries the five objective checks with their prompts", () => {
    expect(OBJECTIVE_CHECKS).toHaveLength(5);
    for (const check of OBJECTIVE_CHECKS) {
      expect(check.conditions.length).toBeGreaterThan(0);
      for (const row of check.conditions) {
        // A verdict with no coaching prompt is a rejection with no way out,
        // which is the one thing §4 never does.
        expect(row.prompt.length).toBeGreaterThan(20);
      }
    }
  });

  it("keeps the §4.1 word lists as data", () => {
    expect(QUALITY_WORD_LISTS.outputVerbs).toContain("launch");
    expect(QUALITY_WORD_LISTS.movementVerbs).toContain("increase");
    expect(QUALITY_WORD_LISTS.stateWords).toContain("become");
    expect(QUALITY_WORD_LISTS.whyMarkers).toContain("so that");
  });
});

describe("corpus entry 1: an output-shaped objective", () => {
  const result = evaluateObjective(
    {
      title: "Launch the new mobile app by end of Q3",
      hasCycle: true,
      hasTimeframe: false,
      championId: "m1",
      reviewerId: "m2",
      objectivesInUnit: 1,
      level: "team",
    },
    thresholds,
  );

  it("fails OBJ-1 because it starts with an output verb", () => {
    expect(verdict("OBJ-1", result)).toBe("fail");
  });

  it("passes the rest", () => {
    expect(verdict("OBJ-2", result)).toBe("pass");
    expect(verdict("OBJ-3", result)).toBe("pass");
    expect(verdict("OBJ-4", result)).toBe("pass");
    expect(verdict("OBJ-5", result)).toBe("pass");
  });
});

describe("corpus entry 2: a metric as the objective", () => {
  const result = evaluateObjective(
    {
      title: "Increase revenue by 30%",
      hasCycle: true,
      hasTimeframe: false,
      championId: "m1",
      reviewerId: "m2",
      objectivesInUnit: 1,
      level: "team",
    },
    thresholds,
  );

  it("fails OBJ-1: movement with no why is a key result in disguise", () => {
    expect(verdict("OBJ-1", result)).toBe("fail");
  });

  it("warns OBJ-2 on the digits", () => {
    expect(verdict("OBJ-2", result)).toBe("warn");
  });
});

describe("corpus entry 3: a strong outcome objective", () => {
  const result = evaluateObjective(
    {
      title: "Become the preferred platform for mid-market teams",
      hasCycle: true,
      hasTimeframe: false,
      championId: "m1",
      reviewerId: "m2",
      objectivesInUnit: 1,
      level: "company",
    },
    thresholds,
  );

  it("passes every check", () => {
    expect(result.every((entry) => entry.status === "pass")).toBe(true);
  });

  it("scores 100", () => {
    expect(strengthScore(result)).toBe(100);
  });
});

describe("the refusals that are not about wording", () => {
  const base = {
    title: "Become the preferred platform for mid-market teams",
    hasCycle: false,
    hasTimeframe: false,
    championId: "m1",
    reviewerId: "m2",
    objectivesInUnit: 1,
    level: "team" as const,
  };

  it("fails OBJ-3 with neither a cycle nor a timeframe", () => {
    expect(verdict("OBJ-3", evaluateObjective(base, thresholds))).toBe("fail");
  });

  it("fails OBJ-4 with no reviewer", () => {
    const result = evaluateObjective(
      { ...base, hasCycle: true, reviewerId: null },
      thresholds,
    );
    expect(verdict("OBJ-4", result)).toBe("fail");
  });

  it("warns OBJ-5 above three in a unit, and fails above five at company", () => {
    const warned = evaluateObjective(
      { ...base, hasCycle: true, objectivesInUnit: 4 },
      thresholds,
    );
    expect(verdict("OBJ-5", warned)).toBe("warn");
    const failed = evaluateObjective(
      { ...base, hasCycle: true, objectivesInUnit: 6, level: "company" },
      thresholds,
    );
    expect(verdict("OBJ-5", failed)).toBe("fail");
  });
});

describe("the strength score", () => {
  it("is METHOD.md's own formula: (passes + half the warns) over evaluated", () => {
    const result = evaluateObjective(
      {
        title: "Increase revenue by 30%",
        hasCycle: true,
        hasTimeframe: false,
        championId: "m1",
        reviewerId: "m2",
        objectivesInUnit: 1,
        level: "team",
      },
      thresholds,
    );
    // OBJ-1 fail, OBJ-2 warn, OBJ-3/4/5 pass: (3 + 0.5) / 5 = 70.
    expect(strengthScore(result)).toBe(70);
  });
});

/**
 * §4.2's seven key result checks.
 *
 * The worked case is corpus entry 4, "activity-shaped key results", which the
 * human approved at the gate with a verdict written out per check. It is the
 * only corpus entry that names a per-key-result verdict rather than a set one,
 * so it pins both halves of the shape at once.
 */
const activityShaped: KeyResultInput[] = [
  {
    text: "Hold 12 customer interviews per month",
    baseline: 0,
    target: 12,
    dueOn: "2026-09-30",
    ownerId: "m1",
    indicatorType: "leading",
    direction: "increase",
    confidence: 0.6,
  },
  {
    text: "Send 50 personalised outreach emails",
    baseline: 0,
    target: 50,
    dueOn: "2026-09-30",
    ownerId: "m1",
    indicatorType: "leading",
    direction: "increase",
    confidence: 0.6,
  },
  {
    text: "Complete the onboarding redesign",
    baseline: 0,
    target: 1,
    dueOn: "2026-09-30",
    ownerId: "m1",
    indicatorType: "leading",
    direction: "move",
    confidence: 0.6,
  },
];

const krVerdict = (id: string, result: ReturnType<typeof evaluateKeyResults>) =>
  result.find((entry) => entry.id === id);

describe("the key result catalogue as data", () => {
  it("carries the seven key result checks with their prompts", () => {
    expect(KEY_RESULT_CHECKS).toHaveLength(7);
    for (const check of KEY_RESULT_CHECKS) {
      expect(check.conditions.length).toBeGreaterThan(0);
      for (const row of check.conditions) {
        expect(row.prompt.length).toBeGreaterThan(20);
      }
    }
  });

  it("keeps the §4.2 word lists as data", () => {
    expect(QUALITY_WORD_LISTS.activityNouns).toContain("interview");
    expect(QUALITY_WORD_LISTS.activityNouns).toContain("interviews");
    expect(QUALITY_WORD_LISTS.impactWords).toContain("activation");
    expect(QUALITY_WORD_LISTS.impactWords).toContain("win rate");
  });
});

describe("corpus entry 4: activity-shaped key results", () => {
  const result = evaluateKeyResults({ keyResults: activityShaped }, thresholds);

  it("passes KR-1 on three key results", () => {
    expect(krVerdict("KR-1", result)?.status).toBe("pass");
  });

  /**
   * The corpus and METHOD.md disagree here, and METHOD.md wins.
   *
   * The corpus scores KR-2 as "warn (KR3)" with the reason "KR3 has only 1
   * number". KR3's text is "Complete the onboarding redesign", which carries
   * no numbers at all; the 0 and the 1 are its baseline and target fields.
   * METHOD.md §4.2 measures the text ("pass when the text reads 'from X to Y'
   * or carries two numbers"), and §4.6's own strong example writes the numbers
   * into the text: "Increase NPS from 32 to 50".
   *
   * Read that way the set is warn, warn, fail, so the roll-up is a fail and
   * every one of the three is an offender. Recorded on the P4-T01 row as a
   * question for a human, because a corpus entry is an approved expectation
   * and changing what it means is not a developer's call.
   */
  it("fails KR-2, because the third carries no numbers in its text", () => {
    const kr2 = krVerdict("KR-2", result);
    expect(kr2?.status).toBe("fail");
    expect(kr2?.keyResults).toEqual([0, 1, 2]);
  });

  it("passes KR-3 because all three have a baseline and a target", () => {
    expect(krVerdict("KR-3", result)?.status).toBe("pass");
  });

  it("warns KR-4 because every one of them is leading", () => {
    expect(krVerdict("KR-4", result)?.status).toBe("warn");
  });

  it("fails KR-5, and names all three offenders", () => {
    const kr5 = krVerdict("KR-5", result);
    expect(kr5?.status).toBe("fail");
    expect(kr5?.keyResults).toEqual([0, 1, 2]);
  });

  it("passes KR-7 because every one carries a direction", () => {
    expect(krVerdict("KR-7", result)?.status).toBe("pass");
  });
});

describe("the checks METHOD.md words but corpus entry 4 does not exercise", () => {
  const one = (over: Partial<KeyResultInput>): KeyResultInput => ({
    text: "Raise activation from 41% to 60%",
    baseline: 41,
    target: 60,
    dueOn: "2026-09-30",
    ownerId: "m1",
    indicatorType: "lagging",
    direction: "increase",
    confidence: 0.5,
    ...over,
  });

  it("fails KR-1 with none, warns with one, fails above five", () => {
    expect(
      krVerdict("KR-1", evaluateKeyResults({ keyResults: [] }, thresholds))
        ?.status,
    ).toBe("fail");
    expect(
      krVerdict(
        "KR-1",
        evaluateKeyResults({ keyResults: [one({})] }, thresholds),
      )?.status,
    ).toBe("warn");
    const six = Array.from({ length: 6 }, () => one({}));
    expect(
      krVerdict("KR-1", evaluateKeyResults({ keyResults: six }, thresholds))
        ?.status,
    ).toBe("fail");
  });

  it("fails KR-2 on a key result with no numbers at all", () => {
    const result = evaluateKeyResults(
      { keyResults: [one({ text: "Improve customer satisfaction" })] },
      thresholds,
    );
    expect(krVerdict("KR-2", result)?.status).toBe("fail");
  });

  it("fails KR-3 when a baseline is missing, and names which one", () => {
    const result = evaluateKeyResults(
      { keyResults: [one({}), one({ baseline: null })] },
      thresholds,
    );
    const kr3 = krVerdict("KR-3", result);
    expect(kr3?.status).toBe("fail");
    expect(kr3?.keyResults).toEqual([1]);
  });

  it("fails KR-4 on an untagged key result, before it looks at the mix", () => {
    const result = evaluateKeyResults(
      { keyResults: [one({}), one({ indicatorType: null })] },
      thresholds,
    );
    expect(krVerdict("KR-4", result)?.status).toBe("fail");
  });

  it("passes KR-4 on a set holding one of each", () => {
    const result = evaluateKeyResults(
      { keyResults: [one({}), one({ indicatorType: "leading" })] },
      thresholds,
    );
    expect(krVerdict("KR-4", result)?.status).toBe("pass");
  });

  it("warns KR-4 when every one of them is lagging", () => {
    const result = evaluateKeyResults(
      { keyResults: [one({}), one({})] },
      thresholds,
    );
    expect(krVerdict("KR-4", result)?.status).toBe("warn");
  });

  it("passes KR-6 in the sweet spot and warns on a sandbagged set", () => {
    expect(
      krVerdict(
        "KR-6",
        evaluateKeyResults(
          { keyResults: [one({ confidence: 0.5 }), one({ confidence: 0.6 })] },
          thresholds,
        ),
      )?.status,
    ).toBe("pass");
    expect(
      krVerdict(
        "KR-6",
        evaluateKeyResults(
          {
            keyResults: [one({ confidence: 0.95 }), one({ confidence: 0.95 })],
          },
          thresholds,
        ),
      )?.status,
    ).toBe("warn");
  });

  it("leaves KR-6 as todo while nobody has set a confidence", () => {
    const result = evaluateKeyResults(
      { keyResults: [one({ confidence: null })] },
      thresholds,
    );
    expect(krVerdict("KR-6", result)?.status).toBe("todo");
  });

  it("fails KR-7 on a key result with no direction", () => {
    const result = evaluateKeyResults(
      { keyResults: [one({ direction: null })] },
      thresholds,
    );
    expect(krVerdict("KR-7", result)?.status).toBe("fail");
  });
});

describe("corpus entry 8: strictness promotes every warn to a fail", () => {
  const borderline = evaluateObjective(
    {
      title: "Make mobile the way our customers launch their day",
      hasCycle: true,
      hasTimeframe: false,
      championId: "m1",
      reviewerId: "m2",
      objectivesInUnit: 5,
      level: "company",
    },
    thresholds,
  );

  it("leaves the verdicts alone in warn mode", () => {
    expect(applyStrictness(borderline, "warn")).toEqual(borderline);
  });

  it("turns OBJ-1's warn into a fail in strict mode, keeping the prompt", () => {
    const strict = applyStrictness(borderline, "strict");
    const obj1 = strict.find((entry) => entry.id === "OBJ-1");
    expect(verdict("OBJ-1", borderline)).toBe("warn");
    expect(obj1?.status).toBe("fail");
    expect(obj1?.prompt).toBe(
      borderline.find((entry) => entry.id === "OBJ-1")?.prompt,
    );
  });

  it("moves the strength score, because a fail scores nothing", () => {
    const warned = strengthScore(borderline);
    const strict = strengthScore(applyStrictness(borderline, "strict"));
    expect(warned).not.toBeNull();
    expect(strict as number).toBeLessThan(warned as number);
  });
});

describe("the objective length bounds come from the §11 registry", () => {
  it("reads quality.objectiveLengthWords rather than carrying its own 4 and 18", () => {
    const bounds = canonThresholds()["quality.objectiveLengthWords"];
    const short = Array.from({ length: bounds.low - 1 }, () => "word").join(
      " ",
    );
    const long = Array.from({ length: bounds.high + 1 }, () => "word").join(
      " ",
    );
    const base = {
      hasCycle: true,
      hasTimeframe: false,
      championId: "m1",
      reviewerId: "m2",
      objectivesInUnit: 1,
      level: "team" as const,
    };
    expect(
      verdict(
        "OBJ-2",
        evaluateObjective({ ...base, title: short }, thresholds),
      ),
    ).toBe("warn");
    expect(
      verdict("OBJ-2", evaluateObjective({ ...base, title: long }, thresholds)),
    ).toBe("warn");
  });
});

/**
 * §4.3, read from the alignment engine rather than decided a second time.
 *
 * Corpus entry 5 is the setup: two department objectives, no company anchor,
 * one team goal skipping to company, one department with no horizontal
 * dependency. The engine produces those findings; this asserts the catalogue
 * turns them into verdicts a writer can act on.
 */
describe("corpus entry 5: alignment gaps", () => {
  const result = evaluateAlignment({
    findings: [{ ruleKey: "AL-4" }, { ruleKey: "AL-3" }, { ruleKey: "AL-6" }],
    everyDependencyResolved: true,
  });
  const at = (id: string) => result.find((entry) => entry.id === id);

  it("passes AL-1, because the engine raised nothing against it", () => {
    expect(at("AL-1")?.status).toBe("pass");
  });

  it("passes AL-2, which the schema settles rather than the coach", () => {
    expect(at("AL-2")?.status).toBe("pass");
  });

  it("warns AL-3 on the skip and fails AL-4 on the missing anchor", () => {
    expect(at("AL-3")?.status).toBe("warn");
    expect(at("AL-4")?.status).toBe("fail");
  });

  it("warns AL-6 on the silo", () => {
    expect(at("AL-6")?.status).toBe("warn");
  });

  it("carries a prompt on every one of the six", () => {
    expect(ALIGNMENT_CHECKS).toHaveLength(6);
    expect(result).toHaveLength(6);
    for (const entry of result) {
      expect(entry.prompt.length).toBeGreaterThan(20);
    }
    for (const check of ALIGNMENT_CHECKS) {
      for (const row of check.conditions) {
        expect(row.prompt.length).toBeGreaterThan(20);
      }
    }
  });
});

describe("AL-5, which lives in the dependency register", () => {
  it("is todo while nobody has answered, not a pass", () => {
    const result = evaluateAlignment({
      findings: [],
      everyDependencyResolved: null,
    });
    expect(result.find((entry) => entry.id === "AL-5")?.status).toBe("todo");
  });

  it("fails when a cross-team dependency is neither confirmed nor risk-owned", () => {
    const result = evaluateAlignment({
      findings: [],
      everyDependencyResolved: false,
    });
    expect(result.find((entry) => entry.id === "AL-5")?.status).toBe("fail");
  });
});

/**
 * §4.4, driven by corpus entry 6: "cycle readiness".
 *
 * Input pack with 4 items of 7, no prior cycle score, 3 strategic issues,
 * 4 priorities, not-doing list empty, capacity unchecked, one unconfirmed
 * dependency, no sessions booked. The human approved a verdict per check at
 * the gate, so those are the verdicts.
 */
describe("corpus entry 6: cycle readiness", () => {
  const result = evaluateCycle(
    {
      gates: [
        { gateKey: 4, passed: false },
        { gateKey: 5, passed: false },
      ],
      packComplete: false,
      packLeadWorkingDays: null,
      priorCycleScored: false,
      firstCycle: false,
      issueCount: 3,
      issuesRanked: true,
      priorityCount: 4,
      prioritiesWithSuccess: 4,
      notDoingWritten: false,
      sessionsBookedForWholeCycle: false,
    },
    thresholds,
  );
  const at = (id: string) => result.find((entry) => entry.id === id)?.status;

  it("fails CY-1 on an incomplete pack", () => {
    expect(at("CY-1")).toBe("fail");
  });

  it("fails CY-2: no prior score and not declared the first cycle", () => {
    expect(at("CY-2")).toBe("fail");
  });

  it("passes CY-3 at three issues, which is the floor since 2026-08-17", () => {
    expect(at("CY-3")).toBe("pass");
  });

  it("passes CY-4 at four priorities, each with a success statement", () => {
    expect(at("CY-4")).toBe("pass");
  });

  it("fails CY-5, CY-6, CY-7 and CY-8", () => {
    expect(at("CY-5")).toBe("fail");
    expect(at("CY-6")).toBe("fail");
    expect(at("CY-7")).toBe("fail");
    expect(at("CY-8")).toBe("fail");
  });

  it("counts none of them towards the strength score", () => {
    expect(result).toHaveLength(8);
    expect(result.every((entry) => !entry.feedsStrengthScore)).toBe(true);
    expect(strengthScore(result)).toBeNull();
  });

  it("carries a prompt on every condition of every cycle check", () => {
    expect(CYCLE_CHECKS).toHaveLength(8);
    for (const check of CYCLE_CHECKS) {
      for (const row of check.conditions) {
        expect(row.prompt.length).toBeGreaterThan(20);
      }
    }
  });
});

describe("the cycle checks read the §11 registry, not their own numbers", () => {
  const ready = {
    gates: [
      { gateKey: 4, passed: true },
      { gateKey: 5, passed: true },
    ],
    packComplete: true,
    packLeadWorkingDays: 5,
    priorCycleScored: true,
    firstCycle: false,
    issueCount: 4,
    issuesRanked: true,
    priorityCount: 4,
    prioritiesWithSuccess: 4,
    notDoingWritten: true,
    sessionsBookedForWholeCycle: true,
  };

  it("passes everything when the cycle is ready", () => {
    const result = evaluateCycle(ready, thresholds);
    expect(result.every((entry) => entry.status === "pass")).toBe(true);
  });

  it("fails CY-3 one below the registry's own floor", () => {
    const floor = thresholds["quality.strategicIssueBounds"].low;
    const result = evaluateCycle(
      { ...ready, issueCount: floor - 1 },
      thresholds,
    );
    expect(result.find((entry) => entry.id === "CY-3")?.status).toBe("fail");
  });

  it("warns CY-3 when the issues are listed but nobody ranked them", () => {
    const result = evaluateCycle({ ...ready, issuesRanked: false }, thresholds);
    expect(result.find((entry) => entry.id === "CY-3")?.status).toBe("warn");
  });

  it("fails CY-1 one working day short of the registry's lead", () => {
    const lead = thresholds["quality.inputPackLeadWorkingDays"];
    const result = evaluateCycle(
      { ...ready, packLeadWorkingDays: lead - 1 },
      thresholds,
    );
    expect(result.find((entry) => entry.id === "CY-1")?.status).toBe("fail");
  });

  it("fails CY-4 on a priority with no twelve-month success statement", () => {
    const result = evaluateCycle(
      { ...ready, prioritiesWithSuccess: 3 },
      thresholds,
    );
    expect(result.find((entry) => entry.id === "CY-4")?.status).toBe("fail");
  });

  it("leaves CY-8 as todo while nothing books sessions yet", () => {
    const { sessionsBookedForWholeCycle: _drop, ...withoutSessions } = ready;
    const result = evaluateCycle(withoutSessions, thresholds);
    expect(result.find((entry) => entry.id === "CY-8")?.status).toBe("todo");
  });
});

describe("the twenty-six checks", () => {
  it("are all present, and every id is unique", () => {
    const all = [
      ...OBJECTIVE_CHECKS,
      ...KEY_RESULT_CHECKS,
      ...ALIGNMENT_CHECKS,
      ...CYCLE_CHECKS,
    ];
    expect(all).toHaveLength(26);
    expect(new Set(all.map((entry) => entry.id)).size).toBe(26);
  });

  it("count the objective, key result and alignment checks towards the score, and not the cycle ones", () => {
    // METHOD.md §4: the cycle checks feed phase completion and the publish
    // gates instead, which is a question about the cycle rather than the OKR.
    for (const check of [
      ...OBJECTIVE_CHECKS,
      ...KEY_RESULT_CHECKS,
      ...ALIGNMENT_CHECKS,
    ]) {
      expect(check.feedsStrengthScore).toBe(true);
    }
    for (const check of CYCLE_CHECKS) {
      expect(check.feedsStrengthScore).toBe(false);
    }
  });
});
