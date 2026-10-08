/**
 * `buildNorthwindYear`: the Northwind year as of today (P9-T22c,
 * `docs/design/northwind-year-seed.md`).
 *
 * Every event of the year dated on or before today, on the real calendar, in
 * date order. The year's frame is P9-T22c-a's; each quarter joins the same
 * timeline in its own part.
 */
import { callAction } from "../../actions/registry.ts";
import { ANNUAL_CLOSE_EVENTS } from "./annual-close.ts";
import { isoDay } from "./calendar.ts";
import { FRAME_EVENTS } from "./frame.ts";
import { PILOT_EVENTS } from "./pilot.ts";
import { Q1_PLAN_EVENTS } from "./q1-plan.ts";
import { Q1_RUN_EVENTS } from "./q1-run.ts";
import { Q2_CLOSE_EVENTS } from "./q2-close.ts";
import { Q2_PLAN_EVENTS } from "./q2-plan.ts";
import { Q2_EARLY_EVENTS } from "./q2-run.ts";
import { Q3_CLOSE_EVENTS } from "./q3-close.ts";
import { Q3_PLAN_EVENTS } from "./q3-plan.ts";
import { Q3_EARLY_EVENTS } from "./q3-run.ts";
import { Q4_CLOSE_EVENTS } from "./q4-close.ts";
import { Q4_PLAN_EVENTS } from "./q4-plan.ts";
import { Q4_EARLY_EVENTS } from "./q4-run.ts";
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
  ...Q2_CLOSE_EVENTS,
  ...Q3_PLAN_EVENTS,
  ...Q3_EARLY_EVENTS,
  ...Q3_CLOSE_EVENTS,
  ...Q4_PLAN_EVENTS,
  ...Q4_EARLY_EVENTS,
  ...Q4_CLOSE_EVENTS,
  ...ANNUAL_CLOSE_EVENTS,
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
    /**
     * Only the year's frame: its people, spaces, settings, KPIs and annual
     * objectives. For a test that reads nothing a quarter writes, because the
     * whole year is the slowest thing the suite builds.
     */
    readonly frameOnly?: boolean;
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

  const events = await runYear(
    context,
    seed.frameOnly ? FRAME_EVENTS : YEAR_EVENTS,
  );
  return { alreadySeeded: false, today, events };
}
