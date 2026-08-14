import type { KpiDirection, KpiState, RecoveryLink } from "./kpi.ts";
import { round2 } from "./scoring.ts";

/**
 * METHOD.md §6.5, the recovery half of the KPI rules: how a recovering KPI
 * reports its health, how the recovery objective is drafted off the driver
 * tree, and when the coach may propose one or propose closing it.
 *
 * Pure, like everything else here. The walk is handed a tree that somebody else
 * loaded, the thresholds arrive as arguments, and nothing in this file knows
 * what a database is.
 */

/** §6.5's projection can only misbehave one way, and it is worth naming. */
export type RecoveryDiagnostic = "recovery_start_above_healthy";

export interface EffectiveHealthInput {
  /** Real achievement. Null while the KPI has no values at all. */
  readonly achievementPct: number | null;
  /** `recovery_started_pct`, the achievement stamped when recovery launched. */
  readonly startPct: number;
  /** The recovery goal's progress, 0 to 1. */
  readonly recoveryProgress: number;
  /** The KPI's own healthy threshold, §11 `kpi.healthyThreshold` by default. */
  readonly healthyPct: number;
}

export interface EffectiveHealth {
  readonly pct: number;
  readonly diagnostic: RecoveryDiagnostic | null;
}

/**
 * §6.5: the displayed health is the higher of real achievement and a
 * projection, so a recovery is visible before the lagging number catches up
 * (design §4).
 *
 * The `max(0, …)` guard covers one degenerate input. A recovery launches only
 * from an unhealthy KPI, so the start is always below the healthy threshold in
 * practice. A KPI linked to a recovery goal by hand while already healthy would
 * otherwise produce a projection that *falls* as the recovery progresses, which
 * is why that case is reported rather than silently smoothed.
 */
export function kpiEffectiveHealth(
  input: EffectiveHealthInput,
): EffectiveHealth {
  const headroom = input.healthyPct - input.startPct;
  const projection =
    input.startPct + input.recoveryProgress * Math.max(0, headroom);
  const effective = Math.max(input.achievementPct ?? 0, projection);
  return {
    pct: round2(effective),
    diagnostic: headroom < 0 ? "recovery_start_above_healthy" : null,
  };
}

export interface RecoveryTreeRoot {
  readonly id: string;
  readonly title: string;
  readonly target: number;
  readonly current: number;
}

export interface RecoveryTreeNode {
  readonly id: string;
  /** The parent's id. The root's own id for a first-level driver. */
  readonly parent: string;
  readonly type: "leading" | "lagging";
  readonly title: string;
  readonly direction: KpiDirection;
  readonly current: number;
  readonly target: number;
  /** The driver's owner, inherited by the key result. */
  readonly owner?: string | null;
  readonly position: number;
}

export interface RecoveryTreeInput {
  readonly root: RecoveryTreeRoot;
  readonly nodes: readonly RecoveryTreeNode[];
}

export interface RecoveryKeyResultDraft {
  readonly title: string;
  /** The key result's own direction, not the KPI's wording. */
  readonly direction: "increase" | "reduce";
  readonly baseline: number;
  readonly target: number;
  readonly ownerMemberId: string | null;
  /** The driver this came from, or null for the placeholder. */
  readonly sourceKpiId: string | null;
}

export interface RecoveryDraft {
  readonly objective: string;
  readonly keyResults: readonly RecoveryKeyResultDraft[];
}

/**
 * A number as §6.5 words it, which is how a person would write it: 12 rather
 * than 12.00, 4.5 rather than 4.50.
 */
function plain(value: number): string {
  return String(round2(value));
}

export const RECOVERY_PLACEHOLDER_TITLE =
  "define the first leading driver to move";

/**
 * §6.5's drafter (design §8). Breadth-first through the unhealthy KPI's
 * subtree: a leading child becomes a key result, a lagging child is descended
 * through until its nearest leading descendants are reached, and the walk stops
 * at the cap.
 *
 * Breadth-first is the rule and not an implementation detail. It is what puts a
 * leading child of the root ahead of a leading grandchild reached through a
 * lagging one, which is the order §6.3's reading rule describes: the drivers at
 * the edge of the unhealthy branch, nearest first.
 *
 * No health filter, per decision D-8. §6.5 describes the walk by indicator
 * type and never by state, and a healthy leading driver is often exactly the
 * one to push harder.
 */
export function draftRecovery(
  tree: RecoveryTreeInput,
  keyResultCap: number,
): RecoveryDraft {
  const childrenOf = new Map<string, RecoveryTreeNode[]>();
  for (const node of tree.nodes) {
    const siblings = childrenOf.get(node.parent);
    if (siblings) {
      siblings.push(node);
    } else {
      childrenOf.set(node.parent, [node]);
    }
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) =>
      a.position === b.position
        ? a.id.localeCompare(b.id)
        : a.position - b.position,
    );
  }

  const drivers: RecoveryTreeNode[] = [];
  const queue = [...(childrenOf.get(tree.root.id) ?? [])];
  // A cycle in the parent pointers would otherwise loop forever. The database
  // refuses one, and this function is also called on imported data.
  const seen = new Set<string>([tree.root.id]);
  while (queue.length > 0 && drivers.length < keyResultCap) {
    const node = queue.shift();
    if (!node || seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    if (node.type === "leading") {
      drivers.push(node);
      continue;
    }
    // Lagging: descend through it rather than measuring it. Moving a lagging
    // driver is the goal, not the work.
    queue.push(...(childrenOf.get(node.id) ?? []));
  }

  const objective = `Bring ${tree.root.title} back to ${plain(tree.root.target)}`;

  if (drivers.length === 0) {
    // §6.5: a subtree with no leading KPI anywhere gets one placeholder, so the
    // recovery still exists and names the missing decision instead of pretending
    // the tree answered it.
    return {
      objective,
      keyResults: [
        {
          title: RECOVERY_PLACEHOLDER_TITLE,
          direction: "increase",
          baseline: 0,
          target: 1,
          ownerMemberId: null,
          sourceKpiId: null,
        },
      ],
    };
  }

  return {
    objective,
    keyResults: drivers.map((driver) => ({
      title: `Improve ${driver.title} from ${plain(driver.current)} to ${plain(driver.target)}`,
      direction: driver.direction === "lower_better" ? "reduce" : "increase",
      baseline: driver.current,
      target: driver.target,
      ownerMemberId: driver.owner ?? null,
      sourceKpiId: driver.id,
    })),
  };
}

/**
 * §6.5: the coach proposes a recovery only after this many consecutive
 * unhealthy periods, so one bad month never generates an unsolicited OKR
 * (design §9). The one-click draft is available the moment a KPI turns
 * unhealthy and does not go through here.
 *
 * States arrive oldest first, so "consecutive" is the tail of the list. A gap
 * in the data resets it: `no_data` is not a bad period, it is no period.
 */
export function shouldProposeRecovery(
  periodStates: readonly KpiState[],
  delayPeriods: number,
): boolean {
  if (delayPeriods < 1 || periodStates.length < delayPeriods) {
    return false;
  }
  return periodStates
    .slice(-delayPeriods)
    .every((state) => state === "unhealthy");
}

export interface RecoveryCloseInput {
  /** **Real** achievement, never the effective figure. */
  readonly achievementPct: number | null;
  readonly recovery: RecoveryLink;
  readonly alreadyProposed: boolean;
  readonly healthyPct: number;
}

/**
 * §6.5's other end: when real achievement re-enters the healthy corridor, the
 * coach proposes closing the recovery goal, exactly once (design §9).
 *
 * Real and not effective, and that is the whole point. Effective health rises
 * with the recovery's own progress, so closing on it would close a recovery
 * because the recovery was going well, which is circular.
 */
export function shouldProposeRecoveryClose(input: RecoveryCloseInput): boolean {
  if (input.recovery !== "open" || input.alreadyProposed) {
    return false;
  }
  return (
    input.achievementPct !== null && input.achievementPct >= input.healthyPct
  );
}
