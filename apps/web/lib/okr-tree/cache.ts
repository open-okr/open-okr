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

/**
 * The drawer's read of one objective (P9-T08a), keyed by its key results too,
 * so adding one reads the history again without anybody asking.
 */
export function okrDetailKey(
  goalId: string,
  keyResultIds: readonly string[],
): readonly ["okr-detail", string, string] {
  return ["okr-detail", goalId, keyResultIds.join(",")];
}

/** Every drawer read, for invalidation after any write. */
export const OKR_DETAIL_ALL = ["okr-detail"] as const;

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

/** Puts `id` after `afterId` in a list, or first; as the server does. */
function placed<T extends { readonly id: string }>(
  rows: readonly T[],
  id: string,
  afterId: string | null,
): T[] {
  const moving = rows.find((row) => row.id === id);
  if (!moving) {
    return [...rows];
  }
  const rest = rows.filter((row) => row.id !== id);
  const at =
    afterId === null ? -1 : rest.findIndex((row) => row.id === afterId);
  return [...rest.slice(0, at + 1), moving, ...rest.slice(at + 1)];
}

/** An objective moved in its cycle's order (P9-T07b-b). */
export function placeGoalIn(
  tree: OkrTree,
  id: string,
  afterId: string | null,
): OkrTree {
  return { ...tree, goals: placed(tree.goals, id, afterId) };
}

/** A key result moved in its objective's order. */
export function placeKeyResultIn(
  tree: OkrTree,
  id: string,
  afterId: string | null,
): OkrTree {
  return {
    ...tree,
    goals: tree.goals.map((goal) =>
      goal.keyResults.some((row) => row.id === id)
        ? { ...goal, keyResults: placed(goal.keyResults, id, afterId) }
        : goal,
    ),
  };
}

/** An objective promised as the other kind (METHOD.md §2.8, P9-T11b-a). */
export function kindIn(
  tree: OkrTree,
  goalId: string,
  kind: OkrGoal["kind"],
): OkrTree {
  return onGoal(tree, goalId, (goal) => ({ ...goal, kind }));
}

/** An objective taken off the list, for the moment before the server agrees. */
export function withoutGoal(tree: OkrTree, id: string): OkrTree {
  return { ...tree, goals: tree.goals.filter((goal) => goal.id !== id) };
}

/**
 * The server's own node for an objective, over whatever the cache guessed.
 * Its progress, health and verdicts are the recomputed ones, which is the
 * point of merging it rather than keeping the optimistic copy.
 */
/**
 * An objective hung under another parent (P9-T10b): an objective, one of its
 * key results, or nothing. One pointer at most, as the server keeps it, so
 * setting either clears the other.
 */
export function reparentIn(
  tree: OkrTree,
  goalId: string,
  parent: {
    readonly parentGoalId: string | null;
    readonly parentKeyResultId: string | null;
  },
): OkrTree {
  return onGoal(tree, goalId, (goal) => ({
    ...goal,
    parentGoalId: parent.parentKeyResultId ? null : parent.parentGoalId,
    parentKeyResultId: parent.parentKeyResultId,
  }));
}

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
  /** Committed or aspirational objectives only (P9-T11b-a). */
  readonly kind?: OkrGoal["kind"] | undefined;
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
      (filters.kind === undefined || goal.kind === filters.kind) &&
      (mySpaces === null ||
        (goal.spaceId !== null && mySpaces.has(goal.spaceId))),
  );
}
