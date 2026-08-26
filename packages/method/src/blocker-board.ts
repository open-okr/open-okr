/**
 * Open blockers, ranked (METHOD.md §7.3 and §11, P4-T15b-b).
 *
 * **§7.3 defines the taxonomy and the clock, and states no ranking.** It says
 * every blocker carries an opened time, an owner, a next action and a 24-hour
 * clock, and that "a blocker that ages past it is escalated, not re-discussed".
 * IMPLEMENTATION-PLAN asks for a board "ranked by age and impact", so the order
 * below is derived rather than quoted, and it is derived from canon rather than
 * invented:
 *
 * 1. **How far up §11's ladder it has climbed.** The ladder is the product's own
 *    statement of urgency: owner at twenty hours, coordinator at twenty-four,
 *    sponsor at forty-eight. A blocker the sponsor has been told about outranks
 *    one nobody has been warned about, whatever their ages.
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

/** §11's ladder, as the board reads it. */
export interface BlockerLadderHours {
  readonly owner: number;
  readonly coordinator: number;
  readonly sponsor: number;
}

/** How far up §11's ladder a blocker has climbed. */
export type BlockerEscalation = "none" | "owner" | "coordinator" | "sponsor";

export interface RankableBlocker {
  readonly id: string;
  /** One of §7.3's five. */
  readonly type: string;
  readonly nextAction: string;
  readonly ownerName: string | null;
  readonly ageHours: number;
  /** §3.2's band for the goal or key result it blocks, or null when unlinked. */
  readonly blockedHealth: string | null;
  /** What it blocks, for the reader. Null when it names nothing. */
  readonly blockedTitle: string | null;
}

export interface RankedBlocker extends RankableBlocker {
  readonly escalation: BlockerEscalation;
  /** True once past §7.3's clock, which is the coordinator step. */
  readonly pastTheClock: boolean;
}

const ESCALATION_RANK: Readonly<Record<BlockerEscalation, number>> = {
  sponsor: 3,
  coordinator: 2,
  owner: 1,
  none: 0,
};

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
 * Which rung a blocker has reached.
 *
 * At the hour, not past it: §11's own wording is "owner warned at twenty hours",
 * and a ladder that fired at twenty and one would warn nobody at twenty.
 */
export function escalationFor(
  ageHours: number,
  ladder: BlockerLadderHours,
): BlockerEscalation {
  if (ageHours >= ladder.sponsor) {
    return "sponsor";
  }
  if (ageHours >= ladder.coordinator) {
    return "coordinator";
  }
  if (ageHours >= ladder.owner) {
    return "owner";
  }
  return "none";
}

/**
 * The board, in order.
 *
 * Stable: two blockers alike on all three keys keep the order they arrived in,
 * so a board does not shuffle between reads and a reader can point at "the third
 * one" and be understood.
 */
export function rankBlockers(
  blockers: readonly RankableBlocker[],
  ladder: BlockerLadderHours,
  clockHours: number,
): readonly RankedBlocker[] {
  return blockers
    .map((blocker, index) => ({
      blocker,
      index,
      escalation: escalationFor(blocker.ageHours, ladder),
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
    .map(({ blocker, escalation }) => ({
      ...blocker,
      escalation,
      pastTheClock: blocker.ageHours >= clockHours,
    }));
}
