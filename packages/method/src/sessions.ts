import type { ResolvedThresholds } from "./thresholds.ts";

/**
 * The rituals as data: METHOD.md §7 and §8 (P4-T01f).
 *
 * The stage lists are what the session rails render and what the timers pace,
 * so they live here rather than in a component. A screen that carries its own
 * copy of the eleven stages is a screen that can disagree with the method about
 * how long a review takes.
 *
 * **Structure is canon, minutes are a parameter.** §11 opens by saying the
 * session agendas and their stage order cannot be changed, and then lists
 * "Quarterly stage minutes" as a parameter in the same registry. So the stage
 * list here carries titles, acts and purposes, and `reviewStages` attaches the
 * durations from `sessions.quarterlyStageMinutes`.
 *
 * That split was wrong here for one commit: the durations were written as
 * literals with a comment arguing they did not belong in §11. `pnpm
 * method:check` found it by comparing the registry against §11's own table,
 * which is the whole reason the suite exists.
 */

/**
 * The five blocker types from METHOD.md §7.3, with the definitions the
 * session UI shows beside each picker option.
 */
export const BLOCKER_TYPE_DEFINITIONS = [
  {
    type: "resource" as const,
    label: "Resource",
    definition: "No capacity, budget or tools to progress the key result",
  },
  {
    type: "dependency" as const,
    label: "Dependency",
    definition: "Progress waits on another team's output or decision",
  },
  {
    type: "clarity" as const,
    label: "Clarity",
    definition: "The key result is ambiguous. Nobody agrees what done means",
  },
  {
    type: "priority_conflict" as const,
    label: "Priority conflict",
    definition: "Business as usual keeps displacing OKR work",
  },
  {
    type: "external" as const,
    label: "External",
    definition: "Market, regulation or partner factors beyond your control",
  },
] as const;

export type RitualKind = "weekly" | "monthly" | "quarterly";

/**
 * Stage keys for weekly sessions, in §7.2's order.
 *
 * These are what the database stores in `sessions.stage_key`. The order is
 * canon and matches WEEKLY_STEPS step-for-step: index 0 is step 1
 * (confidence), index 3 is step 4 (digest).
 */
export const WEEKLY_STAGE_KEYS = [
  "confidence",
  "diagnose",
  "commitments",
  "digest",
] as const;
export type WeeklyStageKey = (typeof WEEKLY_STAGE_KEYS)[number];

export interface Ritual {
  readonly kind: RitualKind;
  /** §7.1's own wording, because a range is not a number. */
  readonly length: string;
  readonly frequency: string;
  readonly purpose: string;
}

/** §7.1's three rituals. */
export const RITUALS: readonly Ritual[] = [
  {
    kind: "weekly",
    length: "15 to 30 minutes",
    frequency: "Weekly",
    purpose:
      "A decision loop. Score confidence, diagnose what is low, close and set commitments",
  },
  {
    kind: "monthly",
    length: "30 to 60 minutes",
    frequency: "Monthly",
    purpose:
      "Trend per objective, dependency and risk log, resource shifts, decisions recorded",
  },
  {
    kind: "quarterly",
    length: "60 minutes",
    frequency: "At cycle close",
    purpose:
      "Review the results, retro the way you worked, reset the next cycle",
  },
];

export interface WeeklyStep {
  /** 1 to 4, as §7.2 numbers them. */
  readonly step: number;
  readonly title: string;
  readonly purpose: string;
}

/**
 * §7.2's four steps.
 *
 * No minutes: §7.1 gives the whole check-in a range rather than a budget per
 * step, and inventing four numbers that sum to it would put a figure in the
 * product that the method never wrote.
 */
export const WEEKLY_STEPS: readonly WeeklyStep[] = [
  {
    step: 1,
    title: "Confidence round",
    purpose:
      "Every key result gets a confidence. Votes reveal together so nobody anchors on the champion, and the champion writes what changed this week",
  },
  {
    step: 2,
    title: "Diagnose what is low",
    purpose:
      "High and medium move on with no discussion. Every low score gets a blocker type, a named owner and one concrete action within 24 hours",
  },
  {
    step: 3,
    title: "Commitments",
    purpose:
      "Close last week's out loud, delivered or not, with no negotiation. Then set two or three for this week, each with an owner and a linked key result",
  },
  {
    step: 4,
    title: "Digest",
    purpose:
      "The product assembles it. The coordinator adds a note for leadership and it posts to the team's channel",
  },
];

export type ReviewAct = "open" | "review" | "retro" | "reset";

export interface ReviewStage {
  /** 1 to 11, as §8.1 numbers them. */
  readonly stage: number;
  readonly title: string;
  readonly act: ReviewAct;
  readonly purpose: string;
}

/** A stage with the duration the registry gives it. */
export interface TimedReviewStage extends ReviewStage {
  readonly minutes: number;
}

/** §8.1's eleven stages, in order. The order is canon; the minutes are not. */
export const REVIEW_STAGES: readonly ReviewStage[] = [
  {
    stage: 1,
    title: "Open and check-in",
    act: "open",
    purpose:
      "Before the numbers, the people. A pulse and one word for the cycle",
  },
  {
    stage: 2,
    title: "Score the key results",
    act: "review",
    purpose:
      "Grade every key result against the key result as written, then reveal the objective score together",
  },
  {
    stage: 3,
    title: "Objective narratives",
    act: "review",
    purpose:
      "Owner by owner, the story behind the score, and what the number does not show",
  },
  {
    stage: 4,
    title: "Recognition and wins",
    act: "review",
    purpose:
      "Name the effort that deserved to be seen. Specific beats generous",
  },
  {
    stage: 5,
    title: "Team retro",
    act: "retro",
    purpose: "What worked, what did not. Silent writing, then dot voting",
  },
  {
    stage: 6,
    title: "Management retro",
    act: "retro",
    purpose: "The four questions leadership owes the team",
  },
  {
    stage: 7,
    title: "Root cause and diagnostic",
    act: "retro",
    purpose:
      "Every key result under 0.7 gets one honest cause. Then read the diagnostic",
  },
  {
    stage: 8,
    title: "OKR process health",
    act: "retro",
    purpose: "Score the practice, not the results. Anonymous",
  },
  {
    stage: 9,
    title: "Keep, modify or abandon",
    act: "reset",
    purpose: "Close every objective deliberately",
  },
  {
    stage: 10,
    title: "Learnings and next drafts",
    act: "reset",
    purpose: "Turn what happened into what you now know",
  },
  {
    stage: 11,
    title: "Decisions and actions",
    act: "reset",
    purpose: "Every action has a name and a date, or it is a wish",
  },
];

/**
 * The eleven stages with their durations, which is what a rail renders and a
 * timer paces. A workspace that has tuned the parameter gets its own numbers
 * here rather than being shown the canon ones and timed by something else.
 */
export function reviewStages(
  thresholds: ResolvedThresholds,
): readonly TimedReviewStage[] {
  const minutes = thresholds["sessions.quarterlyStageMinutes"];
  return REVIEW_STAGES.map((stage, index) => ({
    ...stage,
    minutes: minutes[index] as number,
  }));
}

/**
 * §8.5's five statements, anonymous, scored 1 to 5.
 *
 * The order is the document's, and it is load-bearing: the rhythm score is the
 * average of statements 2 and 5, so renumbering these silently changes the
 * diagnostic. `RHYTHM_STATEMENTS` names them rather than leaving two indexes
 * written down somewhere else.
 */
export const PROCESS_HEALTH_STATEMENTS: readonly string[] = [
  "Our OKRs stayed visible and were genuinely used to make decisions this cycle.",
  "We held a real check-in cadence, not a status report.",
  "Our key results measured outcomes, not activity we were going to do anyway.",
  "We had few enough OKRs that focus was possible.",
  "When something went off track, we said so early rather than at the end.",
];

/** The two §8.5 statements §8.6 averages into the rhythm score, one-based. */
export const RHYTHM_STATEMENTS: readonly number[] = [2, 5];

/** §8.7's four questions, answered out loud before anyone drafts a next cycle. */
export const MANAGEMENT_RETRO_QUESTIONS: readonly string[] = [
  "Were we focused on the right priorities?",
  "Did our OKRs bridge strategy and execution?",
  "Did we change how we work, or reinforce old habits?",
  "Where did alignment break down?",
];

export type DiagnosisKind =
  | "results_delivered"
  | "strategy_or_quality"
  | "rhythm";

export interface Diagnosis {
  readonly kind: DiagnosisKind;
  readonly diagnosis: string;
  readonly prescription: string;
}

/**
 * §8.6's rhythm diagnostic, which METHOD.md calls the most valuable output of
 * the review.
 *
 * Two numbers in, one verdict out. The cycle score is the §3.4 portfolio
 * average over every scored key result; the rhythm score is the average of the
 * two §8.5 statements about cadence and candour.
 *
 * The first row is the whole answer when it holds: at or above the cycle
 * threshold the rhythm score is not consulted at all, because a delivered cycle
 * raises a question about ambition rather than about process. Below it, the
 * rhythm score decides which of two opposite fixes applies, and getting that
 * backwards is the failure the section exists to prevent: pushing a team that
 * already ran the rhythm, or rewriting objectives for a team that never met.
 */
export function rhythmDiagnostic(
  cycleScore: number,
  rhythmScore: number,
  thresholds: ResolvedThresholds,
): Diagnosis {
  const cycleFloor = thresholds["sessions.diagnosticCycleScore"];
  const rhythmFloor = thresholds["sessions.diagnosticRhythmScore"];

  if (cycleScore >= cycleFloor) {
    return {
      kind: "results_delivered",
      diagnosis: "Results delivered",
      prescription:
        "The question is not effort. It is whether the ambition was set high enough to be worth the quarter",
    };
  }
  if (rhythmScore >= rhythmFloor) {
    return {
      kind: "strategy_or_quality",
      diagnosis: "Strategy or OKR-quality problem",
      prescription:
        "The team ran the rhythm and still missed. The OKRs themselves, or the strategy behind them, were wrong. Fix the key results before you push the team",
    };
  }
  return {
    kind: "rhythm",
    diagnosis: "Rhythm problem",
    prescription:
      "This is a cadence problem, not an ambition problem. Restore the weekly check-in before you rewrite a single objective",
  };
}

/**
 * The rhythm score from a full set of §8.5 responses.
 *
 * `responses` is one score per statement, in §8.5's order. Null where nobody
 * answered a statement, which returns null rather than treating an unanswered
 * statement as a zero: a diagnostic built on a missing answer is worse than no
 * diagnostic, because it reads as evidence.
 */
export function rhythmScore(
  responses: readonly (number | null)[],
): number | null {
  const wanted = RHYTHM_STATEMENTS.map((position) => responses[position - 1]);
  if (wanted.some((value) => value === null || value === undefined)) {
    return null;
  }
  return (
    wanted.reduce((sum: number, value) => sum + (value as number), 0) /
    wanted.length
  );
}

/** The statement that becomes next cycle's process OKR (§8.5's closing rule). */
export function lowestProcessHealthStatement(
  responses: readonly (number | null)[],
): { readonly position: number; readonly statement: string } | null {
  let best: { position: number; value: number } | null = null;
  for (const [index, value] of responses.entries()) {
    if (value === null || value === undefined) {
      continue;
    }
    // Strictly lower, so a tie keeps the earlier statement and the answer does
    // not depend on iteration order.
    if (best === null || value < best.value) {
      best = { position: index + 1, value };
    }
  }
  if (best === null) {
    return null;
  }
  return {
    position: best.position,
    statement: PROCESS_HEALTH_STATEMENTS[best.position - 1] as string,
  };
}
