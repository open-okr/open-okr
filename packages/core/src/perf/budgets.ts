/**
 * TECHNICAL-PLAN §13.1's budgets, and what measures each one (P7-T01b).
 *
 * §13.1 lists fourteen rows and they are not all the same kind of thing. Some
 * are a server read this process can time directly. Some are a browser paint,
 * a frame rate or a Core Web Vital, which needs a real page and belongs to
 * P7-T05. One is a delivery through a chat provider, which needs a channel and
 * belongs to P7-T02.
 *
 * **Every row appears here, including the ones measured elsewhere.** A budget
 * table that silently held only the convenient rows would report green while
 * saying nothing about the rest, which is the same failure the query-count
 * budget's ceiling has on its own. A row this harness cannot time names the
 * task that can, so the gap is a stated handover rather than an omission.
 *
 * **Milliseconds are the 95th percentile where §13.1 says so**, and the median
 * otherwise. A single timing of a warm query is not a budget: the harness runs
 * each measured row several times and reports the percentile the row asks for.
 */

/** Who measures a row, when it is not this harness. */
type MeasuredBy = "here" | "P7-T05, in a browser" | "P7-T02, under load";

export interface Budget {
  /** §13.1's own wording, so the table and the document can be compared. */
  readonly surface: string;
  /** The ceiling in milliseconds. */
  readonly ms: number;
  /** Which statistic the ceiling applies to. */
  readonly statistic: "p95" | "median";
  readonly measuredBy: MeasuredBy;
  /** The action to call, when this harness measures it. */
  readonly action?: string;
  readonly input?: Record<string, unknown>;
  /** Why the row is not measured here, when it is not. */
  readonly note?: string;
}

export const BUDGETS: readonly Budget[] = [
  {
    surface: "Work Map first paint, 100 nodes visible",
    ms: 1000,
    statistic: "median",
    measuredBy: "here",
    // The server half of the row. The 2.0s interactive half is a browser
    // measurement and P7-T05 owns it.
    action: "goals.list",
    input: {},
  },
  {
    surface: "Work Map and list scroll, 60fps at 10,000 rows",
    ms: 16,
    statistic: "median",
    measuredBy: "P7-T05, in a browser",
    note: "A frame rate, which needs a rendered list and a scroll.",
  },
  {
    surface: "Goal page opened from a list",
    ms: 300,
    statistic: "median",
    measuredBy: "here",
    action: "goals.read",
    input: {},
  },
  {
    surface: "Board render, 4 columns by 50 cards",
    ms: 1500,
    statistic: "median",
    measuredBy: "here",
    action: "tasks.board",
    input: {},
  },
  {
    surface: "Review inbox",
    ms: 500,
    statistic: "p95",
    measuredBy: "here",
    action: "review.inbox",
    input: {},
  },
  {
    surface: "Draft Coach evaluation on typing",
    ms: 16,
    statistic: "p95",
    measuredBy: "here",
    // A pure function in `packages/method`, so it is timed in process rather
    // than through an action. §13.1's point is that it never blocks a
    // keystroke, and 16ms is one frame at 60fps.
    action: "method.evaluateDraft",
  },
  {
    surface: "Alignment score recomputation, 10,000 goals",
    ms: 2000,
    statistic: "median",
    measuredBy: "here",
    action: "alignment.read",
    // The cycle is filled in by the runner, which reads one from the workspace.
    input: {},
  },
  {
    surface: "KPI grid, 200 KPIs by 24 periods",
    ms: 1500,
    statistic: "median",
    measuredBy: "here",
    action: "kpis.grid",
    input: {},
  },
  {
    surface: "Session stage transition, 20 participants",
    ms: 200,
    statistic: "median",
    measuredBy: "P7-T02, under load",
    note: "Needs twenty connected clients on one session to mean anything.",
  },
  {
    surface: "Global search suggestions",
    ms: 300,
    statistic: "p95",
    measuredBy: "here",
    action: "search.query",
    input: { text: "objective" },
  },
  {
    surface: "Save actions, server acknowledgement",
    ms: 500,
    statistic: "p95",
    measuredBy: "P7-T02, under load",
    note: "A write, and the row is about acknowledgement under real concurrency rather than one call on an idle server.",
  },
  {
    surface: "Channel nudge delivery, trigger to delivery",
    ms: 60_000,
    statistic: "p95",
    measuredBy: "P7-T02, under load",
    note: "Needs a channel provider and the scheduler running.",
  },
  {
    surface: "Largest contentful paint",
    ms: 2500,
    statistic: "p95",
    measuredBy: "P7-T05, in a browser",
    note: "A Core Web Vital.",
  },
  {
    surface: "Interaction to next paint",
    ms: 200,
    statistic: "p95",
    measuredBy: "P7-T05, in a browser",
    note: "A Core Web Vital.",
  },
];

/** The percentile of a sample, nearest-rank. */
export function percentile(
  samples: readonly number[],
  fraction: number,
): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(
    1,
    Math.min(sorted.length, Math.ceil(fraction * sorted.length)),
  );
  return sorted[rank - 1] as number;
}

/** The statistic a row is judged on. */
export function statisticOf(
  samples: readonly number[],
  statistic: Budget["statistic"],
): number {
  return percentile(samples, statistic === "p95" ? 0.95 : 0.5);
}
