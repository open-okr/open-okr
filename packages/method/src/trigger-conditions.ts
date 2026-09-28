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
 * | `quality.sandbagging_draft` | An objective's average draft confidence is above `scoring.draftSandbagging` |
 * | `quality.sandbagging_close` | A cycle's scores average above `scoring.closeSandbagging` at the close |
 * | `quality.no_cuts` | Capacity has verdicts and nothing is recorded as cut |
 * | `quality.trending_off` | A key result's stored forecast misses its target |
 * | `quality.process_health_low` | A quarterly review closed with process-health answers |
 *
 * Dates are local `YYYY-MM-DD` strings in the workspace timezone.
 */
import { SUGGESTED_TIMELINE } from "./guidance.ts";
import type { ResolvedThresholds } from "./thresholds.ts";

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

/** §3.2: "0.3 and below is raised with management the same day." */
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
 * §7.2: "a rhythm streak that a skipped week breaks." At risk on the last
 * working day of a week that holds no session yet, when the week before did
 * hold one. Nothing to say when a session is still booked for later this week,
 * because the session's own reminders cover it.
 */
export function streakAtRisk(input: {
  readonly today: string;
  readonly currentWeeks: number;
  readonly lastSessionOn: string | null;
  readonly bookedLaterThisWeek: boolean;
}): boolean {
  if (input.currentWeeks <= 0 || !input.lastSessionOn) {
    return false;
  }
  const thisMonday = mondayOf(input.today);
  return (
    input.today === lastWorkingDay(thisMonday) &&
    mondayOf(input.lastSessionOn) === addDays(thisMonday, -7) &&
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

/** §3.2: a set averaging above the draft threshold is business as usual. */
export function draftIsSandbagged(
  confidences: readonly (number | null)[],
  thresholds: ResolvedThresholds,
): boolean {
  const mean = average(confidences);
  return mean !== null && mean > thresholds["scoring.draftSandbagging"];
}

/** §3.4: scores clustering above the close threshold mean safe targets. */
export function closeIsSandbagged(
  scores: readonly (number | null)[],
  thresholds: ResolvedThresholds,
): boolean {
  const mean = average(scores);
  return mean !== null && mean > thresholds["scoring.closeSandbagging"];
}
