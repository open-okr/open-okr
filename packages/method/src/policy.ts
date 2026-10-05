/**
 * One policy decides every practice refusal (METHOD.md §2.3, §2.9, P9-T02).
 *
 * The drafting lock this replaces (completeness review H-09) is the reason the
 * policy exists. A judgement METHOD.md gave the facilitator became a refusal
 * applied to everybody, it was written in one action and only when the cycle
 * screen passed a flag, so the API, the command line and the copilot never met
 * it, and nothing could switch it off. So:
 * - **Every practice refusal is decided here**, by one pure function, from the
 *   workspace's practice settings (§12). An action asks through
 *   `requirePolicy` in packages/core, and a source test fails the build when an
 *   OKR write neither asks nor says in writing why it need not.
 * - **By default nothing is refused.** Anybody who can edit a space writes at
 *   any time (principle 11). A workspace that wants the planning workflow to
 *   bind chooses it.
 * - **Every refusal cites the setting that caused it**, so a person refused
 *   can see which choice did it, and an admin can find where to change it.
 *
 * Access is not decided here. Whether a member may edit a space at all is the
 * relationship model's question, answered by `can()` before this runs.
 *
 * Pure. No database, no clock: the caller passes the date.
 */
import {
  type KeyResultKind,
  type OkrLevel,
  okrKindsInUse,
  type PracticeKey,
  type ResolvedPractice,
} from "./practice.ts";
import type { OkrKind } from "./scoring.ts";
import type { ResolvedThresholds } from "./thresholds.ts";
import type { PhaseResult } from "./workflow.ts";

/** What the policy needs to know about the cycle being written into. */
export interface CycleFacts {
  readonly mode: "annual" | "quarterly";
  /** The cycle's first day, as a local `YYYY-MM-DD`. */
  readonly startsOn: string;
  /** Today, in the workspace's timezone, as a local `YYYY-MM-DD`. */
  readonly today: string;
  /**
   * Whether the cycle's set has been published (§4.5). An addition is an
   * addition to a published plan; before that, whatever is written, however
   * late, is the plan (P9-T13-a). Left out, not published.
   */
  readonly published?: boolean;
  /**
   * The phases as `phaseCompletion` computes them. Needed only when drafting
   * waits for the phases, so a caller may leave it out otherwise and save the
   * reads; `policyNeedsPhases` says when.
   */
  readonly phases?: readonly PhaseResult[];
}

export type PolicyIntent =
  /**
   * A new objective. `cycle` is null for one with its own timeframe.
   * `hasReviewer` says whether it names one, which a workspace that requires
   * reviewers asks of every objective (§2.5, P9-T04).
   */
  | {
      readonly kind: "objective.create";
      readonly cycle: CycleFacts | null;
      readonly hasReviewer?: boolean;
      /**
       * The level it is written at, and the levels its cycle uses (§2.7,
       * P9-T07a-c). Both or neither: a caller that cannot say which levels
       * are in use is not asking this question.
       */
      readonly level?: OkrLevel;
      readonly levelsInUse?: readonly OkrLevel[];
      /** The kind it is written as, when the writer chose one (§2.8). */
      readonly okrKind?: OkrKind;
      /** Whether the writer said why it starts now (§2.9, P9-T13-a). */
      readonly hasReason?: boolean;
    }
  /** Changing an objective's kind (§2.8, P9-T11b-a). */
  | { readonly kind: "objective.kind"; readonly okrKind: OkrKind }
  /**
   * Writing a key result as one of §2.10's kinds, new or changed (P9-T12a).
   */
  | { readonly kind: "keyResult.kind"; readonly keyResultKind: KeyResultKind }
  /** Taking the reviewer off an objective that has one (P9-T04). */
  | { readonly kind: "reviewer.remove" }
  /** A new key result on an objective that already exists. */
  | {
      readonly kind: "keyResult.create";
      readonly cycle: CycleFacts | null;
      /** Whether the writer said why it starts now (§2.9, P9-T13-a). */
      readonly hasReason?: boolean;
    }
  /**
   * Publishing a set, or the company half of one (P9-T03b). The gates judge
   * what is published; this decides only whether publishing may happen yet.
   */
  | { readonly kind: "set.publish"; readonly cycle: CycleFacts }
  /**
   * Changing a key result's target (P9-T06b, METHOD v2 §2.9). Only easing
   * one, toward its baseline, can be refused, and only for want of a reason.
   */
  | {
      readonly kind: "target.change";
      readonly from: number;
      readonly to: number;
      readonly baseline: number;
      readonly hasReason: boolean;
    };

export interface PolicyDecision {
  readonly outcome: "allow" | "block";
  /** The practice settings that decided it. Empty when nothing was refused. */
  readonly rules: readonly PracticeKey[];
  /** Plain sentences for the person refused. */
  readonly reasons: readonly string[];
}

const ALLOW: PolicyDecision = { outcome: "allow", rules: [], reasons: [] };

const REVIEWER_REQUIRED: PolicyDecision = {
  outcome: "block",
  rules: ["reviewer"],
  reasons: [
    "This workspace asks every objective to name a reviewer, who acknowledges its check-ins. Name one.",
  ],
};

/**
 * The phases drafting waits for, when it waits at all (§2.3: "Drafting waits
 * for phases 1 to 3").
 *
 * Not phase 0. Phase 0 of an annual cycle is complete when an annual OKR
 * exists, so waiting for it before anybody may draft one would refuse the
 * very writing that completes it.
 */
const PHASES_BEFORE_DRAFTING = [1, 2, 3] as const;

/** Whether drafting waits for the phases under this practice. */
export function draftingWaitsForPhases(practice: ResolvedPractice): boolean {
  return (
    practice["phases.enforcement"] === "binding" ||
    practice["writing.when"] === "afterPhases"
  );
}

/** Whether `decide` needs `CycleFacts.phases` for this intent and practice. */
export function policyNeedsPhases(
  intent: PolicyIntent,
  practice: ResolvedPractice,
): boolean {
  if (
    intent.kind === "reviewer.remove" ||
    intent.kind === "target.change" ||
    intent.kind === "objective.kind" ||
    intent.kind === "keyResult.kind"
  ) {
    return false;
  }
  if (intent.kind === "set.publish") {
    return practice["phases.enforcement"] === "binding";
  }
  return intent.cycle !== null && draftingWaitsForPhases(practice);
}

/** Days added to a local `YYYY-MM-DD` date, as another local date. */
function addDays(on: string, days: number): string {
  const [year, month, day] = on.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/**
 * The window new objectives may be created in under "Planning window" (§2.9):
 * from planning-open until the team publication window closes, both by §11.
 */
export function planningWindow(
  cycle: Pick<CycleFacts, "mode" | "startsOn">,
  thresholds: ResolvedThresholds,
): { readonly opensOn: string; readonly closesOn: string } {
  const lead = thresholds["cadence.planningOpenLeadWeeks"][cycle.mode];
  const window = thresholds["cadence.teamPublicationWindowWeeks"];
  return {
    opensOn: addDays(cycle.startsOn, -7 * lead),
    // The last day inside the window: two weeks after a Friday the 1st is the
    // 14th, not the 15th.
    closesOn: addDays(cycle.startsOn, 7 * window - 1),
  };
}

/**
 * The cycle's phases, which a caller must have read when the practice makes a
 * decision depend on them. One that did not cannot be told yes on a question
 * about them: a programming error in the caller, refused loudly rather than
 * allowed quietly.
 */
function requirePhases(cycle: CycleFacts): readonly PhaseResult[] {
  if (cycle.phases === undefined) {
    throw new Error(
      "decide() needs the cycle's phases under this practice; read them first (policyNeedsPhases).",
    );
  }
  return cycle.phases;
}

/** Which of the setting keys is waiting for the phases, for the citation. */
function phaseRules(practice: ResolvedPractice): PracticeKey[] {
  const rules: PracticeKey[] = [];
  if (practice["phases.enforcement"] === "binding") {
    rules.push("phases.enforcement");
  }
  if (practice["writing.when"] === "afterPhases") {
    rules.push("writing.when");
  }
  return rules;
}

/**
 * Whether something written now is started mid-cycle (§2.9, P9-T13-a): the
 * team publication window has closed and the cycle's set is published.
 *
 * "OKRs created before the team publication window closes are the cycle's
 * plan, not additions." The second condition is this package's reading of a
 * case §2.9 does not name, a set still unpublished after its window: there is
 * no plan to add to yet, so what is written is the plan, late, and it faces
 * the publish gates like the rest of it.
 */
export function isMidCycleAddition(
  cycle: Pick<CycleFacts, "mode" | "startsOn" | "today" | "published">,
  thresholds: ResolvedThresholds,
): boolean {
  return (
    cycle.published === true &&
    cycle.today > planningWindow(cycle, thresholds).closesOn
  );
}

/**
 * Whether a target change eases the key result, by moving its target closer
 * to the baseline (METHOD v2 §2.9).
 *
 * Judged by distance rather than by direction, which says the same thing for
 * an increase and a reduce and still answers for a maintain or a move: on an
 * increase from 40, 100 to 80 eases and 100 to 110 does not; on a reduce
 * from 100, 50 to 70 eases. Equal distance is not easing, so a target moved
 * to the mirror side of its baseline asks for nothing.
 */
export function isEasing(change: {
  readonly from: number;
  readonly to: number;
  readonly baseline: number;
}): boolean {
  return (
    Math.abs(change.to - change.baseline) <
    Math.abs(change.from - change.baseline)
  );
}

/**
 * Decides whether a write the practice governs may go ahead.
 *
 * Nothing about the quality of what is written is decided here: checks coach
 * as somebody types and the publish gates judge a set. This answers only
 * "may this be written now", which by default is always yes.
 */
export function decide(
  intent: PolicyIntent,
  practice: ResolvedPractice,
  thresholds: ResolvedThresholds,
): PolicyDecision {
  // §2.5: where a workspace requires reviewers, every objective names one,
  // whoever writes it and through whichever surface.
  const reviewerRequired = practice.reviewer === "required";
  if (intent.kind === "reviewer.remove") {
    return reviewerRequired ? REVIEWER_REQUIRED : ALLOW;
  }
  // §2.8: a workspace may work with one kind only, and then an objective
  // promised as the other would be judged by rules nobody uses here.
  if (
    (intent.kind === "objective.kind" || intent.kind === "objective.create") &&
    intent.okrKind !== undefined &&
    !okrKindsInUse(practice).includes(intent.okrKind)
  ) {
    return {
      outcome: "block",
      rules: ["okr.kinds"],
      reasons: [
        `This workspace uses ${okrKindsInUse(practice)[0]} OKRs only, so an objective cannot be ${intent.okrKind}.`,
      ],
    };
  }
  if (intent.kind === "objective.kind") {
    return ALLOW;
  }
  // §2.10: a workspace may turn any kind of key result off, and then one
  // written as that kind would be judged by rules nobody here uses.
  if (intent.kind === "keyResult.kind") {
    const key = `keyResultKinds.${intent.keyResultKind}` as const;
    return practice[key] === "off"
      ? {
          outcome: "block",
          rules: [key],
          reasons: [
            `This workspace does not use ${intent.keyResultKind} key results. Choose another kind, or ask an admin to turn this one on.`,
          ],
        }
      : ALLOW;
  }
  // §2.9: making a target harder never needs a reason; easing one does where
  // the workspace asks for it, and "it got hard" is not one.
  if (intent.kind === "target.change") {
    if (
      intent.hasReason ||
      practice["reasons.easingTarget"] !== "required" ||
      !isEasing(intent)
    ) {
      return ALLOW;
    }
    return {
      outcome: "block",
      rules: ["reasons.easingTarget"],
      reasons: [
        `Easing a target needs a written reason: ${intent.from} to ${intent.to} moves it toward its baseline of ${intent.baseline}. The original target stays on record, and "it got hard" is not a reason.`,
      ],
    };
  }
  if (
    intent.kind === "objective.create" &&
    intent.hasReviewer === false &&
    reviewerRequired
  ) {
    return REVIEWER_REQUIRED;
  }
  // §2.7: a cycle uses the levels it began with, so an objective at a level
  // it does not use would sit somewhere nothing reads.
  if (
    intent.kind === "objective.create" &&
    intent.level !== undefined &&
    intent.levelsInUse !== undefined &&
    !intent.levelsInUse.includes(intent.level)
  ) {
    return {
      outcome: "block",
      rules: [`levels.${intent.level}`],
      reasons: [
        `This cycle uses ${intent.levelsInUse.join(", ")} objectives, so a ${intent.level} objective has no place in it. A change to the levels in use applies to cycles that have not started.`,
      ],
    };
  }

  const cycle = intent.cycle;
  // An objective with its own timeframe is in no cycle, so no phase and no
  // window applies to it.
  if (cycle === null) {
    return ALLOW;
  }

  // §2.3: under binding phases, publishing waits for phase 4, so a set is
  // never published while something in it fails a check set to block.
  if (intent.kind === "set.publish") {
    if (practice["phases.enforcement"] !== "binding") {
      return ALLOW;
    }
    const four = requirePhases(cycle).find((result) => result.phase === 4);
    if (four?.state === "todo") {
      return {
        outcome: "block",
        rules: ["phases.enforcement"],
        reasons: [
          `This workspace publishes after drafting is complete, and phase 4 is not. ${four.missing.join(". ")}.`,
        ],
      };
    }
    return ALLOW;
  }

  if (draftingWaitsForPhases(practice)) {
    const missing = requirePhases(cycle)
      .filter(
        (result) =>
          (PHASES_BEFORE_DRAFTING as readonly number[]).includes(
            result.phase,
          ) && result.state === "todo",
      )
      .flatMap((result) =>
        result.missing.map((reason) => `Phase ${result.phase}: ${reason}`),
      );
    if (missing.length > 0) {
      return {
        outcome: "block",
        rules: phaseRules(practice),
        reasons: [
          `This workspace drafts after the planning phases are complete, and phases 1 to 3 are not. ${missing.join(". ")}.`,
        ],
      };
    }
  }

  // §2.9: a start mid-cycle says why where the workspace asks it to, from
  // every surface alike.
  if (
    (intent.kind === "objective.create" ||
      intent.kind === "keyResult.create") &&
    intent.hasReason !== true &&
    practice["reasons.midCycleAddition"] === "required" &&
    isMidCycleAddition(cycle, thresholds)
  ) {
    return {
      outcome: "block",
      rules: ["reasons.midCycleAddition"],
      reasons: [
        "This workspace asks why anything is added mid-cycle. Say in a line why it starts now.",
      ],
    };
  }

  // "Changes to existing ones stay open" (§2.9): a key result added to an
  // objective that exists is a change to it, so only a new objective waits for
  // the window.
  if (
    intent.kind === "objective.create" &&
    practice["writing.when"] === "planningWindow"
  ) {
    const window = planningWindow(cycle, thresholds);
    if (cycle.today < window.opensOn || cycle.today > window.closesOn) {
      return {
        outcome: "block",
        rules: ["writing.when"],
        reasons: [
          `This workspace creates new objectives in the planning window, from ${window.opensOn} to ${window.closesOn}. Changes to objectives that already exist stay open.`,
        ],
      };
    }
  }

  return ALLOW;
}
