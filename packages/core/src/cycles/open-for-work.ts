/**
 * The cycles new work may be tied to, in the order a person looks for them
 * (plan 0.8.0 I1, Akmal's answer to I1-Q1; plan 0.8.1 A1).
 *
 * **One rule for every place that offers a key result to tie work to.** The
 * screens' pickers (`apps/web/lib/linkable-key-results.ts`) and the copilot's
 * initiative and task proposals both read it, so the copilot never refuses a
 * key result the screen offers, and the screen never offers one the copilot
 * cannot propose behind.
 *
 * Every cycle being planned or running, quarterly and annual. A closing or
 * closed cycle is left out: its numbers are being reviewed or are final, and
 * new work does not move them.
 */

interface WorkCycle {
  readonly status: string;
  readonly mode: string;
  /** ISO date. The nearer period first when two rank the same. */
  readonly startsOn?: string;
}

/** Whether new work may be tied to this cycle's key results. */
export function openForWork(cycle: WorkCycle): boolean {
  return cycle.status === "planning" || cycle.status === "active";
}

/**
 * The running quarter first, where most work is tied, then the running year,
 * then cycles being planned. `cycles.list` is newest first, which put next
 * quarter's key results at the top of every picker while it was planned.
 */
function rank(cycle: WorkCycle): number {
  return (
    (cycle.status === "active" ? 0 : 2) + (cycle.mode === "quarterly" ? 0 : 1)
  );
}

/**
 * The cycles open for work, running quarter first.
 *
 * **Two that rank the same go nearest first** (plan 0.8.1 A1). A quarter that
 * has not been started yet is `planning`, as next quarter is, and newest-first
 * put next quarter above this one in every picker until somebody pressed
 * start. Found by the copilot's own test.
 */
export function cyclesOpenForWork<C extends WorkCycle>(
  cycles: readonly C[],
): C[] {
  return cycles
    .filter(openForWork)
    .sort(
      (one, other) =>
        rank(one) - rank(other) ||
        (one.startsOn ?? "").localeCompare(other.startsOn ?? ""),
    );
}
