/**
 * Scoring, health and the trend forecast (METHOD.md §3, TECHNICAL-PLAN §6.2,
 * P3-T05).
 *
 * Pure: no database, no clock beyond the `now` a caller passes, no framework.
 * Total: every input produces an answer and nothing throws on bad data, because
 * a scoring function that can throw is a scoring function that takes a page down.
 * Impossible states become a defined value and a diagnostic.
 *
 * **Why this lives in `packages/method` and not `packages/core`.** The design
 * document says core, written before the split had been exercised. Every function
 * here is a rule from METHOD.md §3 with a §11 threshold as an argument: the
 * progress formula, the band tables, the health precedence, the verdicts. The
 * repository rule is that those live here and nowhere else, and the same code has
 * to run in the browser as somebody types, on the server before a write, and
 * inside the agents. What stayed in core is what needs rows: loading the graph and
 * writing the derived columns.
 *
 * Three numbers stay separate and are never averaged together (§3): progress is
 * backward-looking 0 to 100, confidence is forward-looking 0.0 to 1.0, and score
 * is the final backward judgement 0.0 to 1.0.
 */
import type { ResolvedThresholds } from "./thresholds.ts";

export type KeyResultDirection = "increase" | "reduce" | "maintain" | "move";

/** Two decimals, rounded half away from zero. Applied once, at the boundary. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scaled = value * 100;
  const rounded =
    scaled < 0
      ? -Math.round(-scaled + Number.EPSILON)
      : Math.round(scaled + Number.EPSILON);
  return rounded / 100;
}

const clampPercent = (value: number): number =>
  Math.min(100, Math.max(0, value));

export interface KeyResultProgressInput {
  readonly direction: KeyResultDirection;
  readonly baseline: number;
  readonly target: number;
  readonly current: number;
  /**
   * A linked KPI's real achievement, 0 to 200 (decision D-4). When present the
   * four direction formulas are ignored: the value has one source of truth, and
   * the recovery projection is deliberately not it.
   */
  readonly kpiAchievementPct?: number | null;
}

/**
 * §3.1, direction-aware and clamped.
 *
 * `move` shares `increase`'s formula on purpose: both terms invert when the
 * target sits below the baseline, so a downward move reads the same way up.
 *
 * Equal endpoints score 0 everywhere except `maintain`, where they describe a
 * band one point wide.
 */
export function keyResultProgress(input: KeyResultProgressInput): number {
  const { direction, baseline, target, current } = input;

  if (
    input.kpiAchievementPct !== undefined &&
    input.kpiAchievementPct !== null
  ) {
    return round2(clampPercent(input.kpiAchievementPct));
  }

  if (direction === "maintain") {
    const low = Math.min(baseline, target);
    const high = Math.max(baseline, target);
    if (current >= low && current <= high) {
      return 100;
    }
    const width = high - low;
    if (width === 0) {
      // No width to scale by, so the only passing answer is an exact match.
      return 0;
    }
    const distance = current < low ? low - current : current - high;
    return round2(clampPercent(100 * (1 - distance / width)));
  }

  const span = direction === "reduce" ? baseline - target : target - baseline;
  if (span === 0) {
    // Nothing to move across. Reporting 100 here would call a key result that
    // measures nothing complete.
    return 0;
  }
  const travelled =
    direction === "reduce" ? baseline - current : current - baseline;
  return round2(clampPercent((travelled / span) * 100));
}

/** One weighted item in a goal's average: a key result or an aligned child. */
export interface WeightedItem {
  readonly weight: number;
  readonly progressPct: number;
}

/**
 * §3.1, the weighted average.
 *
 * A total weight of zero is 0%, not an error and not 100 (decision D-3). Weight 0
 * means "tracked, does not count", so an item carrying it stays visible and stays
 * out of the arithmetic.
 */
export function weightedProgress(items: readonly WeightedItem[]): number {
  // Weights are clamped here as well as on write. The write path is where a
  // person's typo is caught; this is where an imported row carrying 150 is, and a
  // pure function that trusted its input would let one team's bad data dominate a
  // company average.
  const weightOf = (item: WeightedItem): number =>
    Math.min(100, Math.max(0, item.weight));

  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  if (total <= 0) {
    return 0;
  }
  const weighted = items.reduce(
    (sum, item) => sum + weightOf(item) * item.progressPct,
    0,
  );
  return round2(clampPercent(weighted / total));
}

/** One node of the parent graph, as the cascade needs to see it. */
export interface CascadeGoal {
  readonly id: string;
  readonly weight: number;
  /** The goal this one rolls into, or the key result it aligns to. */
  readonly parentGoalId?: string | null;
  readonly parentKeyResultId?: string | null;
  readonly keyResults: readonly {
    readonly id: string;
    readonly weight: number;
    readonly progressPct: number;
  }[];
}

export interface CascadeResult {
  /** Progress per goal id. */
  readonly goals: ReadonlyMap<string, number>;
  /** `cycle:<child>-><parent>` for every edge the cycle pass dropped. */
  readonly diagnostics: readonly string[];
}

/**
 * The upward cascade (§3.1, decision D-2).
 *
 * **Cycle breaking runs first, as its own pass, and does not depend on where a
 * traversal started.** Otherwise the same graph would produce different numbers
 * on different requests. In each cycle the parent pointer belonging to the node
 * whose id sorts highest is dropped, which makes that node a root and is
 * deterministic for any input order. The write path refuses to create a cycle at
 * all, so this exists for data that arrived through an import.
 *
 * A child aligned to a key result contributes to the goal that owns it and leaves
 * that key result's own measured progress alone (decision D-2). A measured 40%
 * key result must not display 80% because another team did well.
 */
export function cascadeProgress(goals: readonly CascadeGoal[]): CascadeResult {
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  const keyResultOwner = new Map<string, string>();
  for (const goal of goals) {
    for (const keyResult of goal.keyResults) {
      keyResultOwner.set(keyResult.id, goal.id);
    }
  }

  /** The goal a node rolls into, whichever pointer it used. */
  const parentOf = (goal: CascadeGoal): string | null => {
    if (goal.parentGoalId && byId.has(goal.parentGoalId)) {
      return goal.parentGoalId;
    }
    if (goal.parentKeyResultId) {
      return keyResultOwner.get(goal.parentKeyResultId) ?? null;
    }
    return null;
  };

  const parents = new Map<string, string | null>();
  for (const goal of goals) {
    parents.set(goal.id, parentOf(goal));
  }

  // Pass one: find every cycle and drop one edge from each, deterministically.
  //
  // A three-colour walk rather than "follow the chain from every node and look
  // for a repeat". The naive version is quadratic, which the 1,000-goal budget in
  // decision D-13 rejects outright: it measured 374 ms against a 200 ms ceiling.
  // Each node is visited once here, and a node already settled ends the walk.
  const diagnostics: string[] = [];
  const settled = new Set<string>();
  for (const goal of goals) {
    if (settled.has(goal.id)) {
      continue;
    }
    const path: string[] = [];
    const onPath = new Set<string>();
    let cursor: string | null = goal.id;

    while (cursor !== null && !settled.has(cursor) && !onPath.has(cursor)) {
      path.push(cursor);
      onPath.add(cursor);
      cursor = parents.get(cursor) ?? null;
    }

    if (cursor !== null && onPath.has(cursor)) {
      // The ring is the tail of the path from where it re-enters itself.
      const ring = path.slice(path.indexOf(cursor));
      const highest = [...ring].sort().at(-1) as string;
      const dropped = parents.get(highest);
      if (dropped !== null && dropped !== undefined) {
        parents.set(highest, null);
        diagnostics.push(`cycle:${highest}->${dropped}`);
      }
    }

    for (const id of path) {
      settled.add(id);
    }
  }

  const children = new Map<string, string[]>();
  for (const [id, parent] of parents) {
    if (parent === null) {
      continue;
    }
    const list = children.get(parent) ?? [];
    list.push(id);
    children.set(parent, list);
  }

  // Pass two: children first, so a parent's items are known before it is read.
  //
  // Iterative rather than recursive, and with no per-node guard set. A thousand-
  // goal chain is a thousand frames deep, which is close enough to the stack
  // limit to be somebody's outage, and copying a guard set at every level was the
  // other half of the quadratic cost the budget caught.
  const progress = new Map<string, number>();
  const stack: { id: string; expanded: boolean }[] = goals.map((goal) => ({
    id: goal.id,
    expanded: false,
  }));

  while (stack.length > 0) {
    const frame = stack.pop() as { id: string; expanded: boolean };
    if (progress.has(frame.id)) {
      continue;
    }
    const goal = byId.get(frame.id);
    if (!goal) {
      continue;
    }
    const childIds = children.get(frame.id) ?? [];

    if (!frame.expanded) {
      const pending = childIds.filter((childId) => !progress.has(childId));
      if (pending.length > 0) {
        stack.push({ id: frame.id, expanded: true });
        for (const childId of pending) {
          stack.push({ id: childId, expanded: false });
        }
        continue;
      }
    }

    const items: WeightedItem[] = goal.keyResults.map((keyResult) => ({
      weight: keyResult.weight,
      progressPct: keyResult.progressPct,
    }));
    for (const childId of childIds) {
      const child = byId.get(childId);
      if (!child) {
        continue;
      }
      // A child with no answer yet can only happen if the cycle pass missed one,
      // which it cannot. Reading 0 keeps the function total either way.
      items.push({
        weight: child.weight,
        progressPct: progress.get(childId) ?? 0,
      });
    }

    progress.set(frame.id, weightedProgress(items));
  }

  return { goals: progress, diagnostics };
}

export type GoalHealth =
  | "pending"
  | "on_track"
  | "caution"
  | "off_track"
  | "outdated"
  | "achieved"
  | "missed";

export interface HealthInput {
  readonly closed: boolean;
  readonly successStatus?: "achieved" | "missed" | null;
  /** The latest published check-in's status, or null when there is none. */
  readonly latestStatus?: "on_track" | "caution" | "off_track" | null;
  /** Days past `next_check_in_at`. Negative before it, 0 on the day. */
  readonly daysPastDue: number | null;
  readonly graceDays: number;
}

/**
 * §3.5, a precedence cascade and never a formula over progress.
 *
 * Two consequences are easy to get wrong and are the reason this is a table
 * rather than a chain of guesses. A goal nobody ever checked in, already past its
 * grace, reads `outdated` and not `pending`. And a goal whose last check-in said
 * `on_track` reads `outdated` once the grace passes, which is the plan's own
 * acceptance criterion. The grace boundary is exclusive: at exactly the limit the
 * goal is not yet outdated.
 */
export function goalHealth(input: HealthInput): GoalHealth {
  if (input.closed) {
    return input.successStatus === "missed" ? "missed" : "achieved";
  }
  if (input.daysPastDue !== null && input.daysPastDue > input.graceDays) {
    return "outdated";
  }
  if (input.latestStatus) {
    return input.latestStatus;
  }
  return "pending";
}

export type ProgressSignal = "green" | "amber" | "red";

/**
 * §3.7, shown beside health and never instead of it.
 *
 * The asymmetry is the canon's: green includes its boundary, red excludes its own.
 */
export function progressSignal(
  progressPct: number,
  thresholds: ResolvedThresholds,
): ProgressSignal {
  const pass = thresholds["scoring.progressSignalPass"];
  const fail = thresholds["scoring.progressSignalFail"];
  if (progressPct >= pass) {
    return "green";
  }
  if (progressPct < fail) {
    return "red";
  }
  return "amber";
}

export type ScoreBand = "fully_achieved" | "strong" | "partial" | "little";
export type ScoreAnnotation = "too_safe" | "intended" | "none" | "disconnected";

/** §3.3. Scored at the close, against the key result as written. */
export function scoreBand(
  score: number,
  thresholds: ResolvedThresholds,
): ScoreBand {
  const bands = thresholds["scoring.scoreBands"];
  if (score >= bands.achieved) {
    return "fully_achieved";
  }
  if (score >= bands.strong) {
    return "strong";
  }
  if (score >= bands.partial) {
    return "partial";
  }
  return "little";
}

/**
 * §3.3's annotations, first match wins, which leaves 0.3 up to below 0.6
 * deliberately unannotated. The coach says nothing there on purpose.
 */
export function scoreAnnotation(
  score: number,
  thresholds: ResolvedThresholds,
): ScoreAnnotation {
  const bands = thresholds["scoring.scoreAnnotations"];
  if (score >= bands.tooSafe) {
    return "too_safe";
  }
  if (score >= bands.intended) {
    return "intended";
  }
  if (score < bands.disconnected) {
    return "disconnected";
  }
  return "none";
}

/** One key result's contribution to its objective's score. */
export interface ScoredKeyResult {
  /** 0.0 to 1.0, as §3.3 grades it. Null when it has not been scored. */
  readonly score: number | null;
  /** `key_results.weight`. §3.2's weighting, and the reason this is not a mean. */
  readonly weight: number;
}

/**
 * An objective's score from its key results (METHOD.md §3.2 and §3.3).
 *
 * **Weighted, following §3.2's weights.** §8.3 says so now; it did not when this
 * was written. §3.3 graded a key result and §3.4 averaged a set, and nothing
 * stated how an objective's own score was built. Agung decided on 21 August 2026
 * that it follows progress, and §8.3 carries the sentence as of 24 August: a team
 * that said one key result matters three times as much sees that in the score,
 * exactly as it sees it in the progress. The cycle score stays the plain average
 * §3.4 states, which is a different question about a different set.
 *
 * Null when nothing is scored yet, so a screen can tell "not scored" from
 * "scored zero". Unscored key results are left out of both the numerator and the
 * denominator rather than counted as zero: a half-graded objective must not read
 * as a failing one while the room is still working through it.
 *
 * A weight of zero contributes nothing and is not an error. A set whose scored
 * rows all weigh zero has no weighted answer at all, and null is the honest one.
 */
export function objectiveScore(
  keyResults: readonly ScoredKeyResult[],
): number | null {
  const scored = keyResults.filter(
    (entry): entry is ScoredKeyResult & { score: number } =>
      entry.score !== null,
  );
  if (scored.length === 0) {
    return null;
  }
  const weight = scored.reduce((sum, entry) => sum + entry.weight, 0);
  if (weight <= 0) {
    return null;
  }
  return (
    scored.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / weight
  );
}

/**
 * The cycle score (METHOD.md §8.6, over §3.4's average).
 *
 * §8.6 words it exactly: "the §3.4 portfolio average over every scored key
 * result in the cycle". A plain average, not weighted, and over key results
 * rather than over objective scores. Averaging the objective scores would weight
 * an objective with two key results the same as one with eight, which is a
 * different number than the document asks for.
 */
export function cycleScore(scores: readonly number[]): number | null {
  if (scores.length === 0) {
    return null;
  }
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

export type PortfolioVerdict =
  | "too_safe"
  | "healthy"
  | "partial"
  | "outran_capacity";

/**
 * §3.4, the average across a scored set.
 *
 * Null for an empty set rather than a division by zero: the scorecard renders
 * "nothing scored yet", which is a different statement from a bad verdict.
 */
export function portfolioVerdict(
  scores: readonly number[],
  thresholds: ResolvedThresholds,
): PortfolioVerdict | null {
  if (scores.length === 0) {
    return null;
  }
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return portfolioVerdictOf(average, thresholds);
}

/** The same bands over an average somebody else computed. */
export function portfolioVerdictOf(
  average: number,
  thresholds: ResolvedThresholds,
): PortfolioVerdict {
  const bands = thresholds["scoring.portfolioVerdicts"];
  // The canon words the top band as "above", so its own boundary is healthy.
  if (average > bands.tooSafe) {
    return "too_safe";
  }
  if (average >= bands.healthy) {
    return "healthy";
  }
  if (average >= bands.partial) {
    return "partial";
  }
  return "outran_capacity";
}

export type ConfidenceBand = "high" | "medium" | "low";

export interface ConfidenceVerdict {
  readonly band: ConfidenceBand;
  /**
   * §3.2's one extra rule inside the low band: at the critical threshold and
   * below, the coordinator raises it with management the same day. The nudge
   * engine at P4-T05 consumes this; here it is only computed.
   */
  readonly escalatesSameDay: boolean;
}

export function confidenceBand(
  confidence: number,
  thresholds: ResolvedThresholds,
): ConfidenceVerdict {
  const high = thresholds["scoring.confidenceHigh"];
  const low = thresholds["scoring.confidenceLow"];
  const critical = thresholds["scoring.confidenceCritical"];
  const band: ConfidenceBand =
    confidence >= high ? "high" : confidence >= low ? "medium" : "low";
  return { band, escalatesSameDay: confidence <= critical };
}

export type DraftVerdict =
  | "sandbagging"
  | "comfortable"
  | "sweet_spot"
  | "ambitious"
  | "moonshot";

/**
 * §3.2's second table, judged on the **set** average at drafting time and never
 * on one key result. A single cautious key result is not a sandbagged set.
 */
export function draftVerdict(
  average: number,
  thresholds: ResolvedThresholds,
): DraftVerdict {
  const sandbagging = thresholds["scoring.draftSandbagging"];
  const comfortable = thresholds["scoring.draftComfortable"];
  const moonshot = thresholds["scoring.draftAmbitious"];
  // §3.2's five bands need four boundaries and the §11 registry holds three:
  // 0.90, 0.75 and 0.25. The fourth, the sweet spot's floor at 0.40, is the same
  // number as the confidence low band's own boundary in the same section, so it
  // is read from there rather than written down a second time. Recorded as an
  // open question: if the two are ever meant to move apart, §11 needs a
  // `scoring.draftSweetSpot` parameter, and that is a METHOD.md decision.
  const sweetSpot = thresholds["scoring.confidenceLow"];
  if (average > sandbagging) {
    return "sandbagging";
  }
  // "Above 0.75, up to 0.90" is comfortable, so 0.75 itself is the top of the
  // sweet spot. Both upper bands are worded as "above" and both exclude their
  // own boundary.
  if (average > comfortable) {
    return "comfortable";
  }
  if (average >= sweetSpot) {
    return "sweet_spot";
  }
  if (average >= moonshot) {
    return "ambitious";
  }
  return "moonshot";
}

export interface ForecastPoint {
  /** Any consistent numeric time axis. Days or milliseconds both work. */
  readonly at: number;
  readonly value: number;
}

export interface Forecast {
  readonly projected: number;
  readonly trendingOffTrack: boolean;
}

/**
 * §3.6 with decision D-5's window: an ordinary least squares fit over every value
 * point in the window, projected to the horizon.
 *
 * The projection is deliberately not clamped. A linear fit can project past what
 * is possible, and the comparison against the target is what matters: a key
 * result that will land at 120 of a 100 target is not off track, and saying so
 * needs the 120.
 *
 * Fewer than two points at distinct times gives no forecast at all, rather than a
 * flat line through one measurement.
 */
export function trendForecast(
  points: readonly ForecastPoint[],
  horizon: number,
  target: {
    readonly direction: KeyResultDirection;
    readonly baseline: number;
    readonly target: number;
  },
): Forecast | null {
  const distinct = new Set(points.map((point) => point.at));
  if (points.length < 2 || distinct.size < 2) {
    return null;
  }

  const n = points.length;
  const meanAt = points.reduce((sum, point) => sum + point.at, 0) / n;
  const meanValue = points.reduce((sum, point) => sum + point.value, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.at - meanAt) * (point.value - meanValue);
    variance += (point.at - meanAt) ** 2;
  }
  if (variance === 0) {
    return null;
  }
  const slope = covariance / variance;
  const intercept = meanValue - slope * meanAt;
  const projected = round2(intercept + slope * horizon);

  const trendingOffTrack = (() => {
    if (target.direction === "maintain") {
      const low = Math.min(target.baseline, target.target);
      const high = Math.max(target.baseline, target.target);
      return projected < low || projected > high;
    }
    if (target.direction === "reduce") {
      return projected > target.target;
    }
    return projected < target.target;
  })();

  return { projected, trendingOffTrack };
}
