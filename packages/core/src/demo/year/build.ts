/**
 * `buildNorthwindYear`: the Northwind year as of today (P9-T22c,
 * `docs/design/p9-t22c-northwind-year.md`).
 *
 * Every event of the year dated on or before today, on the real calendar, in
 * date order. The year's frame is P9-T22c-a's; each quarter joins the same
 * timeline in its own part.
 */
import { callAction } from "../../actions/registry.ts";
import { isoDay } from "./calendar.ts";
import { FRAME_EVENTS } from "./frame.ts";
import { PILOT_EVENTS } from "./pilot.ts";
import { Q1_PLAN_EVENTS } from "./q1-plan.ts";
import { Q1_RUN_EVENTS } from "./q1-run.ts";
import { Q2_PLAN_EVENTS } from "./q2-plan.ts";
import { Q2_EARLY_EVENTS } from "./q2-run.ts";
import {
  runYear,
  type YearEvent,
  type YearSeed,
  yearContext,
} from "./timeline.ts";

/** The year's events, frame first, each part's after it. */
const YEAR_EVENTS: readonly YearEvent[] = [
  ...FRAME_EVENTS,
  ...PILOT_EVENTS,
  ...Q1_PLAN_EVENTS,
  ...Q1_RUN_EVENTS,
  ...Q2_PLAN_EVENTS,
  ...Q2_EARLY_EVENTS,
];

export interface NorthwindYearResult {
  readonly alreadySeeded: boolean;
  /** Today, as the seed placed the year against it. */
  readonly today: string;
  /** The events written. */
  readonly events: number;
}

export async function buildNorthwindYear(
  seed: YearSeed & {
    /** Today; the real date unless a test places the year earlier. */
    readonly today?: Date;
  },
): Promise<NorthwindYearResult> {
  const today = isoDay(seed.today ?? new Date());
  const context = yearContext(seed, today);

  // Idempotent the way the one-quarter demo is: a workspace that already
  // holds company objectives is somebody's, and the seed leaves it alone.
  const existing = await callAction(context.action, "goals.list", {
    includeClosed: true,
    level: "company",
  });
  if (existing.goals.length > 0) {
    return { alreadySeeded: true, today, events: 0 };
  }

  const events = await runYear(context, YEAR_EVENTS);
  return { alreadySeeded: false, today, events };
}
