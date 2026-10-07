/**
 * Open blockers, ranked (METHOD.md §7.3 and §11, P4-T15b-b, P9-T19a-a).
 *
 * **§7.3 defines the taxonomy and the clock, and states no ranking.** It says
 * every blocker carries an opened time, an owner and a next action due by the
 * next check-in, and that one whose action passes that point is escalated to
 * the coordinator, not re-discussed. IMPLEMENTATION-PLAN asks for a board
 * "ranked by age and impact", so the order below is derived rather than
 * quoted, and it is derived from canon rather than invented:
 *
 * 1. **How far up §11's ladder it has climbed.** The ladder is the product's own
 *    statement of urgency: the owner reminded the day before the check-in, the
 *    coordinator once it has passed, the sponsor where the workspace adds
 *    them. A blocker the coordinator has been told about outranks one nobody
 *    has been reminded of, whatever their ages.
 * 2. **The health of what it blocks**, from §3.2's bands. Off track outranks
 *    caution, which outranks everything else. That is "impact" in the only terms
 *    this product measures it in.
 * 3. **Age**, oldest first. The tie-break, and the thing §7.3 does name.
 *
 * The order is here, pure, so the board, the summary assist and any future digest
 * all rank the same way. **The assist may describe this order and may not change
 * it**: a model reordering a queue by how interesting each item reads is exactly
 * the failure this separation prevents.
 */
import { type BlockerClock, blockerEscalation } from "./escalation.ts";
import type { ResolvedThresholds } from "./thresholds.ts";

/** How far up §11's ladder a blocker has climbed. */
export type BlockerEscalation = "none" | "owner" | "coordinator" | "sponsor";

export interface RankableBlocker {
  readonly id: string;
  /** One of §7.3's types. */
  readonly type: string;
  readonly nextAction: string;
  readonly ownerName: string | null;
  readonly ageHours: number;
  /** Where it stands against the check-in its action is due by. */
  readonly clock: BlockerClock;
  /** §3.2's band for the goal or key result it blocks, or null when unlinked. */
  readonly blockedHealth: string | null;
  /** What it blocks, for the reader. Null when it names nothing. */
  readonly blockedTitle: string | null;
}

export interface RankedBlocker extends Omit<RankableBlocker, "clock"> {
  readonly escalation: BlockerEscalation;
  /** True once its check-in has passed with the action open. */
  readonly pastTheClock: boolean;
}

const ESCALATION_RANK: Readonly<Record<BlockerEscalation, number>> = {
  sponsor: 3,
  coordinator: 2,
  owner: 1,
  none: 0,
};

const RUNG: Readonly<Record<number, BlockerEscalation>> = {
  1: "owner",
  2: "coordinator",
  3: "sponsor",
};

/** Which rung a blocker has reached, by the same ladder the nudges climb. */
export function escalationFor(
  clock: BlockerClock,
  thresholds: ResolvedThresholds,
  sponsorInLadders: boolean,
): BlockerEscalation {
  const step = blockerEscalation(clock, thresholds, sponsorInLadders).step;
  return step === null ? "none" : (RUNG[step] ?? "none");
}

/** Off track first, then caution, then everything else including unlinked. */
const HEALTH_RANK = (health: string | null): number => {
  if (health === "off_track") {
    return 2;
  }
  if (health === "caution") {
    return 1;
  }
  return 0;
};

/**
 * The board, in order.
 *
 * Stable: two blockers alike on all three keys keep the order they arrived in,
 * so a board does not shuffle between reads and a reader can point at "the third
 * one" and be understood.
 */
export function rankBlockers(
  blockers: readonly RankableBlocker[],
  thresholds: ResolvedThresholds,
  sponsorInLadders: boolean,
): readonly RankedBlocker[] {
  return blockers
    .map((blocker, index) => ({
      blocker,
      index,
      escalation: escalationFor(blocker.clock, thresholds, sponsorInLadders),
    }))
    .sort((left, right) => {
      const byLadder =
        ESCALATION_RANK[right.escalation] - ESCALATION_RANK[left.escalation];
      if (byLadder !== 0) {
        return byLadder;
      }
      const byHealth =
        HEALTH_RANK(right.blocker.blockedHealth) -
        HEALTH_RANK(left.blocker.blockedHealth);
      if (byHealth !== 0) {
        return byHealth;
      }
      const byAge = right.blocker.ageHours - left.blocker.ageHours;
      return byAge !== 0 ? byAge : left.index - right.index;
    })
    .map(({ blocker: { clock, ...blocker }, escalation }) => ({
      ...blocker,
      escalation,
      pastTheClock: clock.daysUntilDue < 0,
    }));
}
