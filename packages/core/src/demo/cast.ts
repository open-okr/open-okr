/**
 * The demo organisation, as plain data (P3-T17).
 *
 * "Northwind Labs" is a mid-market business-to-business software company at the
 * start of a quarter. Everything here is invented, and it is invented to a
 * shape: each objective, key result, dependency and KPI exists to make one part
 * of METHOD.md visible on a screen. The comments beside each block say which.
 *
 * Kept apart from `builder.ts` so the story and the machinery can be read on
 * their own. Change the story here; change how it is written there.
 */

/** A key in `CAST`. Used everywhere a demo person is referred to. */
export type CastKey =
  | "admin"
  | "priya"
  | "daniel"
  | "mei"
  | "tomas"
  | "sara"
  | "jonas"
  | "amara";

interface CastMember {
  readonly key: CastKey;
  readonly name: string;
  readonly title: string;
  /** Who they report to. `null` is the top of the chain. */
  readonly managerKey: CastKey | null;
  readonly timezone: string;
}

/**
 * Seven invented people plus the person running the demo.
 *
 * `admin` is not created: it is whoever registered this instance, renamed into
 * the story only as far as a title. Their real name stays, because a demo where
 * the presenter cannot find themselves in the org chart is a worse demo.
 *
 * The chain is three deep on one branch (admin, Priya, Sara) so the org chart
 * has something to draw beyond a single fan-out.
 */
const CAST: readonly CastMember[] = [
  {
    key: "admin",
    name: "",
    title: "Chief Executive",
    managerKey: null,
    timezone: "Europe/London",
  },
  {
    key: "priya",
    name: "Priya Raman",
    title: "Chief Product Officer",
    managerKey: "admin",
    timezone: "Europe/London",
  },
  {
    key: "daniel",
    name: "Daniel Osei",
    title: "VP Sales",
    managerKey: "admin",
    timezone: "America/New_York",
  },
  {
    key: "tomas",
    name: "Tomás Herrera",
    title: "Head of Customer Success",
    managerKey: "admin",
    timezone: "Europe/Madrid",
  },
  {
    key: "mei",
    name: "Mei Lin",
    title: "Head of Engineering",
    managerKey: "priya",
    timezone: "Asia/Singapore",
  },
  {
    key: "sara",
    name: "Sara Nasser",
    title: "Product Manager, Onboarding",
    managerKey: "priya",
    timezone: "Europe/London",
  },
  {
    key: "jonas",
    name: "Jonas Weber",
    title: "Account Executive",
    managerKey: "daniel",
    timezone: "Europe/Berlin",
  },
  {
    key: "amara",
    name: "Amara Diallo",
    title: "Data Analyst",
    managerKey: "admin",
    timezone: "Africa/Dakar",
  },
];

/** Everyone the builder creates. The admin already exists. */
export const INVENTED_CAST = CAST.filter((person) => person.key !== "admin");

export type SpaceKey = "product" | "sales" | "success" | "engineering";

export interface DemoSpace {
  readonly key: SpaceKey;
  readonly name: string;
  readonly mission: string;
  /** METHOD.md §2.5: one coordinator per space, managers uncapped. */
  readonly managerKey: CastKey;
  readonly coordinatorKey: CastKey;
  readonly memberKeys: readonly CastKey[];
}

export const SPACES: readonly DemoSpace[] = [
  {
    key: "product",
    name: "Product",
    mission: "Make the first thirty days obviously worth it.",
    managerKey: "priya",
    coordinatorKey: "sara",
    memberKeys: ["priya", "sara", "mei", "amara"],
  },
  {
    key: "sales",
    name: "Sales",
    mission: "Win mid-market accounts we can keep.",
    managerKey: "daniel",
    coordinatorKey: "jonas",
    memberKeys: ["daniel", "jonas", "amara"],
  },
  {
    key: "success",
    name: "Customer Success",
    mission: "No customer is surprised by their own renewal.",
    managerKey: "tomas",
    coordinatorKey: "tomas",
    memberKeys: ["tomas", "sara"],
  },
  {
    key: "engineering",
    name: "Engineering",
    mission: "Ship weekly, and keep the thing standing.",
    managerKey: "mei",
    coordinatorKey: "mei",
    memberKeys: ["mei", "priya"],
  },
];

/**
 * The annual frame (METHOD.md §2.1).
 *
 * Three strategies, inside §2.1's two-to-five bound, so the phase 0 count reads
 * green rather than merely populated.
 */
export const FRAME = {
  yearLabel: "2026",
  horizonLabel: "2026 to 2028",
  agreed: true,
  strategies: [
    {
      text: "Own the mid-market segment we already win in, rather than chasing enterprise",
      note: "We close 1 in 3 mid-market deals and 1 in 14 enterprise ones. The second number is not a funnel problem, it is a product fit problem.",
    },
    {
      text: "Make the product prove itself in the first thirty days, without us in the room",
      note: "Every account that reached value inside a month renewed. Every account that took longer than ninety days churned or shrank.",
    },
    {
      text: "Turn support load into product change instead of headcount",
      note: "Support cost per account has grown faster than revenue per account for three quarters running.",
    },
  ],
} as const;

/**
 * Phase 2's baseline health (METHOD.md §8.5), in its three columns.
 *
 * Written as prose rather than as numbers on purpose: the KPI grid holds the
 * numbers, and this column is the reading of them.
 */
export const BASELINE_HEALTH = {
  stable:
    "Gross revenue retention has sat between 91 and 93 per cent for four quarters. Uptime is inside its corridor every month. Support first-response time is unchanged.",
  declining:
    "Operating margin has fallen for two quarters, from 14 per cent to 9, and is now below its corridor floor. Time to first value has drifted from 11 days to 14. Net revenue retention is flat, which for a company adding seats means expansion has stopped.",
  businessAsUsual:
    "Two compliance audits, the annual pricing review, and the platform upgrade already committed for this quarter. None of these is an objective. All of them consume the same weeks.",
} as const;

/**
 * Phase 2's ranked strategic issues (METHOD.md §2.3).
 *
 * Four, above the three the §11 registry asks for, with a spread of impact so
 * the ranking is doing visible work. Two are promoted into priorities below,
 * and two are deliberately left unpromoted: a diagnosis that turns every issue
 * into an objective has not prioritised anything.
 */
export const ISSUES: readonly {
  readonly key: string;
  readonly text: string;
  readonly impact: number;
}[] = [
  {
    key: "onboarding",
    text: "New accounts take 14 days to reach first value, and everything that churned took longer than 30",
    impact: 5,
  },
  {
    key: "margin",
    text: "Operating margin has fallen below its corridor floor for two quarters running",
    impact: 5,
  },
  {
    key: "expansion",
    text: "Expansion revenue has stopped: net revenue retention is flat while seats grow",
    impact: 4,
  },
  {
    key: "support",
    text: "Support handles the same twelve questions every week and nothing changes in the product",
    impact: 3,
  },
];

/** The two issues that became priorities. Keys match `ISSUES`. */
export const PROMOTED_ISSUE_KEYS = ["onboarding", "margin"] as const;

export const PRIORITIES: readonly {
  readonly fromIssueKey: (typeof PROMOTED_ISSUE_KEYS)[number];
  readonly text: string;
  readonly successStatement: string;
}[] = [
  {
    fromIssueKey: "onboarding",
    text: "A new account reaches first value without a human in the loop",
    successStatement:
      "By the end of 2026, the median account reaches first value in under 5 days, and no cohort of accounts onboarded that year churns above 8 per cent.",
  },
  {
    fromIssueKey: "margin",
    text: "Serve twice the accounts on the same cost base",
    successStatement:
      "By the end of 2026, operating margin is back above 15 per cent with support cost per account down by a third.",
  },
];

/**
 * The quarter's revalidation of the frame (METHOD.md §2.1: revalidated, never
 * rewritten). It holds, with a note on where the quarter's focus sits.
 */
export const REVALIDATION = {
  holds: true,
  changed: false,
  focusNote:
    "The frame holds. This quarter takes strategy two, the first thirty days, as its focus, and takes only the cost half of strategy three. Strategy one is a whole-year thrust and gets no quarterly objective of its own.",
} as const;

/**
 * Phase 5's capacity note (METHOD.md §5.5).
 *
 * Publish gate 5 reads this, and §5.5's own rule is that if nothing was cut,
 * capacity was not checked. So the demo cuts things, by name.
 */
export const CAPACITY_CUTS = `Cut from this quarter, deliberately and by name:

The partner marketplace. Real revenue, wrong quarter: it needs the same two engineers as the onboarding work and would take both.

The pricing rebuild. Blocked on the annual pricing review, which lands in week nine. Moved whole to next quarter rather than started and abandoned.

The support knowledge base rewrite. Kept as a KPI to watch rather than an objective, because the twelve repeated questions are a product problem and rewriting the answers would hide it.

What is left fits. Two key results are marked tight and one is marked as exceeding: the deflection key result assumes an engineer we have not hired, and it says so on its own row rather than in anybody's head.`;
