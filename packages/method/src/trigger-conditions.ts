/**
 * When the twelve silent §6.4 triggers fire (completeness review H-11).
 *
 * AI-NATIVE-PLAN §6.4 catalogues forty-five triggers, and twelve had a row in
 * the catalogue and nothing that ever emitted them. The readers that emit them
 * live in `packages/core/src/nudges`; the decision each one makes lives here,
 * so it is pure, runs with the AI provider off, and reads every number from
 * the §11 registry.
 *
 * | Trigger | Fires when |
 * |---|---|
 * | `confidence.critical` | A confidence recorded at or below `scoring.confidenceCritical` |
 * | `commitment.due` | The last working day of a commitment's week, still open |
 * | `streak.at_risk` | The last working day of a week with no session, after one held last week |
 * | `digest.weekly` | A weekly session has just closed |
 * | `cycle.phase_blocked` | A planning phase's §2.4 window closes today and it is incomplete |
 * | `quality.no_not_doing` | Phase 3 is done and the frame has no not-doing list |
 * | `quality.too_many_objectives` | A level or a unit holds more objectives than its cap |
 * | `quality.sandbagging_draft` | An objective's average draft confidence on its aspirational key results is above `scoring.draftSandbagging` |
 * | `quality.committed_floor` | A committed key result's confidence is below `scoring.committedConfidenceFloor`, drafted there or checked in there (P9-T11b-c) |
 * | `quality.sandbagging_close` | Three quarters or more of a closed cycle's aspirational key results scored 1.0 (`scoring.closeTooSafeShare`) |
 * | `quality.no_cuts` | Capacity has verdicts and nothing is recorded as cut |
 * | `quality.trending_off` | A key result's stored forecast misses its target |
 * | `quality.process_health_low` | A quarterly review closed with process-health answers |
 *
 * Dates are local `YYYY-MM-DD` strings in the workspace timezone.
 */
import { SUGGESTED_TIMELINE } from "./guidance.ts";
import {
  belowCommittedFloor,
  type KindedScore,
  type OkrKind,
  tooSafePattern,
} from "./scoring.ts";
import {
  currentStreakOn,
  type Holiday,
  isHolidayPeriod,
  lastWorkingDayOfPeriod,
  periodStartOf,
} from "./streak.ts";
import type { CheckInFrequency, ResolvedThresholds } from "./thresholds.ts";

const DAY_MS = 86_400_000;
const toTime = (on: string): number => Date.parse(`${on}T00:00:00Z`);
const addDays = (on: string, days: number): string =>
  new Date(toTime(on) + days * DAY_MS).toISOString().slice(0, 10);
/** 1 for Monday to 7 for Sunday. */
const isoWeekday = (on: string): number => {
  const day = new Date(toTime(on)).getUTCDay();
  return day === 0 ? 7 : day;
};
const mondayOf = (on: string): string => addDays(on, 1 - isoWeekday(on));
/** Friday, the last working day of the week that starts on `monday`. */
const lastWorkingDay = (monday: string): string => addDays(monday, 4);

const average = (values: readonly (number | null)[]): number | null => {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0
    ? null
    : known.reduce((sum, value) => sum + value, 0) / known.length;
};

/**
 * §3.2's committed rule: any committed key result below the floor. A key
 * result nobody has given a confidence is not below anything yet, and an
 * aspirational one is never judged by the floor.
 */
export function committedBelowFloor(
  keyResults: readonly {
    readonly confidence: number | null;
    readonly kind: OkrKind;
  }[],
  thresholds: ResolvedThresholds,
): boolean {
  return keyResults.some(
    (keyResult) =>
      keyResult.confidence !== null &&
      belowCommittedFloor(keyResult.confidence, keyResult.kind, thresholds),
  );
}

/**
 * §3.2, METHOD v2 (P9-T19a-c-a): "A drop matters more than a level. When a
 * key result's confidence falls into the low band, the coordinator is told.
 * A key result drafted low on purpose, such as an aspirational moonshot, does
 * not escalate for staying where it started."
 *
 * So a fall, not a level: from at or above the low boundary to below it.
 * With no earlier confidence there is nothing to have fallen from, which is
 * what keeps a moonshot drafted at 0.2 quiet.
 */
export function confidenceFellIntoLow(
  previous: number | null,
  current: number | null,
  thresholds: ResolvedThresholds,
): boolean {
  const low = thresholds["scoring.confidenceLow"];
  return (
    previous !== null && current !== null && previous >= low && current < low
  );
}

/**
 * §3.2: critical confidence, 0.3 and below. Since METHOD v2 it reaches the
 * sponsor the same day only where the workspace turns critical escalation on.
 */
export function confidenceIsCritical(
  confidence: number | null,
  thresholds: ResolvedThresholds,
): boolean {
  return (
    confidence !== null &&
    confidence <= thresholds["scoring.confidenceCritical"]
  );
}

/**
 * §7.2 step 3's commitments are for the coming week. The reminder comes on
 * the week's last working day, while there is still a day to deliver.
 */
export function commitmentDueToday(weekStart: string, today: string): boolean {
  return lastWorkingDay(mondayOf(weekStart)) === today;
}

/**
 * §7.4: "a skipped period breaks" the streak (P9-T19a-d-b). At risk on the
 * last working day of a check-in period that holds no session yet, when the
 * period before did hold one, counted in the space's own periods: a week, a
 * fortnight or a month. Nothing to say when a session is still booked for
 * later in the period, because the session's own reminders cover it.
 */
export function streakAtRisk(input: {
  readonly today: string;
  readonly currentWeeks: number;
  readonly lastSessionOn: string | null;
  readonly bookedLaterThisWeek: boolean;
  /** The space's frequency. Weekly where it is not given. */
  readonly frequency?: CheckInFrequency;
  /**
   * The space's marked holidays (P9-T19b-a). A holiday period cannot break
   * the streak, so it puts nothing at risk, and the holidays before it are
   * not the gap that would.
   */
  readonly holidays?: readonly Holiday[];
}): boolean {
  if (input.currentWeeks <= 0 || !input.lastSessionOn) {
    return false;
  }
  const frequency = input.frequency ?? "weekly";
  const holidays = input.holidays ?? [];
  const thisPeriod = periodStartOf(input.today, frequency);
  if (isHolidayPeriod(input.today, frequency, holidays)) {
    return false;
  }
  const lastPeriod = periodStartOf(input.lastSessionOn, frequency);
  return (
    input.today === lastWorkingDayOfPeriod(input.today, frequency) &&
    lastPeriod < thisPeriod &&
    // The last one held was the last period that counted before this one:
    // alive today, and broken tomorrow if this one passes too.
    currentStreakOn(
      { currentWeeks: 1, longestWeeks: 1, lastWeek: lastPeriod },
      input.today,
      frequency,
      holidays,
    ) > 0 &&
    !input.bookedLaterThisWeek
  );
}

/**
 * The §2.4 phases whose window closes today, from the suggested timeline
 * itself so the two cannot disagree.
 *
 * Each row names the weeks before the start it runs in. A phase's window
 * closes when the last of its weeks has passed: a phase run "3 to 2" weeks
 * before the start is due one week before it. Phases 1 to 5 only: phase 6
 * runs through the cycle and phase 7 closes it.
 */
export function phasesClosingToday(
  mode: "annual" | "quarterly",
  daysUntilStart: number,
): readonly number[] {
  const closing: number[] = [];
  for (const row of SUGGESTED_TIMELINE[mode]) {
    if (row.afterStart) {
      continue;
    }
    const weeks = (row.weeksBefore.match(/\d+/g) ?? []).map(Number);
    if (weeks.length === 0) {
      continue;
    }
    const closesWeeksBefore = Math.max(Math.min(...weeks) - 1, 0);
    if (daysUntilStart !== closesWeeksBefore * 7) {
      continue;
    }
    for (const match of row.activity.matchAll(/Phase (\d)/g)) {
      const phase = Number(match[1]);
      if (phase >= 1 && phase <= 5 && !closing.includes(phase)) {
        closing.push(phase);
      }
    }
  }
  return closing.sort();
}

/**
 * OBJ-5's caps, read across a cycle: the company level against
 * `quality.companyObjectiveCap`, and each unit against
 * `quality.objectivesPerUnitCap`. One sentence per breach.
 */
export function objectivesOverCap(
  objectives: readonly {
    readonly level: string;
    readonly unitId: string | null;
    readonly unitName?: string | null;
  }[],
  thresholds: ResolvedThresholds,
): readonly string[] {
  const breaches: string[] = [];
  const company = objectives.filter((goal) => goal.level === "company").length;
  const companyCap = thresholds["quality.companyObjectiveCap"];
  if (company > companyCap) {
    breaches.push(
      `${company} company objectives, above the cap of ${companyCap}`,
    );
  }
  const perUnit = thresholds["quality.objectivesPerUnitCap"];
  const units = new Map<string, { name: string; count: number }>();
  for (const goal of objectives) {
    if (!goal.unitId) {
      continue;
    }
    const unit = units.get(goal.unitId) ?? {
      name: goal.unitName ?? "A unit",
      count: 0,
    };
    unit.count += 1;
    units.set(goal.unitId, unit);
  }
  for (const unit of units.values()) {
    if (unit.count > perUnit) {
      breaches.push(
        `${unit.name} holds ${unit.count} objectives, above the cap of ${perUnit}`,
      );
    }
  }
  return breaches;
}

/**
 * §3.2: an aspirational set averaging above the near-certain threshold is
 * business as usual. Committed key results are left out, because high
 * confidence is right for a commitment (P9-T11a).
 */
export function draftIsSandbagged(
  keyResults: readonly {
    readonly confidence: number | null;
    readonly kind: OkrKind;
  }[],
  thresholds: ResolvedThresholds,
): boolean {
  const mean = average(
    keyResults
      .filter((entry) => entry.kind === "aspirational")
      .map((entry) => entry.confidence),
  );
  return mean !== null && mean > thresholds["scoring.draftSandbagging"];
}

/**
 * §3.3: three quarters or more of a closed cycle's aspirational key results
 * at 1.0 means the targets were too safe. Committed ones are left out.
 */
export function closeIsSandbagged(
  scored: readonly KindedScore[],
  thresholds: ResolvedThresholds,
): boolean {
  return tooSafePattern(scored, thresholds);
}
