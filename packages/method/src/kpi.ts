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

/**
 * §6.2's five kinds of target (P9-T17a): stay at or above, stay at or below,
 * increase to, decrease to, stay within a range.
 */
export const KPI_TARGET_TYPES = [
  "at_least",
  "at_most",
  "increase_to",
  "decrease_to",
  "range",
] as const;
export type KpiTargetType = (typeof KPI_TARGET_TYPES)[number];

/** The bands a KPI can be in, before a recovery or missing data is considered. */
export type KpiBand = "healthy" | "watch" | "unhealthy";

/**
 * §6.2's thresholds, in the KPI's own units. Null where unset.
 *
 * A KPI that should stay high uses the low pair, one that should stay low the
 * high pair, and a range uses `greenLow` to `greenHigh` as its band with a red
 * boundary on either side where too far that way matters.
 */
export interface KpiThresholds {
  readonly greenLow: number | null;
  readonly greenHigh: number | null;
  readonly redLow: number | null;
  readonly redHigh: number | null;
}

export const NO_THRESHOLDS: KpiThresholds = {
  greenLow: null,
  greenHigh: null,
  redLow: null,
  redHigh: null,
};

/** Which way is better under a target type, for the ratio fallback. Null for a range. */
export function directionOfTargetType(
  type: KpiTargetType,
): KpiDirection | null {
  if (type === "range") {
    return null;
  }
  return type === "at_most" || type === "decrease_to"
    ? "lower_better"
    : "higher_better";
}

/** The target type a KPI written before §6.2 had them reads as. */
export function targetTypeOfDirection(direction: KpiDirection): KpiTargetType {
  return direction === "lower_better" ? "at_most" : "at_least";
}

/**
 * Whether the thresholds a type needs are all present (§6.2). A range needs
 * its band; its red boundaries are optional. A one-sided type needs its green
 * and its red value.
 */
function thresholdsComplete(
  type: KpiTargetType,
  thresholds: KpiThresholds,
): boolean {
  if (type === "range") {
    return thresholds.greenLow !== null && thresholds.greenHigh !== null;
  }
  return directionOfTargetType(type) === "lower_better"
    ? thresholds.greenHigh !== null && thresholds.redHigh !== null
    : thresholds.greenLow !== null && thresholds.redLow !== null;
}

/**
 * What is wrong with a set of thresholds for a type, in words, or null.
 *
 * Refused at the boundary so a KPI is never judged by half a rule. None at all
 * is fine: the ratio fallback applies.
 */
export function thresholdsProblem(
  type: KpiTargetType,
  thresholds: KpiThresholds,
): string | null {
  const { greenLow, greenHigh, redLow, redHigh } = thresholds;
  const none = [greenLow, greenHigh, redLow, redHigh].every((v) => v === null);
  if (none) {
    return type === "range"
      ? "A range needs its band: the lowest and highest values that are green."
      : null;
  }
  if (!thresholdsComplete(type, thresholds)) {
    return type === "range"
      ? "A range needs its band: the lowest and highest values that are green."
      : "Give both the green value and the red value, or neither.";
  }
  if (type === "range") {
    if ((greenLow as number) > (greenHigh as number)) {
      return "The bottom of the green band is above its top.";
    }
    if (redLow !== null && redLow > (greenLow as number)) {
      return "The red boundary below sits above the green band.";
    }
    if (redHigh !== null && redHigh < (greenHigh as number)) {
      return "The red boundary above sits below the green band.";
    }
    return null;
  }
  if (directionOfTargetType(type) === "lower_better") {
    return (redHigh as number) < (greenHigh as number)
      ? "The red value has to be above the green one when lower is better."
      : null;
  }
  return (redLow as number) > (greenLow as number)
    ? "The red value has to be below the green one when higher is better."
    : null;
}

export type KpiHealthBasis = "thresholds" | "ratio";

export interface KpiReading {
  /** Null when there is nothing to judge: no value, or a ratio with no target. */
  readonly band: KpiBand | null;
  /** What decided the band, so a screen can say which rule it is reading. */
  readonly basis: KpiHealthBasis;
  /** §6.4's ratio, kept for display and the recovery projection. Null for a range. */
  readonly achievementPct: number | null;
  readonly diagnostic: KpiDiagnostic | null;
}

/**
 * §6.4: a KPI's band from its own thresholds, in its own units, by its target
 * type, and the ratio fallback where it has none (P9-T17a).
 *
 * Green is inclusive and red is strict, as the method writes them: "green at
 * or above 13.5, red below 8". Between the two is watch. A range is green
 * inside its band; outside it, past a red boundary is unhealthy and short of
 * one is watch.
 *
 * The fallback is the corridor over achievement that every KPI used before
 * §6.2 had target types. It suits a positive number counted from zero and
 * nothing else, which is why `basis` travels with the answer.
 */
export function kpiReading(input: {
  readonly targetType: KpiTargetType;
  readonly thresholds: KpiThresholds;
  readonly actual: number | null;
  readonly target: number | null;
  readonly corridor: KpiCorridor;
}): KpiReading {
  const { targetType, thresholds, actual, target } = input;
  const direction = directionOfTargetType(targetType);
  const ratio =
    direction === null
      ? { pct: null, diagnostic: null }
      : kpiAchievement(direction, actual, target);

  if (thresholdsComplete(targetType, thresholds)) {
    return {
      band:
        actual === null
          ? null
          : bandByThresholds(targetType, thresholds, actual),
      basis: "thresholds",
      achievementPct: ratio.pct,
      diagnostic: null,
    };
  }
  return {
    band:
      ratio.pct === null
        ? null
        : ratio.pct >= input.corridor.healthyPct
          ? "healthy"
          : ratio.pct >= input.corridor.watchPct
            ? "watch"
            : "unhealthy",
    basis: "ratio",
    achievementPct: ratio.pct,
    diagnostic: ratio.diagnostic,
  };
}

function bandByThresholds(
  type: KpiTargetType,
  thresholds: KpiThresholds,
  actual: number,
): KpiBand {
  const { greenLow, greenHigh, redLow, redHigh } = thresholds;
  if (type === "range") {
    if (actual >= (greenLow as number) && actual <= (greenHigh as number)) {
      return "healthy";
    }
    if (actual < (greenLow as number)) {
      return redLow !== null && actual < redLow ? "unhealthy" : "watch";
    }
    return redHigh !== null && actual > redHigh ? "unhealthy" : "watch";
  }
  if (directionOfTargetType(type) === "lower_better") {
    if (actual <= (greenHigh as number)) {
      return "healthy";
    }
    return actual > (redHigh as number) ? "unhealthy" : "watch";
  }
  if (actual >= (greenLow as number)) {
    return "healthy";
  }
  return actual < (redLow as number) ? "unhealthy" : "watch";
}

/**
 * §6.4's state from a band: no data first, then the band (P9-T17b-a).
 *
 * A recovery is not a state. A KPI with an active recovery OKR is shown as
 * recovering beside its real band, never instead of it, because a collapsing
 * metric that read "recovering" could quietly stay that way while the
 * recovery's own progress moved.
 */
export function kpiStateOf(band: KpiBand | null): KpiState {
  return band ?? "no_data";
}

/**
 * Whether a KPI is recovering: an overlay beside its state, never the state
 * itself (§6.4, P9-T17b-a). A closed recovery no longer holds it.
 */
export function kpiRecovering(recovery: RecoveryLink): boolean {
  return recovery === "open";
}

/**
 * §6.4's states. `recovering` is no longer written since P9-T17b-a, and is
 * kept because rows the previous release wrote still carry it and the
 * database still accepts it; readers turn it back into the band it hid.
 */
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
 * §6.4's corridor state on the ratio fallback (design §3): no data, then the
 * band. Also how a reader turns a stored `recovering`, written before
 * P9-T17b-a, back into the band it hid: those rows predate thresholds, so the
 * ratio is the rule they were judged by.
 */
export function kpiState(
  achievementPct: number | null,
  corridor: KpiCorridor,
): KpiState {
  if (achievementPct === null) {
    return "no_data";
  }
  if (achievementPct >= corridor.healthyPct) {
    return "healthy";
  }
  return achievementPct >= corridor.watchPct ? "watch" : "unhealthy";
}
