/**
 * The OKR tree in the client cache, and the changes made to it before the
 * server answers (P9-T06c, docs/design/p9-t00-okr-writing.md §6).
 *
 * Pure: every function takes a tree and returns a new one, so the hook can
 * keep the tree it had and put it back when the server refuses. Shared with
 * the server page, which filters the same way for its first render, so the
 * first paint and the cache cannot disagree about what a filter keeps.
 */
import type { callAction } from "@openokr/core";

export type OkrTree = Awaited<ReturnType<typeof callAction<"goals.tree">>>;
export type OkrGoal = OkrTree["goals"][number];
export type OkrScope = "all" | "mine";

/** One entry per cycle and scope; the list and the diagram share it. */
export function okrTreeKey(
  cycleId: string,
  scope: OkrScope,
): readonly ["okr-tree", string, OkrScope] {
  return ["okr-tree", cycleId, scope];
}

/** Every entry for one cycle, whichever scope, for invalidation. */
export function okrCycleKey(cycleId: string): readonly ["okr-tree", string] {
  return ["okr-tree", cycleId];
}

export interface GoalFields {
  readonly title?: string;
  readonly contributionStatement?: string | null;
  readonly weight?: number;
  /**
   * Sent to the server; the cache shows the new champion's name only once the
   * server's node arrives, because it holds ids and not the directory.
   */
  readonly championId?: string;
}

export interface KeyResultFields {
  readonly title?: string;
  readonly unit?: string | null;
  readonly baselineValue?: number;
  readonly dueOn?: string | null;
  /** As `championId` above: the name follows with the server's node. */
  readonly ownerId?: string | null;
  readonly weight?: number;
  readonly currentValue?: number;
  readonly targetValue?: number;
}

function onGoal(
  tree: OkrTree,
  goalId: string,
  change: (goal: OkrGoal) => OkrGoal,
): OkrTree {
  return {
    ...tree,
    goals: tree.goals.map((goal) => (goal.id === goalId ? change(goal) : goal)),
  };
}

/** An objective's fields, as the reader typed them. */
export function patchGoalIn(
  tree: OkrTree,
  goalId: string,
  set: GoalFields,
): OkrTree {
  return onGoal(tree, goalId, (goal) => ({ ...goal, ...set }));
}

/**
 * A key result's fields, as the reader typed them. Progress is left as it was:
 * the server recomputes it, and a guess drawn here would flicker when the
 * real figure arrives.
 */
export function patchKeyResultIn(
  tree: OkrTree,
  keyResultId: string,
  set: KeyResultFields,
): OkrTree {
  return {
    ...tree,
    goals: tree.goals.map((goal) =>
      goal.keyResults.some((row) => row.id === keyResultId)
        ? {
            ...goal,
            keyResults: goal.keyResults.map((row) =>
              row.id === keyResultId ? { ...row, ...set } : row,
            ),
          }
        : goal,
    ),
  };
}

/** A key result taken off its objective, for the moment before the server agrees. */
export function withoutKeyResult(tree: OkrTree, keyResultId: string): OkrTree {
  return {
    ...tree,
    goals: tree.goals.map((goal) => ({
      ...goal,
      keyResults: goal.keyResults.filter((row) => row.id !== keyResultId),
    })),
  };
}

/**
 * The server's own node for an objective, over whatever the cache guessed.
 * Its progress, health and verdicts are the recomputed ones, which is the
 * point of merging it rather than keeping the optimistic copy.
 */
export function mergeGoal(tree: OkrTree, node: OkrGoal): OkrTree {
  return tree.goals.some((goal) => goal.id === node.id)
    ? onGoal(tree, node.id, () => node)
    : { ...tree, goals: [...tree.goals, node] };
}

export interface OkrFilters {
  readonly level?: string | undefined;
  readonly health?: string | undefined;
  readonly includeClosed: boolean;
  /** One champion's objectives (P9-T07a-b). */
  readonly championId?: string | undefined;
  /** One space's objectives. */
  readonly spaceId?: string | undefined;
  /** "My team": the objectives of the spaces the reader belongs to. */
  readonly spaceIds?: readonly string[] | undefined;
}

/** What a filter keeps, the same on the server's first render and in the cache. */
export function filterGoals(
  goals: readonly OkrGoal[],
  filters: OkrFilters,
): OkrGoal[] {
  const mySpaces =
    filters.spaceIds === undefined ? null : new Set(filters.spaceIds);
  return goals.filter(
    (goal) =>
      (filters.includeClosed || goal.closedAt === null) &&
      (filters.level === undefined || goal.level === filters.level) &&
      (filters.health === undefined || goal.health === filters.health) &&
      (filters.championId === undefined ||
        goal.champion.id === filters.championId) &&
      (filters.spaceId === undefined || goal.spaceId === filters.spaceId) &&
      (mySpaces === null ||
        (goal.spaceId !== null && mySpaces.has(goal.spaceId))),
  );
}
