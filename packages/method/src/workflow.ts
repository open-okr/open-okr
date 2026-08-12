/**
 * The eight-phase workflow and the six publish gates, computed (METHOD.md §2.3,
 * §4.5, TECHNICAL-PLAN.md §4.3, P3-T03).
 *
 * §2.3 states the rule this file exists to keep: "A phase is complete when all
 * of its conditions hold. The product computes this. It is not self-reported."
 * So nothing here reads a stored boolean saying a phase is done. Every predicate
 * takes a snapshot of rows and decides.
 *
 * **Three states, not two.** A predicate returns `pass`, `todo` or
 * `not_applicable`, and the difference between the last two matters: phase 0
 * does not apply to a quarterly cycle, while phase 6 cannot yet be answered
 * because sessions arrive at P4-T04. Reporting either as a failure would tell a
 * facilitator to fix something that is not broken.
 *
 * **A predicate that cannot see its input returns `todo`, never `pass`.** Phase 1
 * of this repository learned that the hard way: four gates passed while checking
 * nothing, and each was found by running the software rather than by reading it.
 * So every input that has not shipped yet is `undefined` here rather than
 * defaulted, and the predicate that needs it says which task brings it.
 *
 * Pure: no database, no clock beyond what the caller passes, no framework.
 */
import type { ResolvedThresholds } from "./thresholds.ts";

export type PredicateState = "pass" | "todo" | "not_applicable";

export interface PhaseResult {
  /** 0 to 7, as METHOD.md §2.2 numbers them. */
  readonly phase: number;
  readonly title: string;
  readonly state: PredicateState;
  /** What is still missing, in words a facilitator can act on. */
  readonly missing: readonly string[];
  /**
   * Inputs this predicate could not see at all, each naming the task that
   * brings it. Present means the answer is provisional, not that anything is
   * wrong with the cycle.
   */
  readonly blocked: readonly string[];
  /**
   * How many of this phase's conditions hold, out of the ones that could be
   * evaluated at all. This is what the S-04 rail's progress bar shows.
   *
   * `total` counts evaluated conditions only, so a phase waiting on a table
   * that does not exist reports 0 of 0 rather than a share of a denominator
   * nobody can move. Every entry in `missing` is exactly one unmet condition,
   * which is what makes `met` the subtraction it looks like.
   */
  readonly conditions: { readonly met: number; readonly total: number };
}

export interface GateResult {
  /** 1 to 6, as METHOD.md §4.5 lists them. */
  readonly gateKey: number;
  readonly title: string;
  readonly passed: boolean;
  /** False when an input does not exist yet. Publication is blocked either way. */
  readonly evaluable: boolean;
  readonly detail: {
    readonly missing: readonly string[];
    readonly blocked?: string;
  };
}

/** One key result, as the gates need to see it. */
export interface KeyResultSnapshot {
  readonly id: string;
  readonly title: string;
  readonly capacity: "fits" | "tight" | "exceeds" | null;
  /**
   * The §5.4 dependency register entries hanging off this key result.
   *
   * Undefined means the register does not exist yet (P3-T09), which is a
   * different fact from an empty one: an empty list says somebody looked and
   * found none, and gate 4 may pass on it. Undefined says nobody can look, and
   * gate 4 reports itself unevaluable instead.
   */
  readonly dependencies?: readonly {
    readonly confirmed: boolean;
    readonly riskOwnerId: string | null;
  }[];
}

/** One goal, as the gates need to see it. */
export interface GoalSnapshot {
  readonly id: string;
  readonly title: string;
  readonly level: string;
  readonly championId: string | null;
  readonly reviewerId: string | null;
  readonly hasParent: boolean;
  readonly contributionStatement: string | null;
  readonly keyResults: readonly KeyResultSnapshot[];
}

export interface FrameSnapshot {
  readonly hasMission: boolean;
  readonly hasStrategy: boolean;
  readonly strategyCount: number;
  readonly notDoingWritten: boolean;
  readonly agreed: boolean;
  readonly annualKeyResultCount: number;
}

/**
 * Everything the workflow reads, loaded once.
 *
 * An optional field means "this table does not exist in this build yet". It is
 * deliberately not defaulted to an empty array: an empty list of goals and no
 * goals table at all are different facts, and only one of them means a gate can
 * legitimately pass.
 */
export interface CycleWorkflowInput {
  readonly mode: "annual" | "quarterly";
  readonly firstCycle: boolean;
  readonly startsOn: string;
  readonly publicationDeadline: string | null;
  readonly publishedAt: Date | string | null;
  readonly sponsorId: string | null;
  readonly facilitatorId: string | null;
  readonly packDistributedAt: Date | string | null;
  /** The earliest booked session date, as a local `YYYY-MM-DD`. */
  readonly firstSessionOn: string | null;
  readonly packItems: readonly {
    readonly itemKey: number;
    readonly gathered: boolean;
  }[];
  readonly priorScores: readonly { readonly score: number | null }[];
  readonly hasBaselineHealth: boolean;
  readonly issues: readonly { readonly impact: number }[];
  readonly priorities: readonly { readonly successStatement: string | null }[];
  readonly revalidation: {
    readonly holds: boolean;
    readonly changed: boolean;
    readonly changeNote: string | null;
    readonly focusNote: string | null;
  } | null;
  readonly focusKeyResultCount: number;
  readonly hasCapacityNotes: boolean;
  readonly frame: FrameSnapshot | null;
  /** Undefined until P3-T04 ships goals and key results. */
  readonly goals?: readonly GoalSnapshot[];
  /** Undefined until P4-T01 ships the quality engine. */
  readonly qualityChecksPass?: boolean;
  /** Undefined until P4-T04 ships sessions and the decision log. */
  readonly cadence?: {
    readonly bookedForWholeCycle: boolean;
    readonly decisionCount: number;
  };
  /** Undefined until P3-T04 ships key result scores. */
  readonly allKeyResultsScored?: boolean;
  /** Undefined until P4-T08 ships the cycle retrospective. */
  readonly retrospectiveWritten?: boolean;
}

/** The seven §2.6 input-pack items, in the order the specification lists them. */
export const INPUT_PACK_ITEMS = [
  "Mission, vision and current strategy documents",
  "Prior cycle OKRs with scores and retrospective notes",
  "KPI dashboard or baseline health metrics",
  "Customer feedback and market or competitor signals",
  "Financial constraints: budget, headcount, committed spend",
  "Committed projects and obligations that consume capacity",
  "Open risks and dependencies carried over from the last cycle",
] as const;

export const PHASE_TITLES = [
  "Annual strategy",
  "Prepare",
  "Diagnose",
  "Set direction",
  "Draft OKRs",
  "Align and commit",
  "Run the cadence",
  "Review and learn",
] as const;

export const GATE_TITLES = [
  "Every objective has a title, a champion and a reviewer",
  "Every key result passes the quality checks",
  "Alignment is mapped: each objective states what it contributes to",
  "Every dependency is confirmed, or logged with a named risk owner",
  "Capacity is checked, and nothing is left exceeding it",
  "A publication date is set before day one of the cycle",
] as const;

const isBlank = (value: string | null | undefined): boolean =>
  value === null || value === undefined || value.trim() === "";

const asDate = (value: Date | string | null): Date | null => {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
};

/**
 * Monday-to-Friday days strictly between two local dates.
 *
 * No holiday calendar. METHOD.md §2.6 says "three working days" and nothing in
 * the plan set names a holiday source, so a weekday count is the honest reading
 * and the simplification is recorded in the P3-T00 domain document rather than
 * invented here.
 */
export function workingDaysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }
  let days = 0;
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor < end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      days += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** A local `YYYY-MM-DD` from an instant, in UTC. Only used for the pack lead. */
const utcDateOf = (value: Date): string => value.toISOString().slice(0, 10);

/**
 * The conditions tally for a phase.
 *
 * Each predicate counts the conditions it actually evaluated, and every entry it
 * pushed into `missing` is one of them failing, so `met` is a subtraction rather
 * than a second count that could drift from the first.
 */
const conditionsOf = (
  total: number,
  missing: readonly string[],
): { met: number; total: number } => ({
  met: Math.max(0, total - missing.length),
  total,
});

function phaseZero(input: CycleWorkflowInput): PhaseResult {
  const base = { phase: 0, title: PHASE_TITLES[0] } as const;
  if (input.mode !== "annual") {
    // §2.2: "Phase 0 runs only in an annual cycle."
    return {
      ...base,
      state: "not_applicable",
      missing: [],
      blocked: [],
      conditions: { met: 0, total: 0 },
    };
  }

  const missing: string[] = [];
  const blocked: string[] = [];
  const frame = input.frame;
  let total = 0;

  if (!frame) {
    total += 1;
    missing.push("No annual frame exists yet");
  } else {
    total += 3;
    if (!frame.hasMission) {
      missing.push("The mission is not written");
    }
    if (!frame.hasStrategy) {
      missing.push("The mid-term strategy is not written");
    }
    if (frame.strategyCount < 2 || frame.strategyCount > 5) {
      missing.push(
        `${frame.strategyCount} annual strategies, and §2.1 asks for 2 to 5`,
      );
    }
  }

  if (input.goals === undefined) {
    blocked.push("Company objectives arrive at P3-T04");
  } else {
    total += 1;
    const anchored = input.goals.filter(
      (goal) => goal.level === "company" && goal.keyResults.length > 0,
    );
    if (anchored.length === 0) {
      missing.push("No company objective with at least one key result");
    }
  }

  const state =
    blocked.length > 0 ? "todo" : missing.length === 0 ? "pass" : "todo";
  return {
    ...base,
    state,
    missing,
    blocked,
    conditions: conditionsOf(total, missing),
  };
}

function phaseOne(
  input: CycleWorkflowInput,
  thresholds: ResolvedThresholds,
): PhaseResult {
  const missing: string[] = [];

  if (!input.sponsorId) {
    missing.push("No sponsor named");
  }
  if (!input.facilitatorId) {
    missing.push("No facilitator named");
  }

  const gathered = new Set(
    input.packItems.filter((item) => item.gathered).map((item) => item.itemKey),
  );
  const ungathered = INPUT_PACK_ITEMS.map((label, index) => ({
    label,
    key: index + 1,
  })).filter((item) => !gathered.has(item.key));

  for (const item of ungathered) {
    missing.push(`Input pack item ${item.key} is missing: ${item.label}`);
  }

  const lead = thresholds["quality.inputPackLeadWorkingDays"];
  const distributed = asDate(input.packDistributedAt);
  if (!distributed) {
    missing.push("The input pack has not been distributed");
  } else if (!input.firstSessionOn) {
    missing.push(
      "No session dates are booked, so the pack lead cannot be read",
    );
  } else {
    const actual = workingDaysBetween(
      utcDateOf(distributed),
      input.firstSessionOn,
    );
    if (actual < lead) {
      missing.push(
        `The pack reached people ${actual} working day(s) before session one, and §2.6 asks for ${lead}`,
      );
    }
  }

  return {
    phase: 1,
    title: PHASE_TITLES[1],
    state: missing.length === 0 ? "pass" : "todo",
    missing,
    blocked: [],
    // Two roles, the seven §2.6 items, and the distribution with its lead time.
    conditions: conditionsOf(2 + INPUT_PACK_ITEMS.length + 1, missing),
  };
}

function phaseTwo(
  input: CycleWorkflowInput,
  thresholds: ResolvedThresholds,
): PhaseResult {
  const missing: string[] = [];

  // §2.3: "Prior cycle scored (or first cycle declared)".
  if (!input.firstCycle) {
    if (input.priorScores.length === 0) {
      missing.push(
        "The prior cycle is not scored, and this is not declared a first cycle",
      );
    } else {
      const unscored = input.priorScores.filter(
        (row) => row.score === null,
      ).length;
      if (unscored > 0) {
        missing.push(`${unscored} prior key result(s) still have no score`);
      }
    }
  }

  if (!input.hasBaselineHealth) {
    missing.push("Baseline health is not recorded");
  }

  const bounds = thresholds["quality.strategicIssueBounds"];
  if (input.issues.length < bounds.low) {
    missing.push(
      `${input.issues.length} strategic issue(s) ranked, and §2.3 asks for at least ${bounds.low}`,
    );
  }

  return {
    phase: 2,
    title: PHASE_TITLES[2],
    state: missing.length === 0 ? "pass" : "todo",
    missing,
    blocked: [],
    // Baseline health and the ranked issues, plus prior scoring unless this is
    // declared a first cycle, where there is nothing to score.
    conditions: conditionsOf(input.firstCycle ? 2 : 3, missing),
  };
}

function phaseThree(
  input: CycleWorkflowInput,
  thresholds: ResolvedThresholds,
): PhaseResult {
  const missing: string[] = [];
  const base = { phase: 3, title: PHASE_TITLES[3] } as const;

  if (input.mode === "annual") {
    const bounds = thresholds["quality.priorityBounds"];
    if (
      input.priorities.length < bounds.low ||
      input.priorities.length > bounds.high
    ) {
      missing.push(
        `${input.priorities.length} priorities, and §2.3 asks for ${bounds.low} to ${bounds.high}`,
      );
    }
    const withoutSuccess = input.priorities.filter((priority) =>
      isBlank(priority.successStatement),
    ).length;
    if (withoutSuccess > 0) {
      missing.push(
        `${withoutSuccess} priority(ies) have no 12-month success statement`,
      );
    }
    if (!input.frame?.notDoingWritten) {
      missing.push("The not-doing list is not written");
    }
    if (!input.frame?.agreed) {
      missing.push("Leadership agreement on the frame is not recorded");
    }
    return {
      ...base,
      state: missing.length === 0 ? "pass" : "todo",
      missing,
      blocked: [],
      // The priority count, their success statements, the not-doing list and
      // the recorded agreement.
      conditions: conditionsOf(4, missing),
    };
  }

  // Quarterly: the frame is revalidated, not rewritten (§2.1).
  const revalidation = input.revalidation;
  if (!revalidation) {
    missing.push("The annual frame has not been revalidated");
  } else if (revalidation.changed) {
    if (isBlank(revalidation.changeNote)) {
      missing.push(
        "The frame is marked as changed with no note saying what changed",
      );
    }
  } else if (!revalidation.holds) {
    missing.push(
      "The revalidation records neither that the frame holds nor what changed",
    );
  }

  // "Focus areas chosen": the focus key results, or a written note where the
  // frame has no annual key results to point at.
  const frameHasAnnualKeyResults = (input.frame?.annualKeyResultCount ?? 0) > 0;
  if (input.focusKeyResultCount === 0) {
    if (frameHasAnnualKeyResults) {
      missing.push("No focus key results chosen for this quarter");
    } else if (isBlank(revalidation?.focusNote)) {
      missing.push("No focus areas chosen for this quarter");
    }
  }

  return {
    ...base,
    state: missing.length === 0 ? "pass" : "todo",
    missing,
    blocked: [],
    // The revalidation record, and the focus areas chosen for the quarter.
    conditions: conditionsOf(2, missing),
  };
}

function phaseFour(input: CycleWorkflowInput): PhaseResult {
  const base = { phase: 4, title: PHASE_TITLES[4] } as const;
  if (input.qualityChecksPass === undefined) {
    return {
      ...base,
      state: "todo",
      missing: [],
      blocked: ["The §4 quality checks arrive at P4-T01"],
      conditions: { met: 0, total: 0 },
    };
  }
  const missing = input.qualityChecksPass
    ? []
    : ["Some objectives or key results do not pass the §4 quality checks"];
  return {
    ...base,
    state: input.qualityChecksPass ? "pass" : "todo",
    missing,
    blocked: [],
    conditions: conditionsOf(1, missing),
  };
}

function phaseFive(
  input: CycleWorkflowInput,
  gates: readonly GateResult[],
): PhaseResult {
  const missing: string[] = [];
  const blocked: string[] = [];

  for (const gate of gates) {
    if (!gate.evaluable) {
      blocked.push(
        `Gate ${gate.gateKey} cannot be evaluated: ${gate.detail.blocked}`,
      );
      continue;
    }
    if (!gate.passed) {
      missing.push(`Gate ${gate.gateKey} is red: ${gate.title}`);
    }
  }

  if (!asDate(input.publishedAt)) {
    missing.push("The set is not published");
  }

  return {
    phase: 5,
    title: PHASE_TITLES[5],
    state: missing.length === 0 && blocked.length === 0 ? "pass" : "todo",
    missing,
    blocked,
    // Every gate that could be judged, plus publication itself. A gate nobody
    // can evaluate is not in the denominator, so the bar cannot fill by having
    // fewer things checkable.
    conditions: conditionsOf(
      gates.filter((gate) => gate.evaluable).length + 1,
      missing,
    ),
  };
}

function phaseSix(input: CycleWorkflowInput): PhaseResult {
  const base = { phase: 6, title: PHASE_TITLES[6] } as const;
  if (input.cadence === undefined) {
    return {
      ...base,
      state: "todo",
      missing: [],
      blocked: ["Sessions and the decision log arrive at P4-T04"],
      conditions: { met: 0, total: 0 },
    };
  }
  const missing: string[] = [];
  if (!input.cadence.bookedForWholeCycle) {
    missing.push("The cadence is not booked for the whole cycle");
  }
  if (input.cadence.decisionCount === 0) {
    missing.push("No decision has been recorded");
  }
  return {
    ...base,
    state: missing.length === 0 ? "pass" : "todo",
    missing,
    blocked: [],
    conditions: conditionsOf(2, missing),
  };
}

function phaseSeven(input: CycleWorkflowInput): PhaseResult {
  const base = { phase: 7, title: PHASE_TITLES[7] } as const;
  const missing: string[] = [];
  const blocked: string[] = [];

  let total = 0;

  if (input.allKeyResultsScored === undefined) {
    blocked.push("Key result scores arrive at P3-T04");
  } else {
    total += 1;
    if (!input.allKeyResultsScored) {
      missing.push("Not every key result is scored");
    }
  }

  if (input.retrospectiveWritten === undefined) {
    blocked.push("The cycle retrospective arrives at P4-T08");
  } else {
    total += 1;
    if (!input.retrospectiveWritten) {
      missing.push("The retrospective is not written");
    }
  }

  return {
    ...base,
    state: missing.length === 0 && blocked.length === 0 ? "pass" : "todo",
    missing,
    blocked,
    conditions: conditionsOf(total, missing),
  };
}

/**
 * The six publish gates (METHOD.md §4.5).
 *
 * "The set cannot be published until all six are green." A gate whose input does
 * not exist yet is reported as not evaluable, which blocks publication just as a
 * red gate does. That is the correct direction to be wrong in: a gate that
 * cannot check anything must not pass.
 */
export function publishGates(input: CycleWorkflowInput): readonly GateResult[] {
  const goals = input.goals;
  const goalsBlocked = "goals and key results arrive at P3-T04";

  const gate = (
    gateKey: number,
    passed: boolean,
    missing: readonly string[],
  ): GateResult => ({
    gateKey,
    title: GATE_TITLES[gateKey - 1] as string,
    passed,
    evaluable: true,
    detail: { missing },
  });

  const unevaluable = (gateKey: number, blocked: string): GateResult => ({
    gateKey,
    title: GATE_TITLES[gateKey - 1] as string,
    passed: false,
    evaluable: false,
    detail: { missing: [], blocked },
  });

  const results: GateResult[] = [];

  // 1. Every objective has a title, a named champion and a named reviewer.
  if (goals === undefined) {
    results.push(unevaluable(1, goalsBlocked));
  } else {
    const missing = goals.flatMap((goal) => {
      const problems: string[] = [];
      if (isBlank(goal.title)) {
        problems.push(`A goal has no title`);
      }
      if (!goal.championId) {
        problems.push(`"${goal.title}" has no champion`);
      }
      if (!goal.reviewerId) {
        problems.push(`"${goal.title}" has no reviewer`);
      }
      return problems;
    });
    results.push(gate(1, missing.length === 0, missing));
  }

  // 2. Every key result passes the §4.2 checks.
  if (input.qualityChecksPass === undefined) {
    results.push(unevaluable(2, "the §4 quality engine arrives at P4-T01"));
  } else {
    results.push(
      gate(
        2,
        input.qualityChecksPass,
        input.qualityChecksPass
          ? []
          : ["Some key results do not pass the §4.2 checks"],
      ),
    );
  }

  // 3. Alignment is mapped: each objective states what it contributes to.
  if (goals === undefined) {
    results.push(unevaluable(3, goalsBlocked));
  } else {
    const missing = goals
      .filter((goal) => !goal.hasParent && isBlank(goal.contributionStatement))
      .map(
        (goal) => `"${goal.title}" has no parent and states no contribution`,
      );
    results.push(gate(3, missing.length === 0, missing));
  }

  // 4. Every dependency is confirmed, or logged with a named risk owner.
  if (goals === undefined) {
    results.push(unevaluable(4, goalsBlocked));
  } else if (
    goals.some((goal) =>
      goal.keyResults.some((keyResult) => keyResult.dependencies === undefined),
    )
  ) {
    results.push(
      unevaluable(4, "the §5.4 dependency register arrives at P3-T09"),
    );
  } else {
    const missing = goals.flatMap((goal) =>
      goal.keyResults.flatMap((keyResult) =>
        (keyResult.dependencies ?? [])
          .filter(
            (dependency) => !dependency.confirmed && !dependency.riskOwnerId,
          )
          .map(
            () =>
              `"${keyResult.title}" has a dependency that is neither confirmed nor risk-owned`,
          ),
      ),
    );
    results.push(gate(4, missing.length === 0, missing));
  }

  // 5. Capacity is checked, nothing left at "exceeds", and the cuts recorded.
  if (goals === undefined) {
    results.push(unevaluable(5, goalsBlocked));
  } else {
    const missing = goals.flatMap((goal) =>
      goal.keyResults
        .filter((keyResult) => keyResult.capacity === "exceeds")
        .map((keyResult) => `"${keyResult.title}" still exceeds capacity`),
    );
    if (!input.hasCapacityNotes) {
      // §5.5: "The facilitator must record what was cut. If the answer is
      // nothing, capacity was not checked."
      missing.push("What was cut is not recorded");
    }
    results.push(gate(5, missing.length === 0, missing));
  }

  // 6. A publication date is set before day one of the cycle.
  const deadline = input.publicationDeadline;
  const missingSix: string[] = [];
  if (!deadline) {
    missingSix.push("No publication deadline is set");
  } else if (deadline >= input.startsOn) {
    missingSix.push(
      `The deadline ${deadline} is not before day one of the cycle (${input.startsOn})`,
    );
  }
  results.push(gate(6, missingSix.length === 0, missingSix));

  return results;
}

/** True only when all six gates are green and evaluable. */
export function canPublish(gates: readonly GateResult[]): boolean {
  return (
    gates.length === 6 && gates.every((gate) => gate.evaluable && gate.passed)
  );
}

/** Every phase's completion, phase 0 first. */
export function phaseCompletion(
  input: CycleWorkflowInput,
  thresholds: ResolvedThresholds,
): readonly PhaseResult[] {
  const gates = publishGates(input);
  return [
    phaseZero(input),
    phaseOne(input, thresholds),
    phaseTwo(input, thresholds),
    phaseThree(input, thresholds),
    phaseFour(input),
    phaseFive(input, gates),
    phaseSix(input),
    phaseSeven(input),
  ];
}

/**
 * Whether the work of a phase may proceed.
 *
 * METHOD.md §2.6 lets the facilitator "refuse to run Phase 4 without a complete
 * input pack", and the product refuses on their behalf. The pointer itself moves
 * freely, so this answers a different question from "which phase are we on":
 * it is what a surface asks before letting somebody draft.
 *
 * A phase blocked only by an input that has not shipped is **allowed**. Refusing
 * to let anybody draft because sessions arrive in Phase 4 would make the product
 * unusable for the reason that it is unfinished.
 */
export function phaseWorkAllowed(
  phase: number,
  completion: readonly PhaseResult[],
): { readonly allowed: boolean; readonly because: readonly string[] } {
  const earlier = completion.filter(
    (result) => result.phase < phase && result.state === "todo",
  );
  const because = earlier.flatMap((result) =>
    result.missing.map((reason) => `Phase ${result.phase}: ${reason}`),
  );
  return { allowed: because.length === 0, because };
}
