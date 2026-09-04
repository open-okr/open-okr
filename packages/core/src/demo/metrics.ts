/**
 * The demo workspace's KPI layer (P3-T17).
 *
 * Eleven metrics in four categories, each with six months of real readings, so
 * the grid, the period chart and the corridor bands all have something to draw.
 *
 * The shape is not accidental. METHOD.md §6.3 reads a driver tree by finding
 * the unhealthy branch and then the leading drivers at its edge, so the two
 * trees below are built to be read that way: a lagging impact metric at the
 * root, outcomes under it, and leading outputs and inputs at the edge. The
 * unhealthy branch of the first tree is the one the recovery objective is
 * launched from.
 *
 * `records` run oldest first and are stamped on real month starts counted back
 * from the current month, so the chart is a trend rather than a single point.
 */

export type KpiKey =
  | "operatingMargin"
  | "revenuePerAccount"
  | "expansionSeats"
  | "supportCostPerAccount"
  | "ticketsPerAccount"
  | "deflectionRate"
  | "netRevenueRetention"
  | "activation30"
  | "timeToFirstValue"
  | "logoRetention90"
  | "supportCostPerTicket"
  | "onboardingNps";

export type CategoryKey = "economics" | "growth" | "customer" | "reliability";

export const KPI_CATEGORIES: readonly {
  readonly key: CategoryKey;
  readonly name: string;
}[] = [
  { key: "economics", name: "Unit economics" },
  { key: "growth", name: "Growth" },
  { key: "customer", name: "Customer" },
  { key: "reliability", name: "Reliability" },
];

export interface DemoKpi {
  readonly key: KpiKey;
  readonly title: string;
  readonly categoryKey: CategoryKey;
  readonly unit?: string;
  readonly direction: "higher_better" | "lower_better";
  readonly indicatorType: "leading" | "lagging";
  readonly tier: "input" | "output" | "outcome" | "impact";
  readonly parentKey?: KpiKey;
  readonly targetDefault: number;
  /** METHOD.md §6.4's corridor. Below `watchPct` is unhealthy. */
  readonly healthyPct: number;
  readonly watchPct: number;
  /** Six monthly readings, oldest first. Absent on a calculated KPI. */
  readonly records?: readonly number[];
  /**
   * A calculated KPI (§6, P3-T13). The formula is built by the seeder from
   * these two keys, because a formula stores real KPI ids and the data file
   * has no ids to store.
   */
  readonly formula?: {
    readonly op: "add" | "sub" | "mul" | "div";
    readonly left: KpiKey;
    readonly right: KpiKey;
  };
}

/**
 * Ordered so a parent always appears before its children: the seeder creates
 * them in this order and resolves `parentKey` against what it has already made.
 */
export const KPIS: readonly DemoKpi[] = [
  // ── Tree one: unit economics. Its root is the metric in trouble. ─────
  {
    key: "operatingMargin",
    title: "Operating margin",
    categoryKey: "economics",
    unit: "%",
    direction: "higher_better",
    indicatorType: "lagging",
    tier: "impact",
    targetDefault: 15,
    healthyPct: 90,
    watchPct: 70,
    // Falls through the corridor floor and stays there. This is the metric the
    // recovery objective is launched from.
    records: [14.1, 13.2, 12.0, 10.6, 9.4, 9.1],
  },
  {
    key: "revenuePerAccount",
    title: "Revenue per account, monthly",
    categoryKey: "economics",
    unit: "USD",
    direction: "higher_better",
    indicatorType: "lagging",
    tier: "outcome",
    parentKey: "operatingMargin",
    targetDefault: 1400,
    healthyPct: 90,
    watchPct: 75,
    records: [1290, 1305, 1298, 1312, 1320, 1334],
  },
  {
    key: "expansionSeats",
    title: "Expansion seats added",
    categoryKey: "economics",
    direction: "higher_better",
    indicatorType: "leading",
    tier: "output",
    parentKey: "revenuePerAccount",
    targetDefault: 220,
    healthyPct: 90,
    watchPct: 70,
    records: [188, 171, 165, 149, 141, 138],
  },
  {
    key: "supportCostPerAccount",
    title: "Support cost per account, monthly",
    categoryKey: "economics",
    unit: "USD",
    direction: "lower_better",
    indicatorType: "lagging",
    tier: "outcome",
    parentKey: "operatingMargin",
    targetDefault: 90,
    healthyPct: 90,
    watchPct: 75,
    records: [104, 112, 119, 126, 131, 128],
  },
  {
    key: "ticketsPerAccount",
    title: "Support tickets per account, monthly",
    categoryKey: "economics",
    direction: "lower_better",
    indicatorType: "leading",
    tier: "output",
    parentKey: "supportCostPerAccount",
    targetDefault: 2,
    healthyPct: 90,
    watchPct: 70,
    records: [3.1, 3.3, 3.4, 3.4, 3.2, 2.9],
  },
  {
    key: "deflectionRate",
    title: "Self-serve deflection rate",
    categoryKey: "economics",
    unit: "%",
    direction: "higher_better",
    indicatorType: "leading",
    tier: "input",
    parentKey: "supportCostPerAccount",
    targetDefault: 35,
    healthyPct: 90,
    watchPct: 70,
    records: [11, 11, 12, 12, 14, 17],
  },

  // ── Tree two: growth. Healthy at the root, soft at one edge. ─────────
  {
    key: "netRevenueRetention",
    title: "Net revenue retention",
    categoryKey: "growth",
    unit: "%",
    direction: "higher_better",
    indicatorType: "lagging",
    tier: "impact",
    targetDefault: 110,
    healthyPct: 90,
    watchPct: 80,
    records: [104, 103, 102, 101, 100, 100],
  },
  {
    key: "activation30",
    title: "30-day activation rate",
    categoryKey: "growth",
    unit: "%",
    direction: "higher_better",
    indicatorType: "lagging",
    tier: "outcome",
    parentKey: "netRevenueRetention",
    targetDefault: 65,
    healthyPct: 90,
    watchPct: 70,
    records: [39, 40, 41, 41, 44, 51],
  },
  {
    key: "timeToFirstValue",
    title: "Median time to first value",
    categoryKey: "growth",
    unit: "days",
    direction: "lower_better",
    indicatorType: "leading",
    tier: "output",
    parentKey: "activation30",
    targetDefault: 5,
    healthyPct: 90,
    watchPct: 70,
    records: [12, 13, 14, 14, 11, 9],
  },
  {
    key: "logoRetention90",
    title: "90-day logo retention",
    categoryKey: "customer",
    unit: "%",
    direction: "higher_better",
    indicatorType: "lagging",
    tier: "outcome",
    parentKey: "netRevenueRetention",
    targetDefault: 95,
    healthyPct: 95,
    watchPct: 88,
    records: [90, 89, 88, 88, 89, 89],
  },

  // ── One calculated metric, so the formula builder has a worked example. ──
  {
    key: "supportCostPerTicket",
    title: "Support cost per ticket",
    categoryKey: "reliability",
    unit: "USD",
    direction: "lower_better",
    indicatorType: "lagging",
    tier: "outcome",
    targetDefault: 30,
    healthyPct: 90,
    watchPct: 70,
    formula: {
      op: "div",
      left: "supportCostPerAccount",
      right: "ticketsPerAccount",
    },
  },

  /**
   * One metric with no readings at all, so `no_data` is on the grid beside the
   * other four states. A KPI nobody has recorded is unmeasured, not failing,
   * and the grid says so rather than showing it as zero.
   */
  {
    key: "onboardingNps",
    title: "Onboarding NPS",
    categoryKey: "customer",
    direction: "higher_better",
    indicatorType: "lagging",
    tier: "outcome",
    targetDefault: 40,
    healthyPct: 90,
    watchPct: 70,
  },
];

export const KPI_TREES: readonly {
  readonly name: string;
  readonly rootKey: KpiKey;
}[] = [
  { name: "Unit economics", rootKey: "operatingMargin" },
  { name: "Growth", rootKey: "netRevenueRetention" },
];

/**
 * The KPI a recovery objective is launched from (METHOD.md §6.5).
 *
 * Operating margin, because it is the one below its corridor floor and the one
 * with leading drivers at the edge of its unhealthy branch, which is what the
 * breadth-first drafter turns into key results.
 */
export const RECOVERY_KPI_KEY: KpiKey = "operatingMargin";
