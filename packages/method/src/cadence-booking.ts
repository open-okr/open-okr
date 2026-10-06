/**
 * Booking the §7.1 rhythm for a whole cycle, and reading whether it is booked
 * (METHOD.md §7.1, §2.3 phase 6, CY-8; completeness review H-08).
 *
 * §7.1 names three rituals and how often each happens: a weekly check-in every
 * week, a monthly review every month, and a quarterly review at cycle close.
 * Then: "Book all of them for the whole cycle before the cycle starts." Phase
 * 6's first condition and CY-8 both ask exactly that, and until this file
 * nothing could answer it, because nothing in the product could book a session.
 *
 * Two functions over the same reading of §7.1, so the planner and the check
 * cannot disagree about what "booked" means:
 *
 * | Ritual | Booked when |
 * |---|---|
 * | Weekly check-in | Every Monday-to-Sunday week the cycle touches holds one, inside the cycle. A week whose days inside the cycle are all a weekend is not asked for one |
 * | Monthly review | Every calendar month the cycle touches holds a monthly review, or the quarterly review, inside the cycle |
 * | Quarterly review | One falls in the cycle's last seven days or the week after it |
 *
 * **No threshold is introduced.** Each row is §7.1's own frequency read onto a
 * calendar. "At cycle close" is the one reading that needed a width, and a week
 * either side of the close is the same unit the weekly ritual is counted in.
 *
 * Dates are local `YYYY-MM-DD` strings in the workspace timezone, like every
 * other cycle bound. Pure: no clock, no database.
 */
import type { RitualKind } from "./sessions.ts";
import { periodStartOf } from "./streak.ts";
import type { CheckInFrequency } from "./thresholds.ts";

/** A cycle's first and last day, inclusive. */
export interface CadenceWindow {
  readonly startsOn: string;
  readonly endsOn: string;
}

/** One ritual on one local date. */
export interface BookedRitual {
  readonly kind: RitualKind;
  readonly on: string;
}

export interface CadenceCoverage {
  readonly booked: boolean;
  /** One sentence per ritual that is short, in words a facilitator can act on. */
  readonly missing: readonly string[];
}

/** 1 for Monday to 5 for Friday. Rituals are booked on working days. */
export type RitualWeekday = 1 | 2 | 3 | 4 | 5;

export interface CadencePlanOptions {
  readonly weekday: RitualWeekday;
  /**
   * The first date worth booking. Today, or tomorrow once today's hour has
   * passed. Nothing is booked in the past: a week already gone stays a gap, and
   * `cadenceCoverage` says so rather than the planner papering over it.
   */
  readonly from: string;
  /** What is already booked. The plan fills only the gaps the check would name. */
  readonly existing: readonly BookedRitual[];
  /**
   * The space's check-in frequency (P9-T19a-d-b): one check-in is booked per
   * week, fortnight or month. Weekly where not given.
   */
  readonly frequency?: CheckInFrequency;
}

interface Span {
  readonly from: string;
  readonly to: string;
}

const DAY_MS = 86_400_000;

const toTime = (on: string): number => Date.parse(`${on}T00:00:00Z`);
const fromTime = (time: number): string =>
  new Date(time).toISOString().slice(0, 10);
const addDays = (on: string, days: number): string =>
  fromTime(toTime(on) + days * DAY_MS);
/** 1 for Monday to 7 for Sunday. */
const isoWeekday = (on: string): number => {
  const day = new Date(toTime(on)).getUTCDay();
  return day === 0 ? 7 : day;
};
const isWorkingDay = (on: string): boolean => isoWeekday(on) <= 5;
const within = (on: string, span: Span): boolean =>
  on >= span.from && on <= span.to;
const later = (a: string, b: string): string => (a > b ? a : b);
const earlier = (a: string, b: string): string => (a < b ? a : b);

function daysOf(span: Span): string[] {
  const days: string[] = [];
  for (let on = span.from; on <= span.to; on = addDays(on, 1)) {
    days.push(on);
  }
  return days;
}

/** The Monday-to-Sunday weeks the window touches, clipped to it. */
function weeksOf(window: CadenceWindow): Span[] {
  const spans: Span[] = [];
  let monday = addDays(window.startsOn, 1 - isoWeekday(window.startsOn));
  while (monday <= window.endsOn) {
    spans.push({
      from: later(monday, window.startsOn),
      to: earlier(addDays(monday, 6), window.endsOn),
    });
    monday = addDays(monday, 7);
  }
  return spans;
}

/** The calendar months the window touches, clipped to it. */
/**
 * The spans a cycle's check-ins are booked in, at the space's frequency
 * (P9-T19a-d-b): weeks, the streak's fortnights, or months. A daily space still meets weekly, and a quarterly one meets once.
 */
function checkInPeriodsOf(
  window: CadenceWindow,
  frequency: CheckInFrequency,
): Span[] {
  if (frequency === "monthly") {
    return monthsOf(window);
  }
  if (frequency === "quarterly") {
    return [{ from: window.startsOn, to: window.endsOn }];
  }
  if (frequency === "biweekly") {
    // The streak's own fortnights, counted from the same fixed Monday, so
    // every check-in booked here lands in a period of its own there.
    const spans: Span[] = [];
    let start = periodStartOf(window.startsOn, "biweekly");
    while (start <= window.endsOn) {
      spans.push({
        from: later(start, window.startsOn),
        to: earlier(addDays(start, 13), window.endsOn),
      });
      start = addDays(start, 14);
    }
    return spans;
  }
  return weeksOf(window);
}

/** What a period is called in a coverage sentence. */
const PERIOD_WORDS: Readonly<Record<string, string>> = {
  biweekly: "fortnight(s)",
  monthly: "month(s)",
  quarterly: "cycle",
};

function monthsOf(window: CadenceWindow): Span[] {
  const spans: Span[] = [];
  let first = `${window.startsOn.slice(0, 7)}-01`;
  while (first <= window.endsOn) {
    const [year, month] = first.split("-").map(Number) as [number, number];
    const next = fromTime(Date.UTC(year, month, 1));
    spans.push({
      from: later(first, window.startsOn),
      to: earlier(addDays(next, -1), window.endsOn),
    });
    first = next;
  }
  return spans;
}

/** The cycle's last seven days and the week after them. */
function closeOf(window: CadenceWindow): Span {
  return {
    from: later(addDays(window.endsOn, -6), window.startsOn),
    to: addDays(window.endsOn, 7),
  };
}

const hasWorkingDay = (span: Span): boolean => daysOf(span).some(isWorkingDay);

/** Up to three dates, then a count, so a year of gaps stays one sentence. */
function listOf(dates: readonly string[]): string {
  const shown = dates.slice(0, 3).join(", ");
  return dates.length > 3 ? `${shown} and ${dates.length - 3} more` : shown;
}

/**
 * Whether the whole cycle is booked, and what is not.
 *
 * Sessions of any state count, because a ritual that already happened was
 * booked. A cancelled one should not be passed in.
 */
export function cadenceCoverage(
  window: CadenceWindow,
  sessions: readonly BookedRitual[],
  /** The space's check-in frequency (P9-T19a-d-b). Weekly where not given. */
  frequency: CheckInFrequency = "weekly",
): CadenceCoverage {
  const missing: string[] = [];
  const of = (kinds: readonly RitualKind[]) =>
    sessions.filter((session) => kinds.includes(session.kind));

  const weekly = of(["weekly"]);
  const openWeeks = checkInPeriodsOf(window, frequency)
    .filter(hasWorkingDay)
    .filter((week) => !weekly.some((session) => within(session.on, week)));
  if (openWeeks.length > 0) {
    const words = PERIOD_WORDS[frequency];
    missing.push(
      words === undefined
        ? `No weekly check-in is booked in ${openWeeks.length} week(s): the weeks from ${listOf(openWeeks.map((week) => week.from))}`
        : `No check-in is booked in ${openWeeks.length} ${words}: the periods from ${listOf(openWeeks.map((week) => week.from))}`,
    );
  }

  const reviews = of(["monthly", "quarterly"]);
  const openMonths = monthsOf(window)
    .filter(hasWorkingDay)
    .filter((month) => !reviews.some((session) => within(session.on, month)));
  if (openMonths.length > 0) {
    missing.push(
      `No monthly review is booked in ${openMonths.length} month(s): ${listOf(openMonths.map((month) => month.from.slice(0, 7)))}`,
    );
  }

  const close = closeOf(window);
  if (!of(["quarterly"]).some((session) => within(session.on, close))) {
    missing.push(
      `No quarterly review is booked at cycle close, between ${close.from} and ${close.to}`,
    );
  }

  return { booked: missing.length === 0, missing };
}

/**
 * The working day in a span nearest the chosen weekday, not before `from`.
 * `last` picks the latest match instead of the first, which is what a monthly
 * or closing review wants: late enough to have something to review.
 */
function pick(
  span: Span,
  weekday: RitualWeekday,
  from: string,
  last = false,
): string | null {
  const candidates = daysOf(span).filter(
    (on) => on >= from && isWorkingDay(on),
  );
  if (candidates.length === 0) {
    return null;
  }
  const exact = candidates.filter((on) => isoWeekday(on) === weekday);
  if (exact.length > 0) {
    return (last ? exact.at(-1) : exact[0]) as string;
  }
  // A partial week at either end of the cycle may not contain the chosen day.
  // The nearest working day inside it keeps the week booked.
  const ranked = [...candidates].sort(
    (a, b) =>
      Math.abs(isoWeekday(a) - weekday) - Math.abs(isoWeekday(b) - weekday) ||
      a.localeCompare(b),
  );
  return ranked[0] as string;
}

/**
 * The rituals to book so `cadenceCoverage` reads booked, given what exists.
 *
 * Idempotent by construction: run it twice with the first run's output in
 * `existing` and the second returns nothing. Gaps already in the past are left
 * alone, so a cycle booked late still reads as not booked for the weeks it
 * missed.
 */
export function planCycleCadence(
  window: CadenceWindow,
  options: CadencePlanOptions,
): BookedRitual[] {
  const { weekday, from, existing } = options;
  const plan: BookedRitual[] = [];
  const has = (kinds: readonly RitualKind[], span: Span) =>
    [...existing, ...plan].some(
      (session) => kinds.includes(session.kind) && within(session.on, span),
    );

  // The close first, because the month it lands in needs no monthly review.
  const close = closeOf(window);
  if (!has(["quarterly"], close)) {
    const inside = { from: close.from, to: window.endsOn };
    const on =
      pick(inside, weekday, from, true) ?? pick(close, weekday, from, false);
    if (on) {
      plan.push({ kind: "quarterly", on });
    }
  }

  for (const month of monthsOf(window)) {
    if (has(["monthly", "quarterly"], month)) {
      continue;
    }
    const on = pick(month, weekday, from, true);
    if (on) {
      plan.push({ kind: "monthly", on });
    }
  }

  for (const week of checkInPeriodsOf(window, options.frequency ?? "weekly")) {
    if (has(["weekly"], week)) {
      continue;
    }
    const on = pick(week, weekday, from);
    if (on) {
      plan.push({ kind: "weekly", on });
    }
  }

  return plan.sort(
    (a, b) => a.on.localeCompare(b.on) || a.kind.localeCompare(b.kind),
  );
}
