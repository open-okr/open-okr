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
import type { KeyResultKind } from "./practice.ts";
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

/**
 * §3.1's clamp. The ceiling is the §11 `scoring.progressCeilingPct` parameter,
 * 100 by default, and it is passed in rather than defaulted here: a threshold
 * with two homes is a threshold that can disagree with itself.
 */
const clampPercent = (value: number, ceilingPct: number): number =>
  Math.min(ceilingPct, Math.max(0, value));

export interface KeyResultProgressInput {
  /**
   * What kind of key result this is (METHOD.md §2.10, P9-T12a). Left out, a
   * metric, which is every key result written before kinds existed.
   */
  readonly kind?: KeyResultKind;
  /**
   * A milestone done, or a baseline recorded. Only those two kinds read it:
   * their progress is 0% until then and 100% after.
   */
  readonly done?: boolean;
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
 * §3.1, direction-aware and clamped, and §2.10 by kind.
 *
 * A milestone and a baseline are 0% until done and 100% after, whatever the
 * numbers say. A maintain key result is the band, whatever its direction
 * says. A metric reads its direction.
 *
 * `move` shares `increase`'s formula on purpose: both terms invert when the
 * target sits below the baseline, so a downward move reads the same way up.
 *
 * Equal endpoints score 0 everywhere except `maintain`, where they describe a
 * band one point wide.
 */
export function keyResultProgress(
  input: KeyResultProgressInput,
  thresholds: ResolvedThresholds,
): number {
  const { direction, baseline, target, current } = input;
  const ceiling = thresholds["scoring.progressCeilingPct"];

  if (
    input.kpiAchievementPct !== undefined &&
    input.kpiAchievementPct !== null
  ) {
    return round2(clampPercent(input.kpiAchievementPct, ceiling));
  }

  if (input.kind === "milestone" || input.kind === "baseline") {
    return input.done ? 100 : 0;
  }

  if (direction === "maintain" || input.kind === "maintain") {
    const low = Math.min(baseline, target);
    const high = Math.max(baseline, target);
    if (current >= low && current <= high) {
      // 100 rather than the ceiling, whatever the ceiling is. A maintain key
      // result asks whether the value stayed inside a stated band, and there is
      // no sense in which a value inside a band exceeded it.
      return 100;
    }
    const width = high - low;
    if (width === 0) {
      // No width to scale by, so the only passing answer is an exact match.
      return 0;
    }
    const distance = current < low ? low - current : current - high;
    // Clamped at 100 rather than at the ceiling, for the same reason: this
    // branch measures the distance back to the band, and the band's own value
    // is 100.
    return round2(clampPercent(100 * (1 - distance / width), 100));
  }

  const span = direction === "reduce" ? baseline - target : target - baseline;
  if (span === 0) {
    // Nothing to move across. Reporting 100 here would call a key result that
    // measures nothing complete.
    return 0;
  }
  const travelled =
    direction === "reduce" ? baseline - current : current - baseline;
  return round2(clampPercent((travelled / span) * 100, ceiling));
}

/** A value at a moment, on any consistent numeric time axis. */
export interface ValuePoint {
  readonly at: number;
  readonly value: number;
}

/**
 * §2.10's maintain score: the share of the time from `from` to `to` that the
 * value spent inside the band, 0 to 1.
 *
 * The value holds from one reading until the next, which is what a reading
 * says. The time before the first reading is not counted at all, because
 * nobody knows where the value stood then: counting it outside the band would
 * punish a key result for being written before it was measured. Null with no
 * reading inside the window, or no window.
 */
export function shareInsideBand(
  points: readonly ValuePoint[],
  band: { readonly low: number; readonly high: number },
  from: number,
  to: number,
): number | null {
  if (to <= from) {
    return null;
  }
  const sorted = [...points].sort((a, b) => a.at - b.at);
  // The reading in force when the window opens, if there is one.
  const before = sorted.filter((point) => point.at <= from).at(-1);
  const within = sorted.filter((point) => point.at > from && point.at < to);
  const steps = before ? [{ ...before, at: from }, ...within] : within;
  const first = steps[0];
  if (!first) {
    return null;
  }
  const low = Math.min(band.low, band.high);
  const high = Math.max(band.low, band.high);
  let inside = 0;
  steps.forEach((step, index) => {
    const end = steps[index + 1]?.at ?? to;
    if (step.value >= low && step.value <= high) {
      inside += end - step.at;
    }
  });
  return round2(inside / (to - first.at));
}

export interface ComputedScoreInput {
  readonly kind: KeyResultKind;
  /** §3.1's progress at the close, 0 to the ceiling. */
  readonly progressPct: number;
  /** A milestone done, or a baseline recorded. */
  readonly done: boolean;
  /**
   * A maintain key result's `shareInsideBand` over the cycle, when its
   * readings are known. Without it the score falls back to where the value
   * stands now, which is what the progress already says.
   */
  readonly insideShare?: number | null;
}

/**
 * §2.10's computed score at the close, 0.0 to 1.0, before any person adjusts
 * it with a reason (§3.3, P9-T14). A metric scores its progress, capped at
 * 1.0 because a score past the target is a target that was set too low, not a
 * better score. A maintain scores its time inside the band. A milestone and a
 * baseline score 1.0 when done and 0 when not.
 */
export function computedScore(input: ComputedScoreInput): number {
  if (input.kind === "milestone" || input.kind === "baseline") {
    return input.done ? 1 : 0;
  }
  if (
    input.kind === "maintain" &&
    input.insideShare !== undefined &&
    input.insideShare !== null
  ) {
    return input.insideShare;
  }
  return round2(Math.min(100, Math.max(0, input.progressPct)) / 100);
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
export function weightedProgress(
  items: readonly WeightedItem[],
  thresholds: ResolvedThresholds,
): number {
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
  return round2(
    clampPercent(weighted / total, thresholds["scoring.progressCeilingPct"]),
  );
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
  /**
   * This node's progress, already known, when the caller loaded only part of
   * the graph.
   *
   * A caller recomputing one branch loads that branch's own nodes and the
   * siblings they roll up with. A sibling's children are not loaded, so
   * computing its progress here would read it as having none and would feed
   * the parent a number that is too low. Its stored progress stands in for
   * the subtree instead, and it is a boundary of the load rather than a
   * result of it: nothing the caller writes back should come from a node
   * carrying this.
   */
  readonly settledProgressPct?: number;
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
 *
 * **Whether children count at all is the workspace's** (§3.1, §12's
 * "Progress roll-up from aligned goals", P9-T12b). Off, which is METHOD v2's
 * default, an objective's progress is its own key results' alone, because a
 * child's work usually also moves the parent's own key results and would be
 * counted twice. Left out, `rollUp` is on, which is what every caller before
 * the setting was read assumed.
 */
export function cascadeProgress(
  goals: readonly CascadeGoal[],
  thresholds: ResolvedThresholds,
  options: { readonly rollUp?: boolean } = {},
): CascadeResult {
  const rollUp = options.rollUp ?? true;
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

    if (goal.settledProgressPct !== undefined) {
      // A boundary of a partial load: its answer came in with it, and the
      // subtree that produced it was never loaded.
      // Clamped on the way in rather than trusted: the stored number was
      // written under whatever ceiling was in force then, and a workspace that
      // has since lowered its ceiling must not see the old value stand.
      progress.set(
        frame.id,
        clampPercent(
          goal.settledProgressPct,
          thresholds["scoring.progressCeilingPct"],
        ),
      );
      continue;
    }

    const items: WeightedItem[] = goal.keyResults.map((keyResult) => ({
      weight: keyResult.weight,
      progressPct: keyResult.progressPct,
    }));
    for (const childId of rollUp ? childIds : []) {
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

    progress.set(frame.id, weightedProgress(items, thresholds));
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

/** The practice this reads: which signal the workspace uses (§12). */
export interface ProgressSignalPractice {
  readonly "progress.signal": "paceAware" | "absolute";
}

/**
 * The progress expected for the date (§3.7, P9-T15a): the share of the
 * cycle's days gone, 0 before it starts and 100 from its last day. Days are
 * local `YYYY-MM-DD` dates, compared as such.
 */
export function expectedProgressPct(
  startsOn: string,
  endsOn: string,
  today: string,
): number {
  const day = (on: string) => new Date(`${on}T00:00:00Z`).getTime();
  const span = day(endsOn) - day(startsOn);
  if (span <= 0) {
    return today >= endsOn ? 100 : 0;
  }
  const gone = (day(today) - day(startsOn)) / span;
  return round2(Math.min(100, Math.max(0, gone * 100)));
}

/**
 * §3.7, shown beside health and never instead of it.
 *
 * **Pace-aware by default** (P9-T15a): progress against the progress expected
 * for the date, green on pace, amber behind by more than the first gap, red
 * by more than the second. A goal is not red because its cycle is young.
 * Where the workspace chose the absolute signal, or no date is known, it is
 * green at or above the pass threshold and red below the fail one; the
 * asymmetry is the canon's, green including its boundary and red excluding
 * its own.
 */
export function progressSignal(
  progressPct: number,
  thresholds: ResolvedThresholds,
  pace?: {
    readonly practice: ProgressSignalPractice;
    /** `expectedProgressPct` for the goal's cycle, or null with no cycle. */
    readonly expectedPct: number | null;
  },
): ProgressSignal {
  if (
    pace !== undefined &&
    pace.practice["progress.signal"] === "paceAware" &&
    pace.expectedPct !== null
  ) {
    const gaps = thresholds["scoring.progressSignalPaceGaps"];
    const behind = pace.expectedPct - progressPct;
    if (behind > gaps.red) {
      return "red";
    }
    if (behind > gaps.amber) {
      return "amber";
    }
    return "green";
  }
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

/**
 * The kind of promise an objective makes (METHOD.md §2.8, P9-T11a): committed,
 * expected in full, or aspirational, a stretch. Every rule that judges
 * ambition asks which. An objective nobody has called committed is
 * aspirational, which is also the default for a new one.
 */
export type OkrKind = "committed" | "aspirational";

/** What the coach says beside one scored key result (§3.3's notes). */
export type ScoreNote = "explain_miss" | "root_cause" | "none";

/**
 * Doerr's colours (METHOD.md §3.3, §12 "Score colours"): 0.7 and above
 * green, 0.4 to 0.6 yellow, below 0.4 red. The Google colours are the §11
 * bands themselves, so only this option needs numbers of its own.
 */
export const DOERR_SCORE_BANDS = { strong: 0.7, partial: 0.4 } as const;

/** The practice this reads: which colours the workspace scores by. */
export interface ScoreColoursPractice {
  readonly "scoring.colours": "google" | "doerr";
}

/**
 * The bands a score is read against (§3.3, P9-T14a): §11's boundaries under
 * Google's colours, the default, or Doerr's 0.7 and 0.4 where the workspace
 * chose them. "Achieved" stays §11's either way, because both colourings agree
 * that a key result at its target is achieved.
 */
export function scoreBandsIn(
  thresholds: ResolvedThresholds,
  practice?: ScoreColoursPractice,
): {
  readonly achieved: number;
  readonly strong: number;
  readonly partial: number;
} {
  const bands = thresholds["scoring.scoreBands"];
  return practice?.["scoring.colours"] === "doerr"
    ? { achieved: bands.achieved, ...DOERR_SCORE_BANDS }
    : bands;
}

/**
 * §3.3. Scored at the close, against the key result as written. `practice`
 * chooses the colours; left out, Google's, which are §11's bands.
 */
export function scoreBand(
  score: number,
  thresholds: ResolvedThresholds,
  practice?: ScoreColoursPractice,
): ScoreBand {
  const bands = scoreBandsIn(thresholds, practice);
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
 * §3.3's notes on one key result, first match wins: a committed key result
 * below what it promised asks for the short explanation of the miss, and
 * little progress asks for its root cause. Nothing else gets a note. "Too
 * safe" is no longer said of one key result: it is a pattern across a closed
 * cycle's aspirational key results (`tooSafePattern`), and a committed key
 * result at 1.0 is a promise kept, never a target set too low.
 *
 * "Little progress" is the score bands' own lowest boundary, so the note and
 * the band say the same thing about the same score.
 */
export function scoreNote(
  score: number,
  kind: OkrKind,
  thresholds: ResolvedThresholds,
  practice?: ScoreColoursPractice,
): ScoreNote {
  if (
    kind === "committed" &&
    score < thresholds["scoring.committedExpectedScore"]
  ) {
    return "explain_miss";
  }
  if (score < scoreBandsIn(thresholds, practice).partial) {
    return "root_cause";
  }
  return "none";
}

/**
 * §3.3's notes in the coach's words, beside the key result they are about.
 * "Too safe" is said of the set, so it has its own sentence below.
 */
export const SCORE_NOTE_TEXT: Readonly<
  Record<Exclude<ScoreNote, "none">, string>
> = {
  explain_miss: "Write the short explanation of the miss",
  root_cause: "Little progress. Pick its root cause",
};

/**
 * §3.3's table: what a score means, by the kind of promise (P9-T14a). An
 * aspirational key result is read on four bands; a committed one is met at
 * 1.0 and missed below it, whichever band the number falls in.
 */
export const SCORE_BAND_TEXT: Readonly<
  Record<OkrKind, Readonly<Record<ScoreBand, string>>>
> = {
  aspirational: {
    fully_achieved: "Achieved",
    strong: "On target. The expected range for a stretch",
    partial: "Partial progress. Examine what limited it",
    little:
      "Little progress. Examine the target, the capacity, the cadence or the tracking",
  },
  committed: {
    fully_achieved: "Met",
    strong: "Missed. Explain the miss",
    partial: "Missed. Explain the miss",
    little: "Missed. Explain the miss",
  },
};

/** §3.3's pattern, said of a closed set of aspirational key results. */
export const TOO_SAFE_TEXT = "The targets were too safe";

/** §10's words for a committed key result below §3.2's floor. */
export const COMMITTED_FLOOR_TEXT =
  "A commitment nobody believes in is a risk. Escalate now, or make it aspirational";

/** A scored key result and the kind of promise it was. */
export interface KindedScore {
  readonly score: number | null;
  readonly kind: OkrKind;
}

/**
 * §3.3's one pattern: across a closed cycle, three quarters or more of the
 * aspirational key results at 1.0 means the targets were too safe. Committed
 * key results are left out, because meeting a commitment is the point of it.
 * False with nothing aspirational scored: no set, no pattern.
 */
export function tooSafePattern(
  scored: readonly KindedScore[],
  thresholds: ResolvedThresholds,
): boolean {
  const aspirational = scored.filter(
    (entry): entry is KindedScore & { score: number } =>
      entry.kind === "aspirational" && entry.score !== null,
  );
  if (aspirational.length === 0) {
    return false;
  }
  const atFull = aspirational.filter((entry) => entry.score >= 1).length;
  return (
    atFull / aspirational.length >= thresholds["scoring.closeTooSafeShare"]
  );
}

/**
 * §3.4's committed half: the share of committed key results met, which is
 * what a committed set is judged by instead of an average. Null with none
 * scored.
 */
export function committedShareMet(
  scores: readonly number[],
  thresholds: ResolvedThresholds,
): number | null {
  if (scores.length === 0) {
    return null;
  }
  const expected = thresholds["scoring.committedExpectedScore"];
  return scores.filter((score) => score >= expected).length / scores.length;
}

/**
 * Whether a scored key result needs a named root cause (§8.4): an
 * aspirational one below its threshold, a committed one below its own,
 * which by default is anything short of 1.0.
 */
export function needsRootCause(
  score: number,
  kind: OkrKind,
  thresholds: ResolvedThresholds,
): boolean {
  return score < thresholds["scoring.rootCauseThreshold"][kind];
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
 * §3.4, the average across a scored set of **aspirational** key results.
 * Committed key results are judged by the share met (`committedShareMet`),
 * because averaging the two hides both; callers pass the aspirational scores.
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
  | "near_certain"
  | "comfortable"
  | "sweet_spot"
  | "moonshot";

/**
 * §3.2's drafting table, judged on the **set** average of the aspirational
 * key results and never on one key result. A single cautious key result is
 * not a near-certain set, and a committed key result is judged by the floor
 * (`belowCommittedFloor`), where high confidence is right.
 *
 * Four bands and three boundaries, all in §11: 0.90, 0.70 and 0.30.
 */
export function draftVerdict(
  average: number,
  thresholds: ResolvedThresholds,
): DraftVerdict {
  const nearCertain = thresholds["scoring.draftSandbagging"];
  const comfortable = thresholds["scoring.draftComfortable"];
  const moonshot = thresholds["scoring.draftAmbitious"];
  // "Above 0.90" and "above 0.70, up to 0.90": both upper bands are worded
  // as "above", so each excludes its own boundary, and 0.70 itself is the
  // top of the sweet spot.
  if (average > nearCertain) {
    return "near_certain";
  }
  if (average > comfortable) {
    return "comfortable";
  }
  if (average >= moonshot) {
    return "sweet_spot";
  }
  return "moonshot";
}

/**
 * §3.2's committed rule: a committed key result below the floor, drafted
 * there or falling there at any check-in, is a risk to escalate now or a
 * sign it should be aspirational. Never true of an aspirational one.
 */
export function belowCommittedFloor(
  confidence: number,
  kind: OkrKind,
  thresholds: ResolvedThresholds,
): boolean {
  return (
    kind === "committed" &&
    confidence < thresholds["scoring.committedConfidenceFloor"]
  );
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
  /**
   * §3.6's "once there are enough values" (§11 "Trend forecast minimum
   * values", P9-T15a). Left out, two, the fewest a line can be fitted to.
   */
  minimumValues = 2,
): Forecast | null {
  const distinct = new Set(points.map((point) => point.at));
  if (points.length < Math.max(2, minimumValues) || distinct.size < 2) {
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
