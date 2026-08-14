/**
 * Cross-frequency aggregation and the dependency cascade order (METHOD.md §6,
 * design `p3-t00-kpi-engine.md` §6 and §7, P3-T13).
 *
 * Pure. The caller loads the source records; this decides which of them belong to
 * the target period and how to fold them.
 */
import { type KpiFrequency, normalisePeriod } from "./kpi.ts";

export const KPI_AGGREGATES = ["sum", "avg", "max", "min", "count"] as const;
export type KpiAggregate = (typeof KPI_AGGREGATES)[number];

/** Coarse to fine, so two frequencies can be compared. */
const GRAIN: Readonly<Record<KpiFrequency, number>> = {
  yearly: 0,
  quarterly: 1,
  monthly: 2,
  weekly: 3,
  daily: 4,
};

export interface SourceRecord {
  readonly periodStart: string;
  readonly value: number;
}

/**
 * One value for the target period, from a source on its own frequency (design §6).
 *
 * Three cases, and the middle one is the boring one:
 *
 * - **Finer than the target**: fold every source record whose period start falls
 *   inside the target period, using the **source's own** aggregate function. A
 *   daily source summed into a month is a sum of days, not of anything else.
 * - **Equal**: the record at the same period start.
 * - **Coarser**: the record whose own period contains the target period, used
 *   as-is. A quarterly source broadcasts down into each of its months rather than
 *   being divided by three, because nobody said the quarter was evenly spread.
 *
 * An empty span yields null, **except `count`, which yields 0** (decision D-9).
 * Zero records is a real count. Zero as a sum of nothing is a fabrication.
 */
export function aggregateForPeriod(
  sourceFrequency: KpiFrequency,
  targetFrequency: KpiFrequency,
  aggregate: KpiAggregate,
  records: readonly SourceRecord[],
  targetPeriodStart: string,
): number | null {
  const sourceGrain = GRAIN[sourceFrequency];
  const targetGrain = GRAIN[targetFrequency];

  if (sourceGrain === targetGrain) {
    const match = records.find(
      (record) => record.periodStart === targetPeriodStart,
    );
    return match ? match.value : aggregate === "count" ? 0 : null;
  }

  if (sourceGrain < targetGrain) {
    // Coarser source. Its own period contains the target period exactly when
    // normalising the target date to the source's frequency lands on it.
    const covering = normalisePeriod(sourceFrequency, targetPeriodStart);
    const match = records.find((record) => record.periodStart === covering);
    return match ? match.value : aggregate === "count" ? 0 : null;
  }

  // Finer source. A source record belongs to the target period exactly when
  // normalising its own start to the target frequency lands on the target.
  const inside = records.filter(
    (record) =>
      normalisePeriod(targetFrequency, record.periodStart) ===
      targetPeriodStart,
  );
  return fold(
    aggregate,
    inside.map((record) => record.value),
  );
}

function fold(
  aggregate: KpiAggregate,
  values: readonly number[],
): number | null {
  if (aggregate === "count") {
    return values.length;
  }
  if (values.length === 0) {
    return null;
  }
  switch (aggregate) {
    case "sum":
      return values.reduce((total, value) => total + value, 0);
    case "avg":
      return (
        Math.round(
          (values.reduce((total, value) => total + value, 0) / values.length) *
            100,
        ) / 100
      );
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
  }
}

export interface DependencyEdge {
  /** The calculated KPI. */
  readonly dependent: string;
  /** The KPI its formula references. */
  readonly dependsOn: string;
}

export interface CascadeResult {
  /** Every KPI to recompute, each exactly once, in topological order. */
  readonly order: readonly string[];
  /** True when the graph contains a cycle, including a self-reference. */
  readonly rejected: boolean;
}

/**
 * What to recompute after one KPI's value changed, and in what order (design §7).
 *
 * **Topological, each exactly once.** A diamond recomputes the shared dependent
 * after both branches, not twice and not before one of them: recomputing it early
 * would fold a stale branch into the answer, and recomputing it twice would write
 * the same row twice for no reader's benefit.
 *
 * A cycle, including a self-reference, is refused rather than broken. The write
 * path calls this before inserting an edge, so a cycle never reaches the table:
 * the alternative is a graph that has to be defended against on every read
 * forever.
 */
export function cascadeOrder(
  edges: readonly DependencyEdge[],
  changed: string,
): CascadeResult {
  if (edges.some((edge) => edge.dependent === edge.dependsOn)) {
    return { order: [], rejected: true };
  }

  const dependentsOf = new Map<string, string[]>();
  const dependsOn = new Map<string, Set<string>>();
  const nodes = new Set<string>();
  for (const edge of edges) {
    nodes.add(edge.dependent);
    nodes.add(edge.dependsOn);
    const list = dependentsOf.get(edge.dependsOn);
    if (list) {
      list.push(edge.dependent);
    } else {
      dependentsOf.set(edge.dependsOn, [edge.dependent]);
    }
    const sources = dependsOn.get(edge.dependent);
    if (sources) {
      sources.add(edge.dependsOn);
    } else {
      dependsOn.set(edge.dependent, new Set([edge.dependsOn]));
    }
  }

  if (hasCycle(nodes, dependentsOf)) {
    return { order: [], rejected: true };
  }

  // Everything downstream of the change, whether or not it is reachable in one
  // hop. A chain of three recomputes both links.
  const affected = new Set<string>();
  const queue = [...(dependentsOf.get(changed) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || affected.has(next)) {
      continue;
    }
    affected.add(next);
    queue.push(...(dependentsOf.get(next) ?? []));
  }

  // Kahn over the affected subgraph, counting only the sources that are
  // themselves affected: a dependent whose other source did not change is still
  // ready, because that source's value is already current.
  const remaining = new Map<string, number>();
  for (const node of affected) {
    let waiting = 0;
    for (const source of dependsOn.get(node) ?? []) {
      if (affected.has(source)) {
        waiting += 1;
      }
    }
    remaining.set(node, waiting);
  }

  const ready = [...affected]
    .filter((node) => remaining.get(node) === 0)
    .sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const node = ready.shift() as string;
    order.push(node);
    for (const dependent of dependentsOf.get(node) ?? []) {
      if (!affected.has(dependent)) {
        continue;
      }
      const left = (remaining.get(dependent) ?? 0) - 1;
      remaining.set(dependent, left);
      if (left === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  return { order, rejected: false };
}

/** A three-colour walk, the same shape the scoring cascade uses (P3-T05). */
function hasCycle(
  nodes: ReadonlySet<string>,
  dependentsOf: ReadonlyMap<string, string[]>,
): boolean {
  const state = new Map<string, 0 | 1 | 2>();
  for (const node of nodes) {
    state.set(node, 0);
  }
  const stack: { node: string; index: number }[] = [];

  for (const root of nodes) {
    if (state.get(root) !== 0) {
      continue;
    }
    stack.push({ node: root, index: 0 });
    state.set(root, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame) {
        break;
      }
      const children = dependentsOf.get(frame.node) ?? [];
      if (frame.index >= children.length) {
        state.set(frame.node, 2);
        stack.pop();
        continue;
      }
      const child = children[frame.index] as string;
      frame.index += 1;
      const colour = state.get(child) ?? 0;
      if (colour === 1) {
        return true;
      }
      if (colour === 0) {
        state.set(child, 1);
        stack.push({ node: child, index: 0 });
      }
    }
  }
  return false;
}
