/**
 * The demo quarter's objectives and key results (P3-T17).
 *
 * Seven objectives across all four levels, sixteen key results, and every one
 * of them is there to put something on a screen:
 *
 * - Two company objectives with no parent, each carrying a contribution
 *   statement, so publish gate 3 has both shapes to judge.
 * - Four aligned children and one individual objective, so the alignment
 *   studio draws more than a fan-out and the cascade has depth to roll up.
 * - Leading and lagging key results side by side on the same objective, which
 *   is what METHOD.md §4.2 asks a set to have.
 * - One key result at `exceeds` capacity, so publish gate 5 is red for a reason
 *   a reader can act on rather than green because nothing was checked.
 * - One key result reading a KPI instead of a typed value (§10), so the link
 *   between the metric layer and the OKR layer is visible.
 *
 * `checkIns` on a goal are published in order, so the last one is the one the
 * screens show and the ones before it are its history.
 *
 * **Each key result carries one reading, not a series, and that is a
 * deliberate choice forced by a real defect.** METHOD.md §3.6's forecast fits a
 * line over the value window and projects it to the end of the cycle. The fit
 * uses the wall-clock time of each reading, and it has no minimum span: a seed
 * writes its readings milliseconds apart, so the line it fits is near-vertical
 * and the goal page reads "On this trend: -269082230.39 by 2026-09-30". A real
 * user hits the same thing by typing a value and correcting it a second later.
 *
 * So the seed writes each key result's current figure once, at creation, which
 * leaves one point in the window and no forecast at all — which is what the
 * engine already does honestly for a single measurement. The week-by-week story
 * lives in the check-in narratives instead, where it reads better anyway.
 *
 * The KPI layer is where the real trends are: `kpis.record` takes the period
 * date, so those six-month series are genuinely spaced and their charts are
 * real. Raised as a defect rather than only worked around here: the forecast
 * needs a minimum window span, and that is a METHOD.md question rather than one
 * a seeder should answer.
 */
import type { CastKey, SpaceKey } from "./cast.ts";

export type GoalKey =
  | "first30"
  | "unitEconomics"
  | "onboardingRunsItself"
  | "sellToFit"
  | "answersInProduct"
  | "renewalNoSurprises"
  | "cohortEvidence";

interface DemoKeyResult {
  readonly key: string;
  readonly title: string;
  readonly unit?: string;
  readonly direction: "increase" | "reduce" | "maintain" | "move";
  readonly indicatorType: "leading" | "lagging";
  readonly baselineValue: number;
  readonly targetValue: number;
  readonly weight?: number;
  readonly ownerKey?: CastKey;
  readonly capacity?: "fits" | "tight" | "exceeds";
  /** Reads its value from this KPI instead of from typed values (§10). */
  readonly kpiKey?: string;
  /**
   * Where the measure stands today, written once at creation. See the note at
   * the top of the file for why this is a single figure rather than a series.
   * Absent on a KPI-linked key result, which takes its value from the metric.
   */
  readonly current?: number;
}

interface DemoCheckIn {
  readonly status: "on_track" | "caution" | "off_track";
  /** 0 to 1. METHOD.md §3.2's confidence bands read this. */
  readonly confidence: number;
  readonly narrative: string;
  /**
   * Acknowledged by the reviewer of record, which closes the obligation.
   *
   * Only ever set where the reviewer is the person running the seed. METHOD.md
   * §6.5 lets nobody else close the loop, an administrator included, and the
   * seeder is not going to work around a rule the product enforces on purpose.
   * Every other published check-in is left waiting, which is what puts real
   * obligations in a real review inbox.
   */
  readonly acknowledge?: boolean;
}

export interface DemoGoal {
  readonly key: GoalKey;
  readonly title: string;
  readonly description: string;
  readonly level: "company" | "department" | "team" | "individual";
  readonly ownerKind: "workspace" | "space" | "member";
  readonly spaceKey?: SpaceKey;
  readonly memberKey?: CastKey;
  readonly championKey: CastKey;
  readonly reviewerKey: CastKey;
  readonly parentKey?: GoalKey;
  /** Required by publish gate 3 on any objective with no parent. */
  readonly contributionStatement?: string;
  readonly weight?: number;
  readonly keyResults: readonly DemoKeyResult[];
  readonly checkIns?: readonly DemoCheckIn[];
  /**
   * Leaves an unpublished draft open on this goal, so the composer's draft
   * state is on screen rather than described.
   */
  readonly openDraft?: boolean;
}

export const GOALS: readonly DemoGoal[] = [
  {
    key: "first30",
    title:
      "A new account proves the product to itself in its first thirty days",
    description:
      "Every account that reached value inside a month renewed. Every account that took longer than ninety days churned or shrank. This quarter we stop treating that as a coincidence.",
    level: "company",
    ownerKind: "workspace",
    championKey: "priya",
    reviewerKey: "admin",
    contributionStatement:
      "Carries annual strategy two, make the product prove itself in the first thirty days, into this quarter.",
    weight: 3,
    keyResults: [
      {
        key: "ttfv",
        title: "Cut median time to first value from 14 days to 5",
        unit: "days",
        direction: "reduce",
        indicatorType: "leading",
        baselineValue: 14,
        targetValue: 5,
        weight: 2,
        ownerKey: "sara",
        capacity: "tight",
        current: 9,
      },
      {
        key: "activation30",
        title: "Lift 30-day activation from 41 per cent to 65 per cent",
        unit: "%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 41,
        targetValue: 65,
        weight: 2,
        ownerKey: "sara",
        capacity: "fits",
        current: 51,
      },
      {
        key: "logoRetention90",
        title:
          "Raise 90-day retention on new cohorts from 88 per cent to 95 per cent",
        unit: "%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 88,
        targetValue: 95,
        ownerKey: "tomas",
        capacity: "fits",
        current: 89,
      },
    ],
    checkIns: [
      {
        status: "on_track",
        confidence: 0.75,
        narrative:
          "The setup wizard is at every new account and time to first value has moved from 14 days to 9. The remaining four days are almost entirely the invite step: an admin sets themselves up and then waits a week to invite anybody. Sara is testing an invite prompt inside the wizard next week.\n\nActivation is following, more slowly than time to first value, which is what we expected. Retention has one cohort and we are not reading a trend into one cohort.",
        acknowledge: true,
      },
    ],
  },
  {
    key: "unitEconomics",
    title: "Serve twice the accounts on the cost base we have today",
    description:
      "Support cost per account has grown faster than revenue per account for three quarters. Adding people would hide the cause. This objective takes the cause out of the product.",
    level: "company",
    ownerKind: "workspace",
    championKey: "admin",
    reviewerKey: "priya",
    contributionStatement:
      "Carries the cost half of annual strategy three, turn support load into product change instead of headcount.",
    weight: 3,
    keyResults: [
      {
        key: "operatingMargin",
        title: "Operating margin back above 15 per cent",
        unit: "%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 9,
        targetValue: 15,
        weight: 2,
        capacity: "fits",
        // §10: this key result reads the KPI rather than a typed value, so the
        // number on the objective and the number on the grid cannot disagree.
        kpiKey: "operatingMargin",
      },
      {
        key: "ticketsPerAccount",
        title: "Cut support tickets per account per month from 3.4 to 2.0",
        direction: "reduce",
        indicatorType: "leading",
        baselineValue: 3.4,
        targetValue: 2,
        ownerKey: "tomas",
        capacity: "fits",
        current: 2.9,
      },
      {
        key: "deflection",
        title: "Lift self-serve deflection from 12 per cent to 35 per cent",
        unit: "%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 12,
        targetValue: 35,
        ownerKey: "mei",
        // Deliberately left exceeding capacity. Publish gate 5 refuses the set
        // while this stands, and the refusal names this row.
        capacity: "exceeds",
        current: 17,
      },
    ],
    checkIns: [
      {
        status: "caution",
        confidence: 0.45,
        narrative:
          "Tickets per account are moving and deflection is moving with them. Margin is not, and it will not until the second half of the quarter, because the cost side lags the ticket side by about six weeks.\n\nThe honest risk is the deflection key result. It assumes a hire we have not made. It is marked as exceeding capacity rather than quietly carried, and the choice in front of us is to cut the target or to make the hire. I would rather cut the target.",
      },
    ],
  },
  {
    key: "onboardingRunsItself",
    title: "Onboarding runs without us in the room",
    description:
      "The setup call exists because the product cannot explain itself. Each call we remove is a call that never has to scale.",
    level: "department",
    ownerKind: "space",
    spaceKey: "product",
    championKey: "sara",
    reviewerKey: "priya",
    parentKey: "first30",
    contributionStatement:
      "Contributes the product half of the company's first-thirty-days objective: the setup flow itself, and the calls it removes.",
    weight: 2,
    keyResults: [
      {
        key: "guidedSetup",
        title: "Guided setup completed by 70 per cent of new accounts",
        unit: "%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 0,
        targetValue: 70,
        weight: 2,
        ownerKey: "sara",
        capacity: "tight",
        current: 63,
      },
      {
        key: "setupCalls",
        title: "Cut manual setup calls per new account from 2.1 to 0.5",
        direction: "reduce",
        indicatorType: "lagging",
        baselineValue: 2.1,
        targetValue: 0.5,
        ownerKey: "tomas",
        capacity: "fits",
        current: 1.2,
      },
    ],
    checkIns: [
      {
        status: "on_track",
        confidence: 0.8,
        narrative:
          "Guided setup is at 63 per cent against a target of 70, in week six of thirteen. The remaining gap is one step, the data import, and it is the step that most depends on Engineering.\n\nThe dependency on the import API is logged and is not confirmed yet. Mei holds the risk on it.",
      },
    ],
  },
  {
    key: "sellToFit",
    title: "Sell to accounts that can onboard themselves",
    description:
      "Half our churn arrives as a signature. An account outside the profile costs Success four times what one inside it costs.",
    level: "department",
    ownerKind: "space",
    spaceKey: "sales",
    championKey: "daniel",
    reviewerKey: "admin",
    parentKey: "first30",
    contributionStatement:
      "Contributes the demand half of the company's first-thirty-days objective: only sell to accounts the new onboarding can actually carry.",
    weight: 2,
    keyResults: [
      {
        key: "profileShare",
        title:
          "Raise the share of new deals inside the target profile from 55 to 80 per cent",
        unit: "%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 55,
        targetValue: 80,
        weight: 2,
        ownerKey: "jonas",
        capacity: "fits",
        current: 68,
      },
      {
        key: "signatureToKickoff",
        title: "Cut days from signature to kickoff from 12 to 4",
        unit: "days",
        direction: "reduce",
        indicatorType: "lagging",
        baselineValue: 12,
        targetValue: 4,
        ownerKey: "jonas",
        capacity: "fits",
        current: 7,
      },
    ],
    checkIns: [
      {
        status: "on_track",
        confidence: 0.7,
        narrative:
          "Profile share is at 68 against 80. Two deals were turned away this month that would have closed, which is the point of the key result and is still uncomfortable.\n\nThis objective depends on Product shipping guided setup: selling a self-serve promise we cannot keep is worse than not selling it. That dependency is confirmed.",
      },
    ],
  },
  {
    key: "answersInProduct",
    title: "Take the twelve repeated questions out of the product",
    description:
      "Support answers the same twelve questions every week. Each one is a place where the product does not say what it is doing.",
    level: "team",
    ownerKind: "space",
    spaceKey: "engineering",
    championKey: "mei",
    reviewerKey: "priya",
    parentKey: "unitEconomics",
    contributionStatement:
      "Contributes the cost half of the unit economics objective by removing the reason support is contacted, rather than by answering faster.",
    weight: 2,
    keyResults: [
      {
        key: "answersShipped",
        title:
          "Ship in-product answers for all 12 of the top repeated questions",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 0,
        targetValue: 12,
        weight: 2,
        ownerKey: "mei",
        capacity: "fits",
        current: 5,
      },
      {
        key: "setupLatency",
        title: "Cut p95 setup API latency from 1400ms to 400ms",
        unit: "ms",
        direction: "reduce",
        indicatorType: "leading",
        baselineValue: 1400,
        targetValue: 400,
        ownerKey: "mei",
        capacity: "fits",
        current: 610,
      },
    ],
    checkIns: [
      {
        status: "caution",
        confidence: 0.5,
        narrative:
          "Five of twelve answers shipped. The other seven are all billing questions and all of them wait on the annual pricing review in week nine. That is a real block, not a slow start, and pretending it is a slow start would cost us four weeks.\n\nLatency is ahead of where it needs to be.",
      },
    ],
  },
  {
    key: "renewalNoSurprises",
    title: "No customer is surprised by their own renewal",
    description:
      "Every renewal we lost last year was visible in the product ninety days earlier. Nobody was looking.",
    level: "team",
    ownerKind: "space",
    spaceKey: "success",
    championKey: "tomas",
    reviewerKey: "admin",
    parentKey: "unitEconomics",
    contributionStatement:
      "Contributes the revenue half of the unit economics objective: a renewal seen ninety days out is a renewal that can be saved.",
    weight: 1,
    keyResults: [
      {
        key: "healthCoverage",
        title:
          "Every account over 10k has a health reading no older than 30 days",
        unit: "%",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 34,
        targetValue: 100,
        ownerKey: "tomas",
        capacity: "fits",
        current: 81,
      },
      {
        key: "renewalNotice",
        title:
          "Raise renewals flagged 90 days out from 20 per cent to 90 per cent",
        unit: "%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 20,
        targetValue: 90,
        ownerKey: "tomas",
        capacity: "fits",
        current: 55,
      },
    ],
    checkIns: [
      {
        status: "on_track",
        confidence: 0.85,
        narrative:
          "Coverage is at 81 per cent and the last stretch is the accounts with no assigned owner. That is an assignment problem rather than a data problem and it is on my desk this week.",
      },
    ],
  },
  {
    key: "cohortEvidence",
    title:
      "Prove the onboarding change with cohort evidence, not with anecdotes",
    description:
      "We have changed onboarding four times in two years and never measured a cohort through to renewal. This quarter one person owns that.",
    level: "individual",
    ownerKind: "member",
    memberKey: "amara",
    championKey: "amara",
    reviewerKey: "admin",
    parentKey: "first30",
    contributionStatement:
      "Contributes the evidence the first-thirty-days objective is judged on. Without it the quarter ends in opinions.",
    weight: 1,
    keyResults: [
      {
        key: "cohortReport",
        title:
          "Publish the weekly cohort report in all 13 weeks of the quarter",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 0,
        targetValue: 13,
        ownerKey: "amara",
        capacity: "fits",
        current: 6,
      },
    ],
    openDraft: true,
  },
];

/**
 * Private confidence votes (METHOD.md §7.2's confidence round).
 *
 * A vote is readable only by its author until the reveal, so the seeder casts
 * one vote per key result as the person running the demo and reveals exactly
 * one of them. The revealed one shows the round finished; the other shows what
 * a vote looks like before anybody may read it.
 */
export const VOTES: readonly {
  readonly keyResultKey: string;
  readonly confidence: number;
  readonly reveal: boolean;
}[] = [
  { keyResultKey: "deflection", confidence: 0.3, reveal: true },
  { keyResultKey: "ttfv", confidence: 0.8, reveal: false },
];

/**
 * Cross-boundary dependencies (METHOD.md §5.4).
 *
 * One goal-to-goal link that the alignment engine reads, and three register
 * entries on key results: one confirmed by its provider, one open but
 * risk-owned by a named person, and one named as an outside party with no
 * space to point at. Publish gate 4 passes on all three, and for three
 * different reasons, which is the point of seeding all three.
 */
export const GOAL_DEPENDENCIES: readonly {
  readonly fromKey: GoalKey;
  readonly toKey: GoalKey;
  readonly note: string;
}[] = [
  {
    fromKey: "sellToFit",
    toKey: "onboardingRunsItself",
    note: "Sales cannot promise self-serve onboarding until guided setup is at every new account.",
  },
];

export const KEY_RESULT_DEPENDENCIES: readonly {
  readonly keyResultKey: string;
  readonly providerSpaceKey?: SpaceKey;
  readonly providerText?: string;
  readonly note: string;
  readonly confirm?: boolean;
  readonly riskOwnerKey?: CastKey;
}[] = [
  {
    keyResultKey: "guidedSetup",
    providerSpaceKey: "engineering",
    note: "The last step of guided setup is the data import, which needs the bulk import API.",
    riskOwnerKey: "mei",
  },
  {
    keyResultKey: "profileShare",
    providerSpaceKey: "product",
    note: "The qualification checklist reads the product's own fit signals.",
    confirm: true,
  },
  {
    keyResultKey: "answersShipped",
    providerText: "Finance, annual pricing review",
    note: "Seven of the twelve answers are billing questions and cannot be written before the pricing review lands in week nine.",
    riskOwnerKey: "priya",
  },
];

/** Discussion seeded onto goals and check-ins, so the comment rail is not empty. */
export const DISCUSSION: readonly {
  readonly goalKey: GoalKey;
  readonly body: string;
  readonly reactions?: readonly string[];
}[] = [
  {
    goalKey: "first30",
    body: "Two of these three key results are lagging. That is deliberate: activation and retention are the outcomes we are actually buying, and time to first value is the one lever we believe moves them. If it moves and they do not, the belief was wrong and we should say so at the quarterly review rather than quietly adding a third lever.",
    reactions: ["👍", "🎯"],
  },
  {
    goalKey: "unitEconomics",
    body: "The deflection key result is marked as exceeding capacity and I want that left visible rather than tidied away. Either we cut the target to something the current team can reach, or we make the hire. Publishing the set with it hidden would be choosing neither.",
    reactions: ["👍"],
  },
  {
    goalKey: "answersInProduct",
    body: "Seven of the twelve are blocked on the pricing review in week nine. Flagging now so nobody reads week eight's check-in as a surprise.",
    reactions: ["👀"],
  },
];
