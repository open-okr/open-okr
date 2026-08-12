/**
 * Cycle generation from a cadence (TECHNICAL-PLAN §4.3, METHOD.md §2.1, P3-T02).
 *
 * Pure calendar arithmetic. A cycle's bounds are **local dates in the workspace
 * timezone**, never instants, for the same reason the cadence engine works that
 * way: a quarter starting on 1 July has to start on 1 July for everybody in the
 * workspace, and instant arithmetic would hand somebody 30 June.
 *
 * The only place a timezone enters is reading today's local date out of an
 * instant, which `localDateIn` does through `Intl` rather than by adding hours.
 * Everything after that is integer month and day maths, so there is no daylight
 * saving case to get wrong: a calendar date has no offset.
 *
 * **No fiscal-year offset.** The year is the calendar year. A workspace whose
 * financial year starts in April would need one, and nothing in REQUIREMENTS,
 * TECHNICAL-PLAN or METHOD asks for it, so it is recorded as a known
 * simplification in `docs/design/p3-t00-okr-core-domain.md` §3.3 rather than
 * half-built here.
 */
import type { CycleCadence, CycleMode } from "@openokr/db";

/** A calendar date with no offset and no time, as three integers. */
export interface LocalDate {
  readonly year: number;
  /** 1 to 12, unlike `Date`'s zero-based months. */
  readonly month: number;
  readonly day: number;
}

export interface CyclePeriod {
  readonly name: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly cadence: CycleCadence;
  readonly mode: CycleMode;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const pad = (value: number): string => String(value).padStart(2, "0");

/** `2026-08-12`, the shape a Postgres `date` column takes and returns. */
export function formatLocalDate(date: LocalDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** Parses `2026-08-12`. Throws on anything else: a bad date is never a default. */
export function parseLocalDate(value: string): LocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error(`"${value}" is not a YYYY-MM-DD date.`);
  }
  const [, year, month, day] = match as unknown as [
    string,
    string,
    string,
    string,
  ];
  return { year: Number(year), month: Number(month), day: Number(day) };
}

/**
 * Today's calendar date, as the workspace's timezone sees it.
 *
 * Asked of `Intl` rather than computed, because the offset for a given instant
 * in a given zone is a question only the timezone database can answer, and it
 * changes twice a year in most of them.
 */
export function localDateIn(instant: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const read = (type: "year" | "month" | "day"): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day") };
}

/** Days in a month, leap years included. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The period of the given cadence that contains `on`.
 *
 * Calendar-aligned, which is what makes "Q3 2026" mean the same thing to
 * everybody: a quarterly cadence always produces Jan to Mar, Apr to Jun, Jul to
 * Sep, Oct to Dec, whatever date it was asked about.
 */
export function cyclePeriodFor(
  cadence: CycleCadence,
  on: LocalDate,
): CyclePeriod {
  const mode: CycleMode = cadence === "annual" ? "annual" : "quarterly";

  if (cadence === "annual") {
    return {
      name: String(on.year),
      startsOn: formatLocalDate({ year: on.year, month: 1, day: 1 }),
      endsOn: formatLocalDate({ year: on.year, month: 12, day: 31 }),
      cadence,
      mode,
    };
  }

  if (cadence === "semiannual") {
    const half = on.month <= 6 ? 1 : 2;
    const startMonth = half === 1 ? 1 : 7;
    const endMonth = half === 1 ? 6 : 12;
    return {
      name: `H${half} ${on.year}`,
      startsOn: formatLocalDate({ year: on.year, month: startMonth, day: 1 }),
      endsOn: formatLocalDate({
        year: on.year,
        month: endMonth,
        day: daysInMonth(on.year, endMonth),
      }),
      cadence,
      mode,
    };
  }

  if (cadence === "monthly") {
    return {
      name: `${MONTH_NAMES[on.month - 1]} ${on.year}`,
      startsOn: formatLocalDate({ year: on.year, month: on.month, day: 1 }),
      endsOn: formatLocalDate({
        year: on.year,
        month: on.month,
        day: daysInMonth(on.year, on.month),
      }),
      cadence,
      mode,
    };
  }

  const quarter = Math.floor((on.month - 1) / 3) + 1;
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return {
    name: `Q${quarter} ${on.year}`,
    startsOn: formatLocalDate({ year: on.year, month: startMonth, day: 1 }),
    endsOn: formatLocalDate({
      year: on.year,
      month: endMonth,
      day: daysInMonth(on.year, endMonth),
    }),
    cadence,
    mode,
  };
}

/** The period after the one containing `on`. */
export function nextCyclePeriod(
  cadence: CycleCadence,
  on: LocalDate,
): CyclePeriod {
  const current = cyclePeriodFor(cadence, on);
  const end = parseLocalDate(current.endsOn);
  // The day after this period ends is inside the next one, whatever the cadence,
  // which avoids a per-cadence "add N months" branch and its year-boundary bug.
  const dayAfter = addDays(end, 1);
  return cyclePeriodFor(cadence, dayAfter);
}

/** `count` periods forward from the one containing `on`, `count` >= 0. */
export function cyclePeriodsFrom(
  cadence: CycleCadence,
  on: LocalDate,
  count: number,
): readonly CyclePeriod[] {
  const periods: CyclePeriod[] = [];
  let cursor = on;
  for (let index = 0; index < count; index++) {
    const period = cyclePeriodFor(cadence, cursor);
    periods.push(period);
    cursor = addDays(parseLocalDate(period.endsOn), 1);
  }
  return periods;
}

/**
 * Adds whole days to a calendar date.
 *
 * Done through a UTC `Date`, which is safe precisely because it is UTC: no
 * offset, no daylight saving, and the result is read back as Y/M/D rather than
 * as an instant.
 */
export function addDays(date: LocalDate, days: number): LocalDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

/**
 * Which status a cycle should hold on a given date, from its own bounds.
 *
 * `closed` is never inferred: closing a cycle is an act with a scoring session
 * and an archive job behind it (P3-T15), not a date passing. So this returns
 * `closing` for a cycle whose end has passed and leaves the decision to a human.
 */
export function statusForDate(
  period: { startsOn: string; endsOn: string },
  today: LocalDate,
  published: boolean,
): "planning" | "active" | "closing" {
  const now = formatLocalDate(today);
  if (now > period.endsOn) {
    return "closing";
  }
  if (now < period.startsOn) {
    return "planning";
  }
  return published ? "active" : "planning";
}
