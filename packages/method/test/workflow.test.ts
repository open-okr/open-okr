import { describe, expect, it } from "vitest";
import { canonThresholds } from "../src/thresholds.ts";
import {
  type CycleWorkflowInput,
  canPublish,
  type GoalSnapshot,
  INPUT_PACK_ITEMS,
  phaseCompletion,
  phaseWorkAllowed,
  publishGates,
  workingDaysBetween,
} from "../src/workflow.ts";

/**
 * The eight-phase workflow and the six publish gates (P3-T03, METHOD.md §2.3,
 * §4.5).
 *
 * The task's acceptance criterion is the last test in "opening a phase": a
 * quarterly cycle whose input pack has two items missing blocks drafting at
 * phase 4, naming the two.
 *
 * The rule these tests exist to hold is §2.3's: completion is computed, never
 * self-reported. So there is no way to make a phase pass except by satisfying
 * it, and a predicate that cannot see its input reports `todo` rather than
 * passing. Phase 1 of this repository shipped four gates that passed while
 * checking nothing; these are the tests that would have caught them.
 */

const thresholds = canonThresholds();

/** Every pack item gathered, which is what a prepared cycle looks like. */
const fullPack = INPUT_PACK_ITEMS.map((_, index) => ({
  itemKey: index + 1,
  gathered: true,
}));

const goal = (overrides: Partial<GoalSnapshot> = {}): GoalSnapshot => ({
  id: "g1",
  title: "Make mobile the way our customers prefer to reach us",
  level: "company",
  championId: "m1",
  reviewerId: "m2",
  hasParent: false,
  contributionStatement: "Carries the annual mobile thrust",
  keyResults: [
    {
      id: "k1",
      title: "Raise activation from 41% to 60%",
      capacity: "fits",
      dependencies: [],
    },
  ],
  ...overrides,
});

/** A quarterly cycle with every phase-1-to-3 condition met. */
function base(overrides: Partial<CycleWorkflowInput> = {}): CycleWorkflowInput {
  return {
    mode: "quarterly",
    firstCycle: true,
    startsOn: "2026-07-01",
    publicationDeadline: "2026-06-24",
    publishedAt: null,
    sponsorId: "m1",
    facilitatorId: "m2",
    // Distributed on a Monday, session on the Friday: four working days between.
    packDistributedAt: "2026-06-08T09:00:00Z",
    firstSessionOn: "2026-06-15",
    packItems: fullPack,
    priorScores: [],
    hasBaselineHealth: true,
    issues: [1, 2, 3, 4, 5].map((impact) => ({ impact })),
    priorities: [],
    revalidation: {
      holds: true,
      changed: false,
      changeNote: null,
      focusNote: "Mobile",
    },
    focusKeyResultCount: 0,
    hasCapacityNotes: true,
    // The §5.5 initiative register (P5-T10a). An empty list is a real answer:
    // somebody looked and found no project over-committed. Leaving it out is
    // what makes gate 5 unevaluable, which one test below asserts on purpose.
    initiatives: [],
    frame: {
      hasMission: true,
      hasStrategy: true,
      strategyCount: 3,
      notDoingWritten: true,
      agreed: true,
      annualKeyResultCount: 0,
    },
    ...overrides,
  };
}

const phase = (input: CycleWorkflowInput, index: number) =>
  phaseCompletion(input, thresholds)[index];

describe("working days between two dates", () => {
  it("counts weekdays strictly between, excluding both ends", () => {
    // Monday to Friday: Tuesday, Wednesday, Thursday.
    expect(workingDaysBetween("2026-06-08", "2026-06-12")).toBe(3);
  });

  it("skips the weekend", () => {
    // Friday to Monday: nothing in between but Saturday and Sunday.
    expect(workingDaysBetween("2026-06-12", "2026-06-15")).toBe(0);
  });

  it("is zero for the same day and for a reversed pair", () => {
    expect(workingDaysBetween("2026-06-08", "2026-06-08")).toBe(0);
    expect(workingDaysBetween("2026-06-15", "2026-06-08")).toBe(0);
  });
});

describe("phase 0, annual strategy", () => {
  it("does not apply to a quarterly cycle", () => {
    // §2.2: "Phase 0 runs only in an annual cycle."
    expect(phase(base(), 0)?.state).toBe("not_applicable");
  });

  it("cannot answer without goals, and says which task brings them", () => {
    const result = phase(base({ mode: "annual" }), 0);
    expect(result?.state).toBe("todo");
    expect(result?.blocked.join(" ")).toMatch(/P3-T04/);
  });

  it("names a missing mission and an out-of-range strategy count", () => {
    const result = phase(
      base({
        mode: "annual",
        goals: [goal()],
        frame: {
          hasMission: false,
          hasStrategy: true,
          strategyCount: 6,
          notDoingWritten: true,
          agreed: true,
          annualKeyResultCount: 0,
        },
      }),
      0,
    );
    expect(result?.missing.join(" ")).toMatch(/mission is not written/);
    expect(result?.missing.join(" ")).toMatch(/6 annual strategies/);
  });

  it("passes with a frame and a company objective carrying a key result", () => {
    const result = phase(base({ mode: "annual", goals: [goal()] }), 0);
    expect(result?.state).toBe("pass");
  });

  it("refuses a company objective with no key results", () => {
    const result = phase(
      base({ mode: "annual", goals: [goal({ keyResults: [] })] }),
      0,
    );
    expect(result?.missing.join(" ")).toMatch(/no company objective/i);
  });
});

describe("phase 1, prepare", () => {
  it("passes when the roles are named and the pack arrived in time", () => {
    expect(phase(base(), 1)?.state).toBe("pass");
  });

  it("names each missing role", () => {
    const result = phase(base({ sponsorId: null, facilitatorId: null }), 1);
    expect(result?.missing).toContain("No sponsor named");
    expect(result?.missing).toContain("No facilitator named");
  });

  it("names each ungathered pack item, with the item's own words", () => {
    const result = phase(
      base({
        packItems: fullPack.map((item) =>
          item.itemKey === 3 || item.itemKey === 5
            ? { ...item, gathered: false }
            : item,
        ),
      }),
      1,
    );
    expect(result?.missing).toHaveLength(2);
    expect(result?.missing[0]).toMatch(/item 3.*KPI dashboard/);
    expect(result?.missing[1]).toMatch(/item 5.*Financial constraints/);
  });

  it("refuses a pack that arrived too late", () => {
    // §2.6: three working days before session one. Wednesday to Friday is two.
    const result = phase(
      base({
        packDistributedAt: "2026-06-10T09:00:00Z",
        firstSessionOn: "2026-06-12",
      }),
      1,
    );
    expect(result?.missing.join(" ")).toMatch(
      /1 working day\(s\) before session one/,
    );
  });

  it("refuses a pack nobody distributed", () => {
    const result = phase(base({ packDistributedAt: null }), 1);
    expect(result?.missing.join(" ")).toMatch(/has not been distributed/);
  });

  it("says so when no session is booked to measure the lead against", () => {
    const result = phase(base({ firstSessionOn: null }), 1);
    expect(result?.missing.join(" ")).toMatch(/No session dates are booked/);
  });

  it("honours a workspace that lengthened the lead", () => {
    const stricter = { ...thresholds, "quality.inputPackLeadWorkingDays": 10 };
    const result = phaseCompletion(base(), stricter)[1];
    expect(result?.state).toBe("todo");
    expect(result?.missing.join(" ")).toMatch(/asks for 10/);
  });
});

describe("phase 2, diagnose", () => {
  it("skips prior scoring when the cycle is declared the first", () => {
    expect(phase(base({ firstCycle: true, priorScores: [] }), 2)?.state).toBe(
      "pass",
    );
  });

  it("refuses an unscored prior cycle that is not declared first", () => {
    const result = phase(base({ firstCycle: false, priorScores: [] }), 2);
    expect(result?.missing.join(" ")).toMatch(/not scored/);
  });

  it("counts the prior key results still without a score", () => {
    const result = phase(
      base({
        firstCycle: false,
        priorScores: [{ score: 0.7 }, { score: null }, { score: null }],
      }),
      2,
    );
    expect(result?.missing.join(" ")).toMatch(/2 prior key result\(s\)/);
  });

  it("requires baseline health", () => {
    const result = phase(base({ hasBaselineHealth: false }), 2);
    expect(result?.missing).toContain("Baseline health is not recorded");
  });

  it("requires the §11 minimum number of ranked issues", () => {
    const result = phase(base({ issues: [{ impact: 5 }, { impact: 4 }] }), 2);
    // The floor is read from the registry, not written here: hardcoding it
    // made this test fail when the canon moved from 5 to 3 on 2026-08-17, which
    // is the test asserting the number rather than the behaviour.
    const floor = canonThresholds()["quality.strategicIssueBounds"].low;
    expect(result?.missing.join(" ")).toMatch(
      new RegExp(`2 strategic issue\\(s\\).*at least ${floor}`),
    );
  });
});

describe("phase 3, set direction", () => {
  it("an annual cycle needs 3 to 5 priorities, each with a success statement", () => {
    const result = phase(
      base({
        mode: "annual",
        priorities: [
          { successStatement: "Named" },
          { successStatement: null },
          { successStatement: "  " },
        ],
      }),
      3,
    );
    expect(result?.missing.join(" ")).toMatch(
      /2 priority\(ies\) have no 12-month success statement/,
    );
  });

  it("an annual cycle needs the not-doing list and recorded agreement", () => {
    const result = phase(
      base({
        mode: "annual",
        priorities: [1, 2, 3].map(() => ({ successStatement: "Named" })),
        frame: {
          hasMission: true,
          hasStrategy: true,
          strategyCount: 3,
          notDoingWritten: false,
          agreed: false,
          annualKeyResultCount: 0,
        },
      }),
      3,
    );
    expect(result?.missing).toContain("The not-doing list is not written");
    expect(result?.missing).toContain(
      "Leadership agreement on the frame is not recorded",
    );
  });

  it("a quarterly cycle needs the frame revalidated", () => {
    const result = phase(base({ revalidation: null }), 3);
    expect(result?.missing.join(" ")).toMatch(/has not been revalidated/);
  });

  it("refuses a changed frame with no note saying what changed", () => {
    const result = phase(
      base({
        revalidation: {
          holds: false,
          changed: true,
          changeNote: null,
          focusNote: "x",
        },
      }),
      3,
    );
    expect(result?.missing.join(" ")).toMatch(/no note saying what changed/);
  });

  it("accepts a changed frame with a note", () => {
    const result = phase(
      base({
        revalidation: {
          holds: false,
          changed: true,
          changeNote: "Dropped the ASEAN thrust",
          focusNote: "Mobile",
        },
      }),
      3,
    );
    expect(result?.state).toBe("pass");
  });

  it("refuses a revalidation that says neither that it holds nor what changed", () => {
    const result = phase(
      base({
        revalidation: {
          holds: false,
          changed: false,
          changeNote: null,
          focusNote: "x",
        },
      }),
      3,
    );
    expect(result?.missing.join(" ")).toMatch(/neither that the frame holds/);
  });

  it("needs focus key results when the frame has annual key results to point at", () => {
    const result = phase(
      base({
        focusKeyResultCount: 0,
        frame: {
          hasMission: true,
          hasStrategy: true,
          strategyCount: 3,
          notDoingWritten: true,
          agreed: true,
          annualKeyResultCount: 4,
        },
      }),
      3,
    );
    expect(result?.missing.join(" ")).toMatch(/No focus key results chosen/);
  });

  it("accepts a written focus note when the frame has none to point at", () => {
    // A workspace with no annual key results still has to say what the quarter
    // is about, and a note is the only thing it can say it with.
    expect(phase(base({ focusKeyResultCount: 0 }), 3)?.state).toBe("pass");
  });
});

describe("phases that cannot answer yet", () => {
  it("phase 4 waits for the quality engine and names the task", () => {
    const result = phase(base(), 4);
    expect(result?.state).toBe("todo");
    // The task named here moved from P4-T01 to P4-T03 once the catalogue and
    // the stored verdicts existed and only the reading across a set did not.
    // A blocked note that names a task already done sends the reader nowhere.
    expect(result?.blocked.join(" ")).toMatch(/P4-T03/);
    // Not a failure: nothing is wrong with the cycle.
    expect(result?.missing).toEqual([]);
  });

  it("phase 4 answers once the quality engine reports", () => {
    expect(phase(base({ qualityChecksPass: true }), 4)?.state).toBe("pass");
    expect(phase(base({ qualityChecksPass: false }), 4)?.missing).toHaveLength(
      1,
    );
  });

  it("phase 6 waits for sessions and the decision log", () => {
    expect(phase(base(), 6)?.blocked.join(" ")).toMatch(/P4-T04/);
  });

  it("phase 6 answers once they exist", () => {
    expect(
      phase(
        base({ cadence: { bookedForWholeCycle: true, decisionCount: 1 } }),
        6,
      )?.state,
    ).toBe("pass");
    expect(
      phase(
        base({ cadence: { bookedForWholeCycle: true, decisionCount: 0 } }),
        6,
      )?.missing,
    ).toContain("No decision has been recorded");
  });

  it("phase 7 waits for both scores and the retrospective", () => {
    const result = phase(base(), 7);
    expect(result?.blocked.join(" ")).toMatch(/P3-T04/);
    expect(result?.blocked.join(" ")).toMatch(/P4-T08/);
  });
});

describe("the six publish gates", () => {
  it("cannot evaluate the goal-shaped gates before goals exist", () => {
    const gates = publishGates(base());
    for (const gateKey of [1, 3, 4, 5]) {
      const gate = gates.find((entry) => entry.gateKey === gateKey);
      expect(gate?.evaluable, `gate ${gateKey}`).toBe(false);
      expect(gate?.detail.blocked).toMatch(/P3-T04/);
    }
  });

  it("blocks publication while any gate cannot be evaluated", () => {
    // The safe direction: a gate that cannot check anything must not pass.
    expect(canPublish(publishGates(base()))).toBe(false);
  });

  it("passes gate 1 when every goal has a title, a champion and a reviewer", () => {
    const gates = publishGates(base({ goals: [goal()] }));
    expect(gates.find((entry) => entry.gateKey === 1)?.passed).toBe(true);
  });

  it("names the goal missing a champion or a reviewer", () => {
    const gates = publishGates(
      base({
        goals: [
          goal({ championId: null }),
          goal({ id: "g2", title: "Second", reviewerId: null }),
        ],
      }),
    );
    const gate = gates.find((entry) => entry.gateKey === 1);
    expect(gate?.passed).toBe(false);
    expect(gate?.detail.missing.join(" ")).toMatch(/has no champion/);
    expect(gate?.detail.missing.join(" ")).toMatch(/"Second" has no reviewer/);
  });

  it("gate 3 accepts a stated contribution in place of a parent", () => {
    // §4.3's AL-1 and §4.5's gate 3 both accept a contribution statement, which
    // is what makes them different from §5.2's structural orphan penalty.
    const gates = publishGates(
      base({
        goals: [
          goal({ hasParent: false, contributionStatement: "Carries mobile" }),
        ],
      }),
    );
    expect(gates.find((entry) => entry.gateKey === 3)?.passed).toBe(true);
  });

  it("gate 3 refuses a goal with neither a parent nor a contribution", () => {
    const gates = publishGates(
      base({
        goals: [goal({ hasParent: false, contributionStatement: null })],
      }),
    );
    const gate = gates.find((entry) => entry.gateKey === 3);
    expect(gate?.passed).toBe(false);
    expect(gate?.detail.missing.join(" ")).toMatch(/states no contribution/);
  });

  it("gate 4 accepts a risk owner where confirmation is missing", () => {
    const withRiskOwner = goal({
      keyResults: [
        {
          id: "k1",
          title: "Cut first response from 9h to 2h",
          capacity: "fits",
          dependencies: [{ confirmed: false, riskOwnerId: "m9" }],
        },
      ],
    });
    expect(
      publishGates(base({ goals: [withRiskOwner] })).find(
        (g) => g.gateKey === 4,
      )?.passed,
    ).toBe(true);
  });

  it("gate 4 refuses a dependency that is neither confirmed nor owned", () => {
    const orphanDependency = goal({
      keyResults: [
        {
          id: "k1",
          title: "Cut first response from 9h to 2h",
          capacity: "fits",
          dependencies: [{ confirmed: false, riskOwnerId: null }],
        },
      ],
    });
    const gate = publishGates(base({ goals: [orphanDependency] })).find(
      (g) => g.gateKey === 4,
    );
    expect(gate?.passed).toBe(false);
    expect(gate?.detail.missing.join(" ")).toMatch(
      /neither confirmed nor risk-owned/,
    );
  });

  it("gate 5 refuses anything left exceeding capacity", () => {
    const exceeding = goal({
      keyResults: [
        {
          id: "k1",
          title: "Ship the migration",
          capacity: "exceeds",
          dependencies: [],
        },
      ],
    });
    const gate = publishGates(base({ goals: [exceeding] })).find(
      (g) => g.gateKey === 5,
    );
    expect(gate?.detail.missing.join(" ")).toMatch(/still exceeds capacity/);
  });

  it("gate 5 refuses an initiative left exceeding capacity, and names it", () => {
    // The other half of §5.5's one sentence (P5-T10a). Two different problems
    // with two different fixes, so the gate has to say which one it found.
    const gate = publishGates(
      base({
        goals: [goal()],
        initiatives: [
          {
            id: "i1",
            title: "Rebuild the activation flow",
            capacity: "exceeds",
          },
        ],
      }),
    ).find((g) => g.gateKey === 5);
    expect(gate?.passed).toBe(false);
    expect(gate?.detail.missing).toContain(
      '"Rebuild the activation flow" still exceeds capacity',
    );
  });

  it("gate 5 passes an initiative that fits, or one nobody has judged", () => {
    for (const capacity of ["fits", "tight", null] as const) {
      const gate = publishGates(
        base({
          goals: [goal()],
          initiatives: [{ id: "i1", title: "Rebuild it", capacity }],
        }),
      ).find((g) => g.gateKey === 5);
      expect(gate?.passed, capacity ?? "unjudged").toBe(true);
    }
  });

  it("gate 5 cannot be answered at all without the initiative register", () => {
    // The rule this file exists to hold: a predicate that cannot see its input
    // reports `todo`, never `pass`. §5.5 is one sentence about the measures and
    // the work behind them, and passing on half of it is the Phase 1 failure.
    const { initiatives: _omitted, ...withoutRegister } = base({
      goals: [goal()],
    });
    const gate = publishGates(withoutRegister).find((g) => g.gateKey === 5);
    expect(gate?.evaluable).toBe(false);
    expect(gate?.passed).toBe(false);
    expect(gate?.detail.blocked).toMatch(/initiative register/);
  });

  it("gate 5 refuses a set where nothing was recorded as cut", () => {
    // §5.5: "If the answer is nothing, capacity was not checked."
    const gate = publishGates(
      base({ goals: [goal()], hasCapacityNotes: false }),
    ).find((g) => g.gateKey === 5);
    expect(gate?.detail.missing).toContain("What was cut is not recorded");
  });

  it("gate 6 needs a deadline before day one", () => {
    expect(
      publishGates(base({ publicationDeadline: null }))
        .find((g) => g.gateKey === 6)
        ?.detail.missing.join(" "),
    ).toMatch(/No publication deadline/);
    expect(
      publishGates(base({ publicationDeadline: "2026-07-05" }))
        .find((g) => g.gateKey === 6)
        ?.detail.missing.join(" "),
    ).toMatch(/not before day one/);
    expect(
      publishGates(base({ publicationDeadline: "2026-06-24" })).find(
        (g) => g.gateKey === 6,
      )?.passed,
    ).toBe(true);
  });

  it("goes green on all six, and only then allows publication", () => {
    const ready = base({ goals: [goal()], qualityChecksPass: true });
    const gates = publishGates(ready);
    expect(gates.filter((gate) => gate.passed)).toHaveLength(6);
    expect(canPublish(gates)).toBe(true);
  });
});

describe("phase 5, align and commit", () => {
  it("stays incomplete while the set is unpublished, even with green gates", () => {
    const ready = base({ goals: [goal()], qualityChecksPass: true });
    const result = phase(ready, 5);
    expect(result?.state).toBe("todo");
    expect(result?.missing).toContain("The set is not published");
  });

  it("completes once every gate is green and the set is published", () => {
    const published = base({
      goals: [goal()],
      qualityChecksPass: true,
      publishedAt: "2026-06-25T10:00:00Z",
    });
    expect(phase(published, 5)?.state).toBe("pass");
  });

  it("reports an unevaluable gate as blocked rather than failed", () => {
    const result = phase(base(), 5);
    expect(result?.blocked.length).toBeGreaterThan(0);
  });
});

describe("opening a phase", () => {
  it("allows drafting when every earlier phase is satisfied", () => {
    const allowed = phaseWorkAllowed(4, phaseCompletion(base(), thresholds));
    expect(allowed.allowed).toBe(true);
  });

  /**
   * The task's acceptance criterion, exactly: "Given a quarterly cycle whose
   * input pack has two items missing, when the facilitator opens Phase 4, then
   * drafting is blocked with the two missing items named."
   */
  it("blocks drafting on an incomplete input pack, naming the two items", () => {
    const twoMissing = base({
      packItems: fullPack.map((item) =>
        item.itemKey === 4 || item.itemKey === 6
          ? { ...item, gathered: false }
          : item,
      ),
    });
    const outcome = phaseWorkAllowed(
      4,
      phaseCompletion(twoMissing, thresholds),
    );

    expect(outcome.allowed).toBe(false);
    expect(outcome.because).toHaveLength(2);
    expect(outcome.because[0]).toMatch(/Phase 1.*item 4.*Customer feedback/);
    expect(outcome.because[1]).toMatch(/Phase 1.*item 6.*Committed projects/);
  });

  it("does not block on a phase that is only waiting for an unshipped input", () => {
    // Phase 4 cannot be answered until P4-T01. Refusing to let anybody align
    // because of that would make the product unusable for being unfinished.
    const outcome = phaseWorkAllowed(5, phaseCompletion(base(), thresholds));
    expect(outcome.allowed).toBe(true);
  });

  it("does not consider a later phase's state", () => {
    const outcome = phaseWorkAllowed(
      2,
      phaseCompletion(base({ issues: [] }), thresholds),
    );
    // Phase 2's own missing issues do not block opening phase 2.
    expect(outcome.allowed).toBe(true);
  });
});

describe("the conditions tally the rail draws its bar from", () => {
  it("counts ten conditions in phase 1: two roles, seven items, one distribution", () => {
    expect(phase(base(), 1)?.conditions).toEqual({ met: 10, total: 10 });
  });

  it("moves with the work, one condition at a time", () => {
    const bare = base({
      sponsorId: null,
      facilitatorId: null,
      packItems: fullPack.map((item) => ({ ...item, gathered: false })),
      packDistributedAt: null,
    });
    expect(phase(bare, 1)?.conditions).toEqual({ met: 0, total: 10 });

    const halfway = base({
      facilitatorId: null,
      packItems: fullPack.map((item) =>
        item.itemKey > 4 ? { ...item, gathered: false } : item,
      ),
      packDistributedAt: null,
    });
    // Sponsor and four items: five of ten.
    expect(phase(halfway, 1)?.conditions).toEqual({ met: 5, total: 10 });
  });

  it("reports nothing to count for a phase that does not apply", () => {
    // Phase 0 in a quarterly cycle. A bar over zero conditions is not 100%
    // complete, it is not a bar, and the rail has to be able to tell.
    expect(phase(base(), 0)?.conditions).toEqual({ met: 0, total: 0 });
  });

  it("leaves an unshipped input out of the denominator", () => {
    // Phase 4 waits on P4-T01. Counting it as one unmet condition out of one
    // would report the cycle as behind on work nobody can do yet.
    expect(phase(base(), 4)?.conditions).toEqual({ met: 0, total: 0 });
  });

  it("counts only the gates that can be judged, plus publication", () => {
    // No goals table, so gates 1 to 5 are unevaluable and only gate 6 counts.
    const result = phase(base(), 5);
    expect(result?.conditions.total).toBe(2);
    expect(result?.conditions.met).toBe(1);
  });

  it("drops prior scoring from phase 2 when this is a first cycle", () => {
    expect(phase(base({ firstCycle: true }), 2)?.conditions.total).toBe(2);
    expect(
      phase(base({ firstCycle: false, priorScores: [{ score: 0.7 }] }), 2)
        ?.conditions.total,
    ).toBe(3);
  });
});

describe("gate 4 and the dependency register", () => {
  it("cannot be judged while a key result's dependencies are unknown", () => {
    // Goals exist (P3-T04) but the §5.4 register does not (P3-T09). An empty
    // list would claim somebody looked; undefined says nobody can.
    const withGoals = base({
      goals: [
        goal({
          keyResults: [
            {
              id: "k1",
              title: "Raise activation from 41% to 60%",
              capacity: "fits",
            },
          ],
        }),
      ],
    });
    const gate = publishGates(withGoals)[3];
    expect(gate?.gateKey).toBe(4);
    expect(gate?.evaluable).toBe(false);
    expect(gate?.passed).toBe(false);
    expect(gate?.detail.blocked).toMatch(/P3-T09/);
  });

  it("passes once the register exists and holds nothing unconfirmed", () => {
    const withRegister = base({
      goals: [
        goal({
          keyResults: [
            {
              id: "k1",
              title: "Raise activation from 41% to 60%",
              capacity: "fits",
              dependencies: [],
            },
          ],
        }),
      ],
    });
    const gate = publishGates(withRegister)[3];
    expect(gate?.evaluable).toBe(true);
    expect(gate?.passed).toBe(true);
  });
});
