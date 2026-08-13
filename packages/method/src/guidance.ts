/**
 * Facilitator guidance and the two horizons as data (METHOD.md §2.1, §2.2,
 * §2.4, §9, P3-T03).
 *
 * The right rail of the cycle workspace (UIUX-PLAN.md §4 S-04) shows "the
 * facilitator guidance for this phase, the phase's key output, and the mode note
 * for annual versus quarterly". All three are practice, so all three live here
 * rather than in a React component. A phase panel that wanted to say something
 * encouraging of its own invention would be inventing method.
 *
 * `guidance` is the §9 cell split at its own sentence boundaries, nothing added
 * and nothing dropped, so the conformance suite (P4-T01) can join a phase's
 * sentences with ". " and compare the result against the document. Splitting is
 * presentation: a facilitator reads four directives more easily as four lines
 * than as one paragraph, and the words are still the document's.
 */

export interface PhaseGuidance {
  /** 0 to 7, the §2.2 position. */
  readonly phase: number;
  /** §2.2 "Phase". */
  readonly title: string;
  /** §2.2 "Output": what this phase must produce before it is done. */
  readonly output: string;
  /** §9 "Guidance", sentence by sentence. */
  readonly guidance: readonly string[];
}

export const PHASE_GUIDANCE: readonly PhaseGuidance[] = [
  {
    phase: 0,
    title: "Annual strategy",
    output: "The annual frame and the annual OKRs",
    guidance: [
      "Run this once a year with the most senior group in the room, before any quarterly cycle starts",
      "Keep it to five annual objectives at most",
      "If the annual set already contains everything, no quarter can choose",
    ],
  },
  {
    phase: 1,
    title: "Prepare",
    output: "Planning brief and a complete input pack",
    guidance: [
      "Refuse to run Phase 4 without a complete input pack",
      "This is the most common failure point",
      "Timebox the gathering",
      "An incomplete pack on time beats a complete pack late",
    ],
  },
  {
    phase: 2,
    title: "Diagnose",
    output: "Scored prior OKRs and a ranked issue list",
    guidance: [
      "Keep scoring factual",
      "Scores are planning data, not appraisal",
      "The moment they feel like appraisal, candour dies",
      "If prior OKRs were never tracked, record that as a process issue to fix in Phase 6",
    ],
  },
  {
    phase: 3,
    title: "Set direction",
    output: "A priority list for the horizon",
    guidance: [
      "Force trade-offs",
      "A priority list that accommodates everything is a to-do list, not a strategy",
      "Push until the not-doing list is written down",
      "Quarterly revalidation takes 30 to 60 minutes, not a full strategy debate",
    ],
  },
  {
    phase: 4,
    title: "Draft OKRs",
    output: "A draft OKR set with owners, passing every quality check",
    guidance: [
      "The most frequent defect is the task-shaped key result",
      "The tell is a leading verb like launch, complete or deliver",
      'Ask "what changes if this succeeds?" and measure that',
      "Missing baselines are second",
      "If a baseline is unknown, establishing it can be the first key result",
      "Run peer review between teams before leadership sees the drafts",
    ],
  },
  {
    phase: 5,
    title: "Align and commit",
    output: "A published, aligned OKR set",
    guidance: [
      "Run alignment and dependencies as a joint session or a structured asynchronous review",
      "Watch for silent overload",
      "Teams rarely volunteer that the plan does not fit",
      "Ask each team directly what they cut",
      "If the answer is nothing, capacity was not checked",
    ],
  },
  {
    phase: 6,
    title: "Run the cadence",
    output: "Check-ins, reviews and a decision log",
    guidance: [
      "Book every check-in and review for the whole cycle before it starts",
      "Keep check-ins forward-looking",
      "Status lives in the product, the meeting is for decisions",
    ],
  },
  {
    phase: 7,
    title: "Review and learn",
    output: "Scores, learnings and the next cycle's inputs",
    guidance: [
      "Hold the review before drafting the next cycle, never in the same session",
      "Scores near 1.0 across the board indicate sandbagging",
      "Name it and address stretch explicitly in the next Phase 4",
    ],
  },
];

export function guidanceForPhase(phase: number): PhaseGuidance | undefined {
  return PHASE_GUIDANCE.find((entry) => entry.phase === phase);
}

/**
 * §2.1, verbatim. This is the "mode note" S-04 asks for: what this horizon
 * runs on, what it sets, and when it is revisited. The fourth line is §2.1's
 * closing sentence, which is the fact a facilitator in a quarterly cycle most
 * needs and most often ignores.
 */
export interface Horizon {
  readonly runs: string;
  readonly sets: string;
  readonly revisited: string;
  readonly note: string;
}

export const HORIZONS: Readonly<Record<"annual" | "quarterly", Horizon>> = {
  annual: {
    runs: "Once a year, about 6 weeks before the year starts",
    sets: "The annual frame (mission, vision, mid-term strategy), 2 to 5 annual strategies, up to 5 annual OKRs, the year's not-doing list",
    revisited:
      "Never rewritten mid-year. Revalidated each quarter in 30 to 60 minutes",
    note: "Phases 0 to 5 happen before the cycle starts. Phase 6 runs through it. Phase 7 closes it and feeds the next one.",
  },
  quarterly: {
    runs: "Four times a year, about 3 weeks before the quarter starts",
    sets: "Quarterly OKRs inside the annual frame",
    revisited: "Scored and closed at the end of the quarter",
    note: "The annual frame is read-only reference material during a quarterly cycle. Phase 3 of a quarterly cycle revalidates it. It does not rewrite it.",
  },
};

/** One row of §2.4's timeline: how long before day one, and what happens then. */
export interface TimelineRow {
  readonly weeksBefore: string;
  readonly activity: string;
}

/**
 * §2.4. The suggested timeline for the mode, which S-06 shows beside the input
 * pack. It is a suggestion, not a schedule: the booked session dates are the
 * cycle's own data and they arrive with sessions at P4-T04.
 */
export const SUGGESTED_TIMELINE: Readonly<
  Record<"annual" | "quarterly", readonly TimelineRow[]>
> = {
  annual: [
    { weeksBefore: "6 to 5", activity: "Phase 1: scope, roles, input pack" },
    { weeksBefore: "4", activity: "Phase 2: diagnosis session" },
    {
      weeksBefore: "4 to 3",
      activity: "Phase 3: direction-setting session with leadership",
    },
    {
      weeksBefore: "3 to 2",
      activity:
        "Phase 4: drafting sessions per unit, then peer review between teams",
    },
    {
      weeksBefore: "2 to 1",
      activity: "Phase 5: alignment session, capacity check",
    },
    {
      weeksBefore: "1 to 0",
      activity: "Sign-off, publication, Phase 6 calendar booked",
    },
  ],
  quarterly: [
    {
      weeksBefore: "3",
      activity: "Phase 1 (light refresh) and Phase 2: input refresh, scoring",
    },
    {
      weeksBefore: "2",
      activity: "Phase 3 (revalidation) and Phase 4: drafting",
    },
    { weeksBefore: "1", activity: "Phase 5: alignment, sign-off, publication" },
  ],
};
