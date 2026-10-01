/**
 * What counts as a key result's linked work (TECHNICAL-PLAN §4.9, completeness
 * review M-26).
 *
 * **Linked work is tasks, reached two ways.** A task names a key result itself,
 * or it belongs to an initiative that serves the key result. REQUIREMENTS §4
 * Pillar C says an initiative's progress feeds the key result's linked-work
 * view, and an initiative's progress is the share of its own tasks that are
 * done, so its tasks are how that progress arrives. Counting tasks rather than
 * averaging initiative percentages keeps one unit on both sides of the
 * fraction, and it makes double counting impossible to miss: a task is one task
 * however many routes reach it.
 *
 * **Here rather than in `packages/method`.** METHOD.md says nothing about linked
 * work. What the method package holds is the divergence the count feeds,
 * `linkedWorkDivergence`, which cites a rule the trigger catalogue defines.
 * Which rows make up the count is a question about this product's data, so it
 * sits beside the query that loads them. Pure all the same, so it is tested
 * without a database.
 */
import type { LinkedWork } from "@openokr/method";

/** One task, as the count needs to see it. */
export interface LinkedWorkTask {
  readonly id: string;
  readonly done: boolean;
  /** The key result the task names itself, if any. */
  readonly keyResultId: string | null;
  /** The initiative the task is part of, if any. */
  readonly initiativeId: string | null;
}

/** One initiative serving one key result. */
interface LinkedWorkInitiative {
  readonly initiativeId: string;
  readonly keyResultId: string;
  /** A `dropped` initiative is work the team decided not to do. */
  readonly dropped: boolean;
}

interface CountLinkedWorkInput {
  /** Every key result being asked about. Each gets an entry, even at zero. */
  readonly keyResultIds: readonly string[];
  readonly tasks: readonly LinkedWorkTask[];
  readonly initiatives: readonly LinkedWorkInitiative[];
}

/**
 * Linked work per key result, with each task counted once.
 *
 * A task counts for a key result when it names that key result, or when its
 * initiative serves it. Both routes can reach the same task, and the same row
 * can arrive twice from a query that asked both ways, so each key result keeps
 * a set of task identifiers rather than a running total.
 *
 * **A dropped initiative contributes nothing.** Its open tasks are work nobody
 * is going to finish, and counting them would hold the key result below
 * complete for good, which is the one state in which the divergence can never
 * speak. A task in a dropped initiative that names the key result itself still
 * counts, through its own link.
 */
export function countLinkedWork(
  input: CountLinkedWorkInput,
): Map<string, LinkedWork> {
  const asked = new Set(input.keyResultIds);

  // Initiative to the key results it serves, among the ones asked about.
  const served = new Map<string, Set<string>>();
  for (const link of input.initiatives) {
    if (link.dropped || !asked.has(link.keyResultId)) {
      continue;
    }
    const set = served.get(link.initiativeId) ?? new Set<string>();
    set.add(link.keyResultId);
    served.set(link.initiativeId, set);
  }

  // Key result to the tasks that reached it, keyed by task so a second route
  // or a second copy of the row replaces rather than adds.
  const reached = new Map<string, Map<string, boolean>>();
  for (const keyResultId of asked) {
    reached.set(keyResultId, new Map());
  }
  for (const task of input.tasks) {
    const targets = new Set<string>();
    if (task.keyResultId !== null && asked.has(task.keyResultId)) {
      targets.add(task.keyResultId);
    }
    if (task.initiativeId !== null) {
      for (const keyResultId of served.get(task.initiativeId) ?? []) {
        targets.add(keyResultId);
      }
    }
    for (const keyResultId of targets) {
      reached.get(keyResultId)?.set(task.id, task.done);
    }
  }

  const counts = new Map<string, LinkedWork>();
  for (const [keyResultId, found] of reached) {
    let done = 0;
    for (const finished of found.values()) {
      if (finished) {
        done += 1;
      }
    }
    counts.set(keyResultId, { done, total: found.size });
  }
  return counts;
}
