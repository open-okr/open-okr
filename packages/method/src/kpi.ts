/**
 * KPI period normalisation, achievement and the corridor state (METHOD.md §6.4,
 * design `p3-t00-kpi-engine.md` §1 to §3, P3-T12).
 *
 * In `packages/method` for the reason the scoring and alignment engines are:
 * every function here is a §6 rule taking a §11 threshold as an argument. The
 * same code has to run in the grid as somebody types, on the server before the
 * write, and inside the importer normalising a legacy period key.
 *
 * Pure. No database, no clock, no timezone lookup: a caller that knows the
 * workspace calendar passes a local date in, and gets a local date back. Doing
 * the arithmetic on calendar dates rather than instants is the same decision the
 * cadence engine made at P3-T06, and for the same reason.
 *
 * §4 onward of the design document (effective health, the formula grammar, the
 * cascade, the recovery drafter) are P3-T13 and P3-T14.
 */

export const KPI_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;
export type KpiFrequency = (typeof KPI_FREQUENCIES)[number];

export const KPI_DIRECTIONS = ["higher_better", "lower_better"] as const;
export type KpiDirection = (typeof KPI_DIRECTIONS)[number];

export const KPI_STATES = [
  "healthy",
  "watch",
  "unhealthy",
  "recovering",
  "no_data",
] as const;
export type KpiState = (typeof KPI_STATES)[number];

/** A calendar date, `YYYY-MM-DD`, in the workspace timezone. */
export type LocalDate = string;

function parse(date: LocalDate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) {
    throw new Error(`Not a local date: "${date}".`);
  }
  return { y, m, d };
}

function format(y: number, m: number, d: number): LocalDate {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * The bucket a date falls in (design §1).
 *
 * Calendar periods, never rolling windows: a value lands in exactly one bucket,
 * and the bucket is a date the database can hold a unique index on. The weekly
 * case is decision D-12, the Monday of the ISO week, which is why a Sunday
 * belongs to the week that began five days earlier rather than the one starting
 * tomorrow.
 */
export function normalisePeriod(
  frequency: KpiFrequency,
  date: LocalDate,
): LocalDate {
  const { y, m, d } = parse(date);
  switch (frequency) {
    case "daily":
      return format(y, m, d);
    case "weekly": {
      // Parsed as UTC on purpose. The date carries no time, so converting it
      // through any zone would be converting something that has nothing to
      // convert, and could shift the weekday.
      const at = new Date(Date.UTC(y, m - 1, d));
      // getUTCDay is 0 for Sunday, so Sunday steps back six days rather than
      // forward one. That single line is the whole D-12 decision.
      const back = (at.getUTCDay() + 6) % 7;
      at.setUTCDate(at.getUTCDate() - back);
      return format(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
    }
    case "monthly":
      return format(y, m, 1);
    case "quarterly":
      return format(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
    case "yearly":
      return format(y, 1, 1);
  }
}

export type KpiDiagnostic = "negative_target";

export interface KpiAchievement {
  /** Null when there is nothing to divide, or nothing sensible to divide by. */
  readonly pct: number | null;
  readonly diagnostic: KpiDiagnostic | null;
}

const FLOOR = 0;
/**
 * Decision D-10, revised at the design gate: the ceiling is 200 rather than
 * uncapped. `lower_better` with an actual of zero divides by zero and the
 * function has to stay total, so a ceiling is unavoidable; applying it to both
 * directions keeps them symmetrical. Nothing behaves differently at the corridor
 * boundaries, which only ever test from below.
 */
const CEILING = 200;

function clamp(value: number): number {
  return Math.round(Math.min(CEILING, Math.max(FLOOR, value)) * 100) / 100;
}

/**
 * §6.4's direction-aware ratio of current to target (design §2).
 *
 * Written as ordered cases rather than one expression, because a ratio has three
 * ways to go wrong and each needs its own answer.
 */
export function kpiAchievement(
  direction: KpiDirection,
  actual: number | null,
  target: number | null,
): KpiAchievement {
  if (actual === null || target === null) {
    return { pct: null, diagnostic: null };
  }
  if (target < 0) {
    // Decision D-15. There is no correct ratio over a negative target: for
    // `higher_better` with a target of -3 and an actual of -1, the ratio reads
    // 33% while the KPI has actually beaten its target. The owner is told to
    // model it as `lower_better` on the loss instead.
    return { pct: null, diagnostic: "negative_target" };
  }
  if (actual === target) {
    return { pct: 100, diagnostic: null };
  }
  if (direction === "higher_better") {
    if (target === 0) {
      return { pct: actual > 0 ? CEILING : FLOOR, diagnostic: null };
    }
    return { pct: clamp((actual / target) * 100), diagnostic: null };
  }
  if (actual <= 0) {
    // Lower is better and the actual reached zero or went below it, which is as
    // good as it gets. The division would be by zero or would flip sign.
    return { pct: CEILING, diagnostic: null };
  }
  if (target === 0) {
    // A zero target with a positive actual under `lower_better`: the target was
    // missed, and the ratio target/actual is 0 anyway.
    return { pct: FLOOR, diagnostic: null };
  }
  return { pct: clamp((target / actual) * 100), diagnostic: null };
}

/** Whether a linked recovery goal is holding this KPI in `recovering`. */
export type RecoveryLink = "none" | "open" | "closed";

export interface KpiCorridor {
  readonly healthyPct: number;
  readonly watchPct: number;
}

/**
 * §6.4's corridor state (design §3). Precedence, first match wins.
 *
 * No data outranks a recovery on purpose: a KPI nobody has recorded is not
 * recovering, it is unmeasured, and telling somebody a recovery is under way on
 * a metric with no values would be the product inventing progress.
 *
 * A closed recovery no longer holds the KPI. It returns to whichever band it has
 * actually reached, which is the honest outcome whether the recovery worked or
 * not.
 */
export function kpiState(
  achievementPct: number | null,
  recovery: RecoveryLink,
  corridor: KpiCorridor,
): KpiState {
  if (achievementPct === null) {
    return "no_data";
  }
  if (recovery === "open") {
    return "recovering";
  }
  if (achievementPct >= corridor.healthyPct) {
    return "healthy";
  }
  return achievementPct >= corridor.watchPct ? "watch" : "unhealthy";
}
