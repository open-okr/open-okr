import type { KpiBand, KpiDirection, KpiState, RecoveryLink } from "./kpi.ts";
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
  /** Which way is better, for the KPI's own key result. Higher if absent. */
  readonly direction?: KpiDirection;
  /**
   * Where the KPI is healthy again, in its own units (§6.5, P9-T18a): its
   * green boundary, or the fallback's share of the target. Null when nothing
   * says, and then the KPI's own target stands in.
   */
  readonly healthyBoundary?: number | null;
  /** The KPI's owner, who owns its key result. */
  readonly owner?: string | null;
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
  /** The KPI this came from: the unhealthy one itself, or a driver. */
  readonly sourceKpiId: string | null;
  /**
   * Whether the key result reads the KPI it came from (P9-T18a). True for the
   * first, which is the unhealthy KPI itself, so its readings move it.
   */
  readonly kpiBacked: boolean;
}

export interface RecoveryDraft {
  /** Qualitative, with no number in it, so OBJ-2 has nothing to warn about. */
  readonly objective: string;
  /** Names the KPI, and leaves the why to its owner (§6.5). */
  readonly description: string;
  /** A recovery restores a level the business already relies on (§6.5). */
  readonly kind: "committed";
  readonly keyResults: readonly RecoveryKeyResultDraft[];
}

/**
 * A number as §6.5 words it, which is how a person would write it: 12 rather
 * than 12.00, 4.5 rather than 4.50.
 */
function plain(value: number): string {
  return String(round2(value));
}

/**
 * §6.5's drafter, as METHOD v2 writes it (P9-T18a, design §8).
 *
 * - **Committed**, because it restores a level the business relies on.
 * - **A qualitative objective**, with no number in it, and the KPI named in
 *   its description. The old template, "Bring Operating margin back to 15",
 *   put a number in an objective and failed the product's own OBJ-2.
 * - **The KPI itself first**, from its reading to its healthy boundary, and
 *   reading the KPI, so it moves when the metric does. This replaced the
 *   placeholder "define the first leading driver to move", which failed KR-2.
 * - **Then the drivers**: breadth-first through the subtree, a leading child
 *   taken directly and a lagging one descended through, as before, but only a
 *   driver below its own target with an owner. A driver at or past its target
 *   would have produced a key result asking a number to go the wrong way,
 *   "Improve Sales calls per week from 120 to 100" marked increase.
 * - **The cap counts the KPI**, so the default of four is the KPI and three
 *   drivers.
 *
 * Breadth-first is still the rule: it puts a leading child of the root ahead
 * of a leading grandchild reached through a lagging one, which is the order
 * §6.3's reading rule describes.
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

  const room = Math.max(0, keyResultCap - 1);
  const drivers: RecoveryTreeNode[] = [];
  const queue = [...(childrenOf.get(tree.root.id) ?? [])];
  // A cycle in the parent pointers would otherwise loop forever. The database
  // refuses one, and this function is also called on imported data.
  const seen = new Set<string>([tree.root.id]);
  while (queue.length > 0 && drivers.length < room) {
    const node = queue.shift();
    if (!node || seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    if (node.type === "leading") {
      if (belowTarget(node) && node.owner) {
        drivers.push(node);
      }
      continue;
    }
    // Lagging: descend through it rather than measuring it. Moving a lagging
    // driver is the goal, not the work.
    queue.push(...(childrenOf.get(node.id) ?? []));
  }

  const root = tree.root;
  const boundary = root.healthyBoundary ?? root.target;
  const rootDirection = root.direction ?? "higher_better";
  return {
    objective: recoveryObjective(root.title),
    description: `Recovers ${root.title}, which reads ${plain(root.current)} against a healthy level of ${plain(boundary)}. Why it matters is for its owner to write.`,
    kind: "committed",
    keyResults: [
      {
        title: `${root.title} from ${plain(root.current)} to ${plain(boundary)}`,
        // The way back to the boundary, read from the two numbers: a range
        // KPI above its band comes down to it, whatever direction its row
        // was left with.
        direction:
          boundary < root.current
            ? "reduce"
            : boundary > root.current
              ? "increase"
              : rootDirection === "lower_better"
                ? "reduce"
                : "increase",
        baseline: root.current,
        target: boundary,
        ownerMemberId: root.owner ?? null,
        sourceKpiId: root.id,
        kpiBacked: true,
      },
      ...drivers.map((driver) => ({
        title: `Improve ${driver.title} from ${plain(driver.current)} to ${plain(driver.target)}`,
        direction:
          driver.direction === "lower_better"
            ? ("reduce" as const)
            : ("increase" as const),
        baseline: driver.current,
        target: driver.target,
        ownerMemberId: driver.owner ?? null,
        sourceKpiId: driver.id,
        kpiBacked: false,
      })),
    ],
  };
}

/**
 * §6.5's recovery objective for a KPI: qualitative, with no number in it, so
 * OBJ-2 has nothing to warn about (P9-T18a). What a model is asked to improve
 * on, and what stands when no model is used.
 */
export function recoveryObjective(kpiTitle: string): string {
  return `${kpiTitle} back where the business can rely on it`;
}

/** Short of its own target, in the direction that is better. */
function belowTarget(node: RecoveryTreeNode): boolean {
  return node.direction === "lower_better"
    ? node.current > node.target
    : node.current < node.target;
}

/**
 * §6.5: the coach proposes a recovery after this many consecutive unhealthy
 * periods, so one bad month that only slipped never generates an unsolicited
 * OKR, or at once when a KPI falls from healthy to unhealthy in one period
 * (P9-T18a). The one-click draft is available the moment a KPI turns
 * unhealthy and does not go through here.
 *
 * States arrive oldest first, so "consecutive" is the tail of the list. A gap
 * in the data resets it: `no_data` is not a bad period, it is no period.
 */
export function shouldProposeRecovery(
  periodStates: readonly KpiState[],
  delayPeriods: number,
): boolean {
  // At once on a fall from healthy to unhealthy in one period (§6.5, P9-T18a):
  // a metric that skipped watch altogether has not had one bad month, it has
  // broken, and waiting a second period would be waiting on purpose.
  const last = periodStates[periodStates.length - 1];
  const before = periodStates[periodStates.length - 2];
  if (last === "unhealthy" && before === "healthy") {
    return true;
  }
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
  /**
   * The real band, where a KPI's own thresholds decide it (§6.4, P9-T17a).
   * When given, healthy is what it says rather than what the ratio says.
   */
  readonly band?: KpiBand | null;
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
  if (input.band !== undefined) {
    return input.band === "healthy";
  }
  return (
    input.achievementPct !== null && input.achievementPct >= input.healthyPct
  );
}
