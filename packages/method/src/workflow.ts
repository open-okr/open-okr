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
import { applyEnforcement } from "./enforcement.ts";
import {
  defaultPractice,
  type GateEnforcement,
  type KeyResultKind,
  type ResolvedPractice,
} from "./practice.ts";
import {
  evaluateKeyResults,
  evaluateObjective,
  type KeyResultVerdict,
  type QualityVerdict,
} from "./quality.ts";
import type { OkrKind } from "./scoring.ts";
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
  /**
   * The gate's enforcement level from the practice (METHOD.md §4.5, §12,
   * P9-T03b). Only a gate at block holds publication; one at warn is shown and
   * coached; one at off is not judged and always reads passed.
   */
  readonly level: GateEnforcement;
  readonly passed: boolean;
  /**
   * False when an input does not exist yet. A gate at block that cannot be
   * judged holds publication the same way a red one does.
   */
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
   * The kind of its objective's promise (METHOD.md §2.8, §5.5). Only a
   * committed key result left at "exceeds" holds gate 5 back; an aspirational
   * one may exceed. Left out, a key result is aspirational.
   */
  readonly kind?: OkrKind;
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
    /** The sponsor it was escalated to (§5.4, P9-T16b-b). */
    readonly escalatedToId?: string | null;
  }[];
  /**
   * What §4.2's checks need to judge this key result, for publish gate 2.
   *
   * Undefined means nothing has evaluated it, which keeps gate 2 unevaluable
   * rather than green on an empty answer. The same distinction `dependencies`
   * draws, for the same reason.
   */
  readonly quality?: {
    readonly baseline: number;
    /** Null until somebody sets it, which KR-3 fails (P9-T13-b-a). */
    readonly target: number | null;
    readonly dueOn: string | null;
    readonly ownerId: string | null;
    readonly indicatorType: "leading" | "lagging";
    readonly direction: "increase" | "reduce" | "maintain" | "move";
    readonly confidence: number | null;
    /**
     * The key result's own kind (§2.10, P9-T12b), so gate 2's KR-3 and KR-7
     * do not block a milestone for the target it was never asked for.
     */
    readonly keyResultKind?: KeyResultKind;
  };
}

/**
 * One initiative, as gate 5 needs to see it (METHOD.md §5.5, P5-T10a).
 *
 * §5.5 asks a facilitator to record "the main initiatives that will move it and
 * one of three capacity verdicts". The verdict already lives on the key result;
 * this is the other half of the same sentence, and the gate reads both because a
 * cycle can fail for two different reasons with two different fixes.
 */
export interface InitiativeSnapshot {
  readonly id: string;
  readonly title: string;
  readonly capacity: "fits" | "tight" | "exceeds" | null;
  /** The kind of the objective it serves; left out, aspirational (§5.5). */
  readonly kind?: OkrKind;
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
  /** Why it stands alone, which gate 3 accepts as mapped (§4.5, P9-T16b-a). */
  readonly standaloneReason?: string | null;
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
  /** When the whole set was published, the last of the two steps. */
  readonly publishedAt: Date | string | null;
  /**
   * When the company set was published, the first step (METHOD.md §4.5,
   * P9-T03b). Null when it has not been, or when the set was published in one
   * go; `publishedAt` then carries both.
   */
  readonly companyPublishedAt?: Date | string | null;
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
  /**
   * How many key results the year this quarter sits in holds, which decides
   * whether phase 3's focus is a choice among them or a written note. Read on
   * its own because a year can hold key results before anybody writes the
   * frame. Falls back to the frame's count when a caller does not supply it.
   */
  readonly annualKeyResultCount?: number;
  readonly hasCapacityNotes: boolean;
  readonly frame: FrameSnapshot | null;
  /** The cycle's goals and key results. Undefined when not read. */
  readonly goals?: readonly GoalSnapshot[];
  /**
   * The initiatives serving this cycle's key results. Undefined until P5-T10a
   * ships the table.
   *
   * Deliberately not defaulted to an empty array, for the reason this file's own
   * header gives: an empty list says somebody looked and found no initiative at
   * `exceeds`, and gate 5 may pass on it. Undefined says nobody can look, and
   * gate 5 reports itself unevaluable instead of passing while checking half of
   * §5.5.
   */
  readonly initiatives?: readonly InitiativeSnapshot[];
  /**
   * An answer for phase 4 and gate 2 from a caller that has already judged
   * the set. Left undefined, both judge the goal snapshots themselves.
   */
  readonly qualityChecksPass?: boolean;
  /**
   * The §7.1 rhythm as booked, and the decision log. Undefined means nobody
   * read them, which keeps phase 6 unanswered rather than failed.
   */
  readonly cadence?: {
    readonly bookedForWholeCycle: boolean;
    readonly decisionCount: number;
    /** What is not booked, per space, as `cadenceCoverage` words it. */
    readonly gaps?: readonly string[];
  };
  /** Every key result in the cycle has its score. Undefined when not read. */
  readonly allKeyResultsScored?: boolean;
  /** The quarterly review's retro holds a note. Undefined when not read. */
  readonly retrospectiveWritten?: boolean;
  /**
   * The workspace's practice (METHOD.md §12), which sets how hard each check
   * is when phase 4 and gate 2 judge the set (P9-T03a). Absent reads as the
   * recommended practice, which is what a caller that has not read the
   * settings would otherwise have to assume anyway.
   */
  readonly practice?: ResolvedPractice;
  /** True when this space or workspace has "Coach strictness" at strict. */
  readonly strict?: boolean;
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
  "Every objective has a title and a champion, and a reviewer where required",
  "Every objective has key results, and nothing fails a check set to block",
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

function phaseZero(
  input: CycleWorkflowInput,
  thresholds: ResolvedThresholds,
): PhaseResult {
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
    // §11's `quality.annualStrategyBounds`, not the canon's two and five
    // written here (completeness review H-17).
    const bounds = thresholds["quality.annualStrategyBounds"];
    if (frame.strategyCount < bounds.low || frame.strategyCount > bounds.high) {
      missing.push(
        `${frame.strategyCount} annual strategies, and §2.1 asks for ${bounds.low} to ${bounds.high}`,
      );
    }
  }

  if (input.goals === undefined) {
    blocked.push("The company objectives could not be read");
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

  const minimum = thresholds["quality.strategicIssueMinimum"];
  if (input.issues.length < minimum) {
    missing.push(
      `${input.issues.length} strategic issue(s) ranked, and §2.3 asks for at least ${minimum}`,
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
  const frameHasAnnualKeyResults =
    (input.annualKeyResultCount ?? input.frame?.annualKeyResultCount ?? 0) > 0;
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

const OBJECTIVE_LEVELS = [
  "company",
  "department",
  "team",
  "individual",
] as const;

/**
 * One objective's §4.1 and §4.2 verdicts, with the workspace's check levels
 * applied (P9-T03a), exactly as the Draft Coach beside it judges them.
 *
 * The objective is in a cycle by construction, so OBJ-3 passes, and the count
 * OBJ-5 reads is the number of objectives at its level in this cycle, which is
 * the count the drafting surface shows.
 */
function goalVerdicts(
  goal: GoalSnapshot,
  goals: readonly GoalSnapshot[],
  thresholds: ResolvedThresholds,
  input: Pick<CycleWorkflowInput, "practice" | "strict">,
): {
  readonly objective: readonly QualityVerdict[];
  readonly keyResults: readonly KeyResultVerdict[];
} {
  const practice = input.practice ?? defaultPractice();
  const options = {
    strict:
      input.strict === true ||
      thresholds["quality.coachStrictness"] === "strict",
  };
  const level = (OBJECTIVE_LEVELS as readonly string[]).includes(goal.level)
    ? (goal.level as (typeof OBJECTIVE_LEVELS)[number])
    : "team";
  return {
    objective: applyEnforcement(
      evaluateObjective(
        {
          title: goal.title,
          hasCycle: true,
          hasTimeframe: false,
          championId: goal.championId,
          reviewerId: goal.reviewerId,
          reviewerRequired: practice.reviewer === "required",
          objectivesInUnit: goals.filter((other) => other.level === goal.level)
            .length,
          level,
        },
        thresholds,
      ),
      practice,
      options,
    ),
    keyResults: applyEnforcement(
      evaluateKeyResults(
        {
          keyResults: goal.keyResults.map((keyResult) => ({
            text: keyResult.title,
            ...(keyResult.quality as NonNullable<KeyResultSnapshot["quality"]>),
          })),
        },
        thresholds,
      ),
      practice,
      options,
    ),
  };
}

const unjudgedIn = (goals: readonly GoalSnapshot[]): boolean =>
  goals.some((goal) =>
    goal.keyResults.some((keyResult) => keyResult.quality === undefined),
  );

/**
 * §2.3 phase 4: "Every objective and key result passes the §4 quality
 * checks." Judged over the set here rather than read from a stored flag, so
 * the phase cannot disagree with the coach or with gate 2 (completeness
 * review H-09). A fail holds the phase and a warn does not, which is §4's own
 * reading of the two and the one gate 2 uses; strict strictness makes warns
 * fail, and then they hold it too.
 *
 * One condition per objective: the rail's bar fills as each objective and its
 * key results come clean.
 */
function phaseFour(
  input: CycleWorkflowInput,
  thresholds: ResolvedThresholds,
): PhaseResult {
  const base = { phase: 4, title: PHASE_TITLES[4] } as const;
  if (input.qualityChecksPass !== undefined) {
    // A caller that has already decided, which a test may be.
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
  const goals = input.goals;
  if (goals === undefined || unjudgedIn(goals)) {
    return {
      ...base,
      state: "todo",
      missing: [],
      blocked: ["The §4 verdicts across the set could not be read"],
      conditions: { met: 0, total: 0 },
    };
  }
  if (goals.length === 0) {
    const missing = ["No objective is drafted yet"];
    return {
      ...base,
      state: "todo",
      missing,
      blocked: [],
      conditions: conditionsOf(1, missing),
    };
  }

  const missing: string[] = [];
  for (const goal of goals) {
    const verdicts = goalVerdicts(goal, goals, thresholds, input);
    const failing = [...verdicts.objective, ...verdicts.keyResults]
      .filter((verdict) => verdict.status === "fail")
      .map((verdict) => verdict.id);
    if (failing.length > 0) {
      missing.push(`"${goal.title}" fails ${failing.join(", ")}`);
    }
  }
  return {
    ...base,
    state: missing.length === 0 ? "pass" : "todo",
    missing,
    blocked: [],
    conditions: conditionsOf(goals.length, missing),
  };
}

function phaseFive(
  input: CycleWorkflowInput,
  gates: readonly GateResult[],
): PhaseResult {
  const missing: string[] = [];
  const blocked: string[] = [];

  // Phase 5 waits for the gates set to block, as publishing does (§2.3). A
  // gate at warn is coached on the publish screen and does not hold it.
  for (const gate of gates.filter((entry) => entry.level === "block")) {
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
    missing.push(
      asDate(input.companyPublishedAt ?? null)
        ? "The department and team sets are not published"
        : "The set is not published",
    );
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
      gates.filter((gate) => gate.level === "block" && gate.evaluable).length +
        1,
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
      blocked: ["The booked sessions and the decision log could not be read"],
      conditions: { met: 0, total: 0 },
    };
  }
  const missing: string[] = [];
  if (!input.cadence.bookedForWholeCycle) {
    // One entry, because it is one condition. The gaps say where to look.
    const gaps = input.cadence.gaps ?? [];
    missing.push(
      gaps.length > 0
        ? `The cadence is not booked for the whole cycle. ${gaps.join(". ")}`
        : "The cadence is not booked for the whole cycle",
    );
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
    blocked.push("The key result scores could not be read");
  } else {
    total += 1;
    if (!input.allKeyResultsScored) {
      missing.push("Not every key result is scored");
    }
  }

  if (input.retrospectiveWritten === undefined) {
    blocked.push("The cycle retrospective could not be read");
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
/**
 * Which part of the set a publish judges (METHOD.md §4.5, P9-T03b).
 *
 * The company set publishes first, then the department and team sets. "rest"
 * is everything not yet published: the whole set, or only the department and
 * team sets once the company set is out.
 */
export type PublishScope = "company" | "teams" | "rest";

export function publishGates(
  input: CycleWorkflowInput,
  thresholds?: ResolvedThresholds,
  scope: PublishScope = "rest",
): readonly GateResult[] {
  const practice = input.practice ?? defaultPractice();
  const companyOut = Boolean(asDate(input.companyPublishedAt ?? null));
  const inScope = (goal: GoalSnapshot): boolean =>
    scope === "company"
      ? goal.level === "company"
      : scope === "teams" || companyOut
        ? goal.level !== "company"
        : true;
  const goals = input.goals?.filter(inScope);
  const goalsBlocked = "the goals and key results could not be read";
  const levelOf = (gateKey: number): GateEnforcement =>
    practice[`gates.${gateKey}` as `gates.${1 | 2 | 3 | 4 | 5 | 6}`];

  const gate = (
    gateKey: number,
    passed: boolean,
    missing: readonly string[],
  ): GateResult => ({
    gateKey,
    title: GATE_TITLES[gateKey - 1] as string,
    level: levelOf(gateKey),
    passed,
    evaluable: true,
    detail: { missing },
  });

  const unevaluable = (gateKey: number, blocked: string): GateResult => ({
    gateKey,
    title: GATE_TITLES[gateKey - 1] as string,
    level: levelOf(gateKey),
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
      // Only where the workspace requires reviewers (§2.5, P9-T04).
      if (!goal.reviewerId && practice.reviewer === "required") {
        problems.push(`"${goal.title}" has no reviewer`);
      }
      return problems;
    });
    results.push(gate(1, missing.length === 0, missing));
  }

  // 2. Every key result passes the §4.2 checks, and no objective fails OBJ-1.
  //
  // **A fail blocks and a warn does not**, which is §4's own wording: warn is
  // "worth another look", fail is "fix before publishing". A workspace that
  // wants warnings to block sets strictness to strict, and then they are fails
  // and this gate sees them as such. That is what the setting is for.
  //
  // **OBJ-1 joined on 28 September 2026** (completeness review H-09, decided
  // by a human). REQUIREMENTS §3.2's acceptance has an objective beginning
  // "Launch the new mobile app" block publishing until it passes or is
  // overridden with a reason; §4.5 judged key results only, so it never did.
  //
  // `qualityChecksPass` stays supported for a caller that has already decided,
  // and it wins when given. Otherwise the gate evaluates the set itself, so it
  // cannot disagree with the coach that judged the same key results.
  if (input.qualityChecksPass !== undefined) {
    results.push(
      gate(
        2,
        input.qualityChecksPass,
        input.qualityChecksPass
          ? []
          : ["Some key results do not pass the §4.2 checks"],
      ),
    );
  } else if (!goals || !thresholds) {
    results.push(
      unevaluable(
        2,
        goals ? "no thresholds were resolved for this workspace" : goalsBlocked,
      ),
    );
  } else {
    if (unjudgedIn(goals)) {
      results.push(
        unevaluable(2, "some key results carry nothing for §4.2 to judge"),
      );
    } else {
      const failures: string[] = [];
      // Nothing to publish is not a set (P9-T03b). With every other gate
      // passing vacuously on an empty set, this is what keeps a cycle with no
      // objectives from publishing. The team step after the company set is
      // the exception: a cycle whose OKRs are all company OKRs finishes there.
      if (goals.length === 0 && !(companyOut && scope !== "company")) {
        failures.push("Nothing is drafted to publish yet");
      }
      for (const goal of goals) {
        // METHOD.md §4.5 since P9-T03b: every objective has a key result, and
        // nothing fails a check set to block. OBJ-3 and OBJ-4 are left to the
        // structure and to gate 1, which already name them.
        if (goal.keyResults.length === 0) {
          failures.push(`"${goal.title}" has no key results`);
        }
        const judged = goalVerdicts(goal, goals, thresholds, input);
        for (const outcome of judged.objective.filter(
          (entry) =>
            entry.status === "fail" &&
            entry.id !== "OBJ-3" &&
            entry.id !== "OBJ-4",
        )) {
          failures.push(`${outcome.id} on "${goal.title}": ${outcome.prompt}`);
        }
        for (const verdict of judged.keyResults.filter(
          (entry) =>
            entry.status === "fail" &&
            // Already named above as "has no key results".
            !(entry.id === "KR-1" && goal.keyResults.length === 0),
        )) {
          const offenders = verdict.keyResults
            .map((index) => goal.keyResults[index]?.title)
            .filter((title): title is string => title !== undefined);
          failures.push(
            offenders.length > 0
              ? `${verdict.id} on ${offenders.map((title) => `"${title}"`).join(", ")} in "${goal.title}"`
              : `${verdict.id} on the set under "${goal.title}"`,
          );
        }
      }
      results.push(gate(2, failures.length === 0, failures));
    }
  }

  // 3. Alignment is mapped: each objective states what it contributes to,
  // or why it stands alone.
  if (goals === undefined) {
    results.push(unevaluable(3, goalsBlocked));
  } else {
    const missing = goals
      .filter(
        (goal) =>
          !goal.hasParent &&
          isBlank(goal.contributionStatement) &&
          isBlank(goal.standaloneReason),
      )
      .map(
        (goal) =>
          `"${goal.title}" has no parent, states no contribution and gives no reason to stand alone`,
      );
    results.push(gate(3, missing.length === 0, missing));
  }

  // 4. Every dependency is confirmed, escalated to the sponsor, or logged with
  // a named risk owner (§4.5, §5.4).
  if (goals === undefined) {
    results.push(unevaluable(4, goalsBlocked));
  } else if (
    goals.some((goal) =>
      goal.keyResults.some((keyResult) => keyResult.dependencies === undefined),
    )
  ) {
    results.push(
      unevaluable(4, "the §5.4 dependency register could not be read"),
    );
  } else {
    const missing = goals.flatMap((goal) =>
      goal.keyResults.flatMap((keyResult) =>
        (keyResult.dependencies ?? [])
          .filter(
            (dependency) =>
              !dependency.confirmed &&
              !dependency.riskOwnerId &&
              !dependency.escalatedToId,
          )
          .map(
            () =>
              `"${keyResult.title}" has a dependency that is neither confirmed, escalated nor risk-owned`,
          ),
      ),
    );
    results.push(gate(4, missing.length === 0, missing));
  }

  // 5. Capacity is checked, no committed OKR left at "exceeds", and the cuts
  // recorded. An aspirational OKR may exceed (§5.5, P9-T11a).
  if (goals === undefined) {
    results.push(unevaluable(5, goalsBlocked));
  } else if (input.initiatives === undefined) {
    // §5.5 is one sentence about two things: the measures and the initiatives
    // that will move them. Passing on the half that exists would be the exact
    // failure this file's header records from Phase 1.
    results.push(
      unevaluable(5, "the §5.5 initiative register could not be read"),
    );
  } else {
    const missing = goals.flatMap((goal) =>
      goal.keyResults
        .filter(
          (keyResult) =>
            keyResult.capacity === "exceeds" && keyResult.kind === "committed",
        )
        .map(
          (keyResult) =>
            `"${keyResult.title}" is committed and still exceeds capacity`,
        ),
    );
    // Named, because "gate five is red" sends a facilitator hunting and "this
    // project is over-committed" does not.
    missing.push(
      ...input.initiatives
        .filter(
          (initiative) =>
            initiative.capacity === "exceeds" &&
            initiative.kind === "committed",
        )
        .map(
          (initiative) =>
            `"${initiative.title}" serves a committed OKR and still exceeds capacity`,
        ),
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

  // A gate at off is not judged (METHOD.md §12): it reads passed, with
  // nothing missing, whatever its rule would have said.
  return results.map((result) =>
    result.level === "off"
      ? { ...result, passed: true, evaluable: true, detail: { missing: [] } }
      : result,
  );
}

/**
 * True when every gate at block is green and evaluable (P9-T03b). A gate at
 * warn shows what it found and never holds publication.
 */
export function canPublish(gates: readonly GateResult[]): boolean {
  return (
    gates.length === 6 &&
    gates.every(
      (gate) => gate.level !== "block" || (gate.evaluable && gate.passed),
    )
  );
}

/** Every phase's completion, phase 0 first. */
export function phaseCompletion(
  input: CycleWorkflowInput,
  thresholds: ResolvedThresholds,
): readonly PhaseResult[] {
  // With the thresholds, so gate 2 is judged here exactly as it is at
  // publication rather than reported as unevaluable on phase 5's rail
  // (completeness review H-09).
  const gates = publishGates(input, thresholds);
  return [
    phaseZero(input, thresholds),
    phaseOne(input, thresholds),
    phaseTwo(input, thresholds),
    phaseThree(input, thresholds),
    phaseFour(input, thresholds),
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
