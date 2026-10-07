/**
 * The 2027 annual frame and annual objectives (P9-T22c-a, scenario NW-P-08,
 * NW-P-10, NW-P-14).
 *
 * Written at the offsite on 1 December, drafted from 2 to 11 December, and
 * published at the all-hands on 18 December. Two committed, two aspirational:
 * the company's promises for the year, which every quarter takes a slice of.
 */
import type { YearKpiKey } from "./kpis.ts";
import type { YearPersonKey } from "./people.ts";

export const YEAR_FRAME = {
  mission:
    "Help mid-market teams get value from their software from the first week",
  vision:
    "The platform a mid-market company never has to think about replacing",
  horizonLabel: "2026 to 2028",
  strategies: [
    "Own the mid-market segment we already win in",
    "Make the product prove itself in the first thirty days",
    "Turn support load into product change instead of headcount",
    "Earn the trust of enterprise security teams without custom work",
  ],
  notDoing:
    "No custom enterprise deployments. No partner marketplace. No new regions. No pricing rebuild before July. No individual OKRs.",
  priorities: [
    {
      text: "New accounts reach value in their first week",
      successStatement:
        "The median time to first value is under 4 days by December",
    },
    {
      text: "Margins we can run on",
      successStatement: "Operating margin is at 15% by December",
    },
    {
      text: "An approved vendor",
      successStatement:
        "A SOC 2 Type II report is in customers' hands by October",
    },
  ],
} as const;

type AnnualKey = "a1" | "a2" | "a3" | "a4";

interface AnnualKeyResult {
  readonly key: string;
  readonly title: string;
  readonly kind?: "metric" | "maintain" | "milestone";
  readonly direction?: "increase" | "reduce" | "maintain";
  readonly indicatorType: "leading" | "lagging";
  readonly baselineValue?: number;
  readonly targetValue?: number;
  readonly unit?: string;
  readonly ownerKey: YearPersonKey;
  /** A scenario date, when it is due before the year ends. */
  readonly dueOn?: string;
  /** Reads its value from this KPI (§6.6). */
  readonly kpiKey?: YearKpiKey;
  readonly capacity?: "fits" | "tight";
}

export interface AnnualObjective {
  readonly key: AnnualKey;
  readonly title: string;
  readonly kind: "committed" | "aspirational";
  readonly championKey: YearPersonKey;
  /** The §2.1 strategy it serves, by its position in the frame. */
  readonly strategy: number;
  readonly keyResults: readonly AnnualKeyResult[];
}

export const ANNUAL_OBJECTIVES: readonly AnnualObjective[] = [
  {
    key: "a1",
    title: "New accounts reach value in their first week",
    kind: "aspirational",
    championKey: "priya",
    strategy: 1,
    keyResults: [
      {
        key: "a1.ttfv",
        title: "Cut median time to first value from 9 days to 3",
        direction: "reduce",
        indicatorType: "lagging",
        baselineValue: 9,
        targetValue: 3,
        unit: "days",
        ownerKey: "sara",
      },
      {
        key: "a1.activation",
        title: "Raise 30-day activation from 51% to 70%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 51,
        targetValue: 70,
        unit: "%",
        ownerKey: "sara",
      },
      {
        key: "a1.retention",
        title: "Raise 90-day logo retention from 89% to 95%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 89,
        targetValue: 95,
        unit: "%",
        ownerKey: "tomas",
      },
    ],
  },
  {
    key: "a2",
    title: "Grow profitably from the customers we keep",
    kind: "committed",
    championKey: "elena",
    strategy: 2,
    keyResults: [
      {
        key: "a2.margin",
        title: "Raise operating margin from 9.1% to 15%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 9.1,
        targetValue: 15,
        unit: "%",
        ownerKey: "hugo",
        kpiKey: "operatingMargin",
      },
      {
        key: "a2.nrr",
        title: "Raise net revenue retention from 100% to 108%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 100,
        targetValue: 108,
        unit: "%",
        ownerKey: "hugo",
      },
      {
        key: "a2.supportCost",
        title: "Cut support cost per account from $128 to $95 a month",
        direction: "reduce",
        indicatorType: "lagging",
        baselineValue: 128,
        targetValue: 95,
        unit: "$",
        ownerKey: "hugo",
      },
    ],
  },
  {
    // "Ship SOC 2 Type II" was the first draft; OBJ-1 and OBJ-2 warned, and
    // the delivery became a milestone under a rewritten objective (NW-P-10).
    key: "a3",
    title: "Enterprise security teams approve us without a fight",
    kind: "committed",
    championKey: "mei",
    strategy: 3,
    keyResults: [
      {
        key: "a3.soc2",
        title: "SOC 2 Type II report issued by 30 September",
        kind: "milestone",
        indicatorType: "lagging",
        ownerKey: "mei",
        dueOn: "2027-09-30",
        // Marked tight, not exceeds, after the partner marketplace was cut
        // (NW-P-14).
        capacity: "tight",
      },
      {
        key: "a3.questionnaires",
        title:
          "Cut security questionnaire turnaround from 10 working days to 2",
        direction: "reduce",
        indicatorType: "leading",
        baselineValue: 10,
        targetValue: 2,
        unit: "days",
        ownerKey: "mei",
        capacity: "fits",
      },
      {
        key: "a3.uptime",
        title: "Hold uptime at or above 99.9% every month",
        kind: "maintain",
        direction: "maintain",
        indicatorType: "lagging",
        baselineValue: 99.9,
        targetValue: 100,
        unit: "%",
        ownerKey: "leo",
        capacity: "fits",
      },
    ],
  },
  {
    key: "a4",
    title: "Win the mid-market deals we should win",
    kind: "aspirational",
    championKey: "daniel",
    strategy: 0,
    keyResults: [
      {
        key: "a4.winRate",
        title: "Raise mid-market win rate from 26% to 35%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 26,
        targetValue: 35,
        unit: "%",
        ownerKey: "daniel",
      },
      {
        key: "a4.salesCycle",
        title: "Cut median sales cycle from 55 days to 40",
        direction: "reduce",
        indicatorType: "leading",
        baselineValue: 55,
        targetValue: 40,
        unit: "days",
        ownerKey: "daniel",
      },
    ],
  },
];

/** What Engineering cut to make A3 fit (NW-P-14). */
export const ANNUAL_CUTS =
  "The partner marketplace, cut so the SOC 2 milestone reads tight rather than exceeds.";
