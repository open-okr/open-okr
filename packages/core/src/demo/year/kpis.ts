/**
 * The Northwind year's KPIs (P9-T22c-a, scenario NW-P-12).
 *
 * Eleven health metrics, each judged by its own target type and thresholds in
 * its own units (METHOD.md §6.2), with a reading for every month. The six
 * months before the year are history the seed writes when the KPIs are set up
 * on 7 December; every month of the year after that is read "a few days after
 * each month ends", as the scenario's Q4 chapter says, so it appears on the day
 * it would have been recorded and not before.
 *
 * **Every number the scenario states is in these series**: tickets per account
 * at 3.3 for January (NW-Q1-17), activation at 54% on 1 March (NW-Q1-23),
 * operating margin at 7.8% in May and 7.6% in June (NW-Q2-23, NW-Q3-03), the
 * baselines each quarter starts from, and the annual review's latest values
 * (NW-Q4-06). The months between are drawn to join them.
 */
import type { KpiTargetType } from "@openokr/method";
import type { YearPersonKey } from "./people.ts";

export type YearKpiKey =
  | "operatingMargin"
  | "nrr"
  | "expansionSeats"
  | "supportCost"
  | "tickets"
  | "deflection"
  | "ttfv"
  | "activation"
  | "logoRetention"
  | "uptime"
  | "nps";

export interface YearKpi {
  readonly key: YearKpiKey;
  readonly title: string;
  readonly unit: string;
  readonly category: "Finance" | "Customer" | "Product" | "Platform";
  readonly targetType: KpiTargetType;
  readonly target: number;
  readonly greenLow?: number;
  readonly greenHigh?: number;
  readonly redLow?: number;
  readonly redHigh?: number;
  readonly ownerKey: YearPersonKey;
  readonly indicatorType: "leading" | "lagging";
  readonly parentKey?: YearKpiKey;
  /** June to November 2026, oldest first: the history set up on 7 December. */
  readonly before: readonly number[];
  /**
   * December 2026 to November 2027, oldest first, each read a few days after
   * its month ends. Shorter where the story reads fewer.
   */
  readonly year: readonly number[];
}

export const YEAR_KPIS: readonly YearKpi[] = [
  {
    key: "operatingMargin",
    title: "Operating margin",
    unit: "%",
    category: "Finance",
    targetType: "increase_to",
    target: 15,
    greenLow: 13.5,
    // The lender's covenant floor (NW-P-12).
    redLow: 8,
    ownerKey: "hugo",
    indicatorType: "lagging",
    before: [9.8, 9.6, 9.4, 9.3, 9.2, 9.1],
    year: [9.2, 9.0, 8.9, 8.7, 8.3, 7.8, 7.6, 8.9, 10.1, 10.4, 12.2, 13.6],
  },
  {
    key: "nrr",
    title: "Net revenue retention",
    unit: "%",
    category: "Finance",
    targetType: "increase_to",
    target: 110,
    greenLow: 103,
    redLow: 97,
    ownerKey: "hugo",
    indicatorType: "lagging",
    before: [101, 101, 100, 100, 100, 100],
    year: [100, 100, 100, 100, 100, 99, 100, 100, 101, 101, 102, 104],
  },
  {
    key: "expansionSeats",
    title: "Expansion seats added",
    unit: "seats",
    category: "Customer",
    targetType: "increase_to",
    target: 220,
    greenLow: 200,
    redLow: 130,
    ownerKey: "tomas",
    indicatorType: "leading",
    parentKey: "nrr",
    before: [150, 146, 144, 141, 140, 138],
    year: [138, 140, 139, 138, 136, 128, 125, 140, 152, 158, 172, 185],
  },
  {
    key: "supportCost",
    title: "Support cost per account",
    unit: "$",
    category: "Finance",
    targetType: "decrease_to",
    target: 90,
    greenHigh: 100,
    redHigh: 135,
    ownerKey: "hugo",
    indicatorType: "lagging",
    parentKey: "operatingMargin",
    before: [118, 121, 123, 125, 127, 128],
    year: [128, 129, 124, 118, 116, 113, 109, 106, 103, 101, 99, 97],
  },
  {
    key: "tickets",
    title: "Support tickets per account",
    unit: "tickets",
    category: "Customer",
    targetType: "decrease_to",
    target: 2,
    greenHigh: 2.2,
    redHigh: 3.2,
    ownerKey: "kofi",
    indicatorType: "leading",
    parentKey: "supportCost",
    before: [2.6, 2.7, 2.7, 2.8, 2.8, 2.9],
    year: [2.9, 3.3, 2.9, 2.55, 2.5, 2.4, 2.32, 2.3, 2.25, 2.2, 2.15, 2.1],
  },
  {
    key: "deflection",
    title: "Self-serve deflection",
    unit: "%",
    category: "Customer",
    targetType: "increase_to",
    target: 35,
    greenLow: 30,
    redLow: 15,
    ownerKey: "kofi",
    indicatorType: "leading",
    parentKey: "tickets",
    before: [14, 15, 15, 16, 16, 17],
    year: [17, 18, 20, 22, 23, 25, 27, 28, 30, 31, 33, 35],
  },
  {
    key: "ttfv",
    title: "Median time to first value",
    unit: "days",
    category: "Product",
    targetType: "decrease_to",
    target: 5,
    greenHigh: 6,
    redHigh: 10,
    ownerKey: "sara",
    indicatorType: "leading",
    parentKey: "nrr",
    before: [11, 10.5, 10, 9.5, 9.2, 9],
    year: [9, 8.5, 7.8, 7, 6.5, 6, 5.5, 5.2, 4.8, 4.4, 4.1, 3.8],
  },
  {
    key: "activation",
    title: "30-day activation",
    unit: "%",
    category: "Product",
    targetType: "increase_to",
    target: 65,
    greenLow: 60,
    redLow: 45,
    ownerKey: "sara",
    indicatorType: "leading",
    parentKey: "nrr",
    before: [47, 48, 49, 50, 50, 51],
    year: [51, 52, 54, 56, 57, 58, 59, 60, 62, 63, 64, 66],
  },
  {
    key: "logoRetention",
    title: "90-day logo retention",
    unit: "%",
    category: "Customer",
    targetType: "at_least",
    target: 92,
    greenLow: 92,
    redLow: 88,
    ownerKey: "tomas",
    indicatorType: "lagging",
    parentKey: "nrr",
    before: [88, 88.5, 89, 89, 89, 89],
    year: [89, 89, 90, 90, 91, 91, 91, 92, 92, 92, 93, 93],
  },
  {
    key: "uptime",
    title: "Uptime",
    unit: "%",
    category: "Platform",
    targetType: "range",
    target: 99.95,
    greenLow: 99.9,
    greenHigh: 100,
    redLow: 99.5,
    ownerKey: "leo",
    indicatorType: "lagging",
    before: [99.96, 99.95, 99.97, 99.94, 99.95, 99.95],
    year: [
      99.95, 99.93, 99.96, 99.94, 99.95, 99.92, 99.95, 99.96, 99.94, 99.95,
      99.97, 99.95,
    ],
  },
  {
    // Nobody measures it (NW-P-12), which is why Q1 writes a baseline key
    // result to establish it (NW-Q1-07).
    key: "nps",
    title: "Onboarding NPS",
    unit: "points",
    category: "Product",
    targetType: "increase_to",
    target: 40,
    ownerKey: "amara",
    indicatorType: "lagging",
    before: [],
    year: [],
  },
];

/** The two driver trees, rooted where the seed's story roots them (NW-P-12). */
export const YEAR_KPI_TREES: readonly {
  readonly name: string;
  readonly rootKey: YearKpiKey;
}[] = [
  { name: "Unit economics", rootKey: "operatingMargin" },
  { name: "Growth", rootKey: "nrr" },
];
