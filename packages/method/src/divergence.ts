/**
 * Divergence: where a champion's reported health disagrees with their own data
 * (AI-NATIVE-PLAN.md §6.1 item 3, §6.4's `quality.divergence`, P4-T06b-a).
 *
 * **Two cases from what §11 already carried, and a third the method named
 * later.** METHOD.md had no divergence rule when this was written, so the
 * first two read §3.7's progress signal and §3.2's confidence bands rather
 * than invent a threshold. METHOD v2 then named one in §3.5, a metric key
 * result not moved within "Divergence window" while its goal reports on
 * track, and `stalledWhileOnTrack` below is that rule (P9-T15b-b).
 *
 * **Two of §6.1's three cases, not three.** The third, "a forecast that misses
 * while the champion says caution", is not built: its wording is ambiguous (a
 * pessimistic forecast beside a cautious champion is agreement, not
 * divergence), and it rests on the §3.6 forecast, whose behaviour on sparse data
 * is an open practice decision recorded in PHASE-4-SPLIT.md. Building on a
 * number that may change would mean sending findings that later stop being
 * true. Confirmed with the human before leaving it out.
 */
import type { GoalHealth, ProgressSignal } from "./scoring.ts";
import type { ResolvedThresholds } from "./thresholds.ts";

/** Which of §6.1's cases fired. The key both carry is `quality.divergence`. */
export type DivergenceKind =
  | "progress_contradicts_health"
  | "confidence_contradicts_health"
  | "stalled_while_on_track";

export interface Divergence {
  readonly kind: DivergenceKind;
  /** High, medium or low, in the finding table's own vocabulary. */
  readonly severity: "high" | "medium" | "low";
  /** One specific sentence, as §5.3 requires of every finding. */
  readonly reason: string;
}

export interface DivergenceInput {
  /** The champion's reported health, as stored. */
  readonly health: GoalHealth;
  /** §3.7's signal from actual progress. Null when nothing is measurable yet. */
  readonly signal: ProgressSignal | null;
  /** The mean of the key results' confidence, or null while none is answered. */
  readonly averageConfidence: number | null;
}

/**
 * A status that claims things are fine. `pending` and `outdated` claim nothing:
 * one has never been reported and the other is the product's own verdict that
 * nobody has reported lately, so neither can contradict anything.
 */
const CLAIMS_FINE = (health: GoalHealth): boolean => health === "on_track";

/**
 * A status that claims trouble, which high confidence can contradict.
 *
 * `caution` and `off_track` are the two §3 statuses that say so. There is no
 * `at_risk`: the canon's word is `caution`, and this comment exists because the
 * first draft of this file invented `at_risk` and the type checker refused it.
 */
const CLAIMS_TROUBLE = (health: GoalHealth): boolean =>
  health === "caution" || health === "off_track";

/**
 * Every divergence this goal shows, or an empty list.
 *
 * Both cases are one-directional on purpose. A champion reporting `caution`
 * while the numbers look green is being careful, and telling somebody their
 * caution is wrong is how a product teaches people to report green. The reverse,
 * `on_track` while the numbers are red, is the one worth a message: it is the
 * case where nobody finds out until the end of the cycle.
 *
 * The exception is the confidence case, which fires both ways, because a set
 * scored above §11's high boundary beside a `caution` status is not care:
 * the champion and their own team have said different things, and one of them
 * has not been told.
 */
export function divergences(
  input: DivergenceInput,
  thresholds: ResolvedThresholds,
): readonly Divergence[] {
  const found: Divergence[] = [];

  // Case 1. §6.1: "a goal reported on track whose key results have not moved".
  // Read through §3.7's signal rather than through a window of days, because
  // the signal is already the answer to "have the numbers moved enough", and a
  // second definition measured in days would be a threshold nobody could see.
  if (CLAIMS_FINE(input.health) && input.signal === "red") {
    found.push({
      kind: "progress_contradicts_health",
      // High: this is the case where nobody finds out until the cycle ends.
      severity: "high",
      reason:
        "This goal is reported on track, and its own progress is in the red band. One of the two is wrong, and only the champion can say which.",
    });
  }

  // Case 2. §6.1: "a set whose average confidence contradicts its status".
  if (input.averageConfidence !== null) {
    const low = thresholds["scoring.confidenceLow"];
    const high = thresholds["scoring.confidenceHigh"];
    if (CLAIMS_FINE(input.health) && input.averageConfidence < low) {
      found.push({
        kind: "confidence_contradicts_health",
        severity: "high",
        reason:
          "This goal is reported on track, and the team's own average confidence is below the low band. The status says one thing and the people doing the work say another.",
      });
    } else if (
      CLAIMS_TROUBLE(input.health) &&
      input.averageConfidence >= high
    ) {
      found.push({
        kind: "confidence_contradicts_health",
        // Medium: nobody is being misled about progress here, but the two
        // signals still disagree and somebody has not been told.
        severity: "medium",
        reason:
          "This goal is reported as needing attention, and the team's own average confidence is in the high band. Either the risk has passed or it has not reached the people scoring it.",
      });
    }
  }

  return found;
}

/** One metric key result's movement, for §3.5's divergence window. */
export interface StalledInput {
  /** The champion's reported health, as stored. */
  readonly health: GoalHealth;
  readonly keyResultTitle: string;
  /** Only a metric key result is judged: the others move by being done. */
  readonly keyResultKind: "metric" | "maintain" | "milestone" | "baseline";
  /**
   * When its value last moved, in milliseconds, or when it was written if it
   * never has: a key result nobody has measured has not moved either.
   */
  readonly lastMovedAt: number;
  readonly now: number;
}

/**
 * METHOD.md §3.5's divergence (P9-T15b-b): "When a goal reports on track and
 * one of its metric key results has not moved within the divergence window
 * (§11), the coach says so (§10)."
 *
 * A third case beside the two above, and the one the method names. It is
 * measured in days because the method says so: four weeks of a number not
 * moving while the status says all is well is the thing nobody notices until
 * the close.
 */
export function stalledWhileOnTrack(
  input: StalledInput,
  thresholds: ResolvedThresholds,
): Divergence | null {
  if (!CLAIMS_FINE(input.health) || input.keyResultKind !== "metric") {
    return null;
  }
  const weeks = thresholds["quality.divergenceWindowWeeks"];
  if (input.now - input.lastMovedAt <= weeks * 7 * 86_400_000) {
    return null;
  }
  return {
    kind: "stalled_while_on_track",
    severity: "high",
    reason: `Reported on track, but ${input.keyResultTitle} has not moved in ${weeks} weeks. One of the two is wrong, and only the champion can say which.`,
  };
}

/**
 * The mean confidence of a set, or null when nothing has been answered.
 *
 * Null rather than zero, for the reason §4.2's KR-6 stays `todo` on an
 * unanswered key result: nobody has said they are unconfident, they have said
 * nothing, and averaging that as zero would manufacture a divergence.
 */
export function averageConfidence(
  values: readonly (number | null)[],
): number | null {
  const answered = values.filter((value): value is number => value !== null);
  if (answered.length === 0) {
    return null;
  }
  return answered.reduce((sum, value) => sum + value, 0) / answered.length;
}
