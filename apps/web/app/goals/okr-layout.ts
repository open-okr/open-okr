import type { OkrGoal, OkrTree } from "../../lib/okr-tree/cache.ts";

/**
 * Where everything on the OKR diagram goes (P9-T09a,
 * docs/design/p9-t00-okr-writing.md §5.2).
 *
 * Pure: a tree and what is collapsed in, boxes and lines out, so the layout
 * is tested on its own and the canvas only draws it.
 *
 * **A tidy tree, not a graph layout.** Alignment gives every objective one
 * parent (an objective, a key result of one, or nothing), so what is drawn
 * is a forest: the cycle, with every parent from outside it as a root of its
 * own in the band above. A forest laid out depth first in the list's own
 * order puts siblings exactly where the list does and cannot cross an edge,
 * which is what §5.2 asks of the layout. A general graph layout reorders
 * siblings to reduce crossings and then has to be put back; decision D1
 * approved dagre for that, and it turned out not to be needed.
 *
 * Every box is positioned by its top left corner, which is what the canvas
 * takes. Objectives are one width; a row is as tall as its tallest card.
 */

const OBJECTIVE_WIDTH = 264;
const CONTEXT_WIDTH = 240;
const CYCLE_WIDTH = 220;
const CYCLE_HEIGHT = 52;
/** Title, the line under it and the progress bar. */
const CARD_HEAD = 92;
const KEY_RESULT_ROW = 30;
const CARD_FOOT = 10;
/** "+ KR" and "+ aligned" on an open card, for a reader who may add (P9-T10a). */
const CARD_ACTIONS = 34;
/** A new objective's card before its title is saved. */
const DRAFT_HEIGHT = 72;
const CONTEXT_HEAD = 56;
const CONTEXT_ROW = 22;
const GAP_X = 28;
const ROOT_GAP_X = 56;
const GAP_Y = 64;

/**
 * Past this many objectives the diagram opens collapsed below company level
 * (design §7), so the first paint is the company's shape rather than every
 * card at once.
 */
export const COLLAPSE_PAST = 150;

type ContextGoal = OkrTree["context"][number];

interface Box {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type DiagramNode =
  | (Box & { readonly kind: "cycle"; readonly name: string })
  | (Box & {
      readonly kind: "context";
      readonly context: ContextGoal;
    })
  | (Box & {
      readonly kind: "objective";
      readonly goal: OkrGoal;
      readonly collapsed: boolean;
      /** Objectives aligned below it that a collapse is hiding. */
      readonly hiddenBelow: number;
      /** A key result draft row is open at the foot of its stack. */
      readonly drafting: boolean;
    })
  | (Box & {
      /** An aligned objective being added under `parentId` (P9-T10a). */
      readonly kind: "draft";
      readonly parentId: string;
    });

interface DiagramEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  /** The key result row an objective hangs from, when it aligns to one. */
  readonly sourceHandle: string | null;
  readonly kind: "alignment" | "dependency";
}

export interface DiagramLayout {
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  /** For the keyboard: the node above each one, and those below it. */
  readonly parentOf: ReadonlyMap<string, string>;
  readonly childrenOf: ReadonlyMap<string, readonly string[]>;
}

export const cycleNodeId = (cycleId: string): string => `cycle:${cycleId}`;
export const contextNodeId = (goalId: string): string => `context:${goalId}`;
export const keyResultHandle = (keyResultId: string): string =>
  `kr:${keyResultId}`;
const draftNodeId = (parentId: string): string => `draft:${parentId}`;

/** Collapsed on arrival: the company objectives, past the node budget. */
export function collapsedByDefault(tree: OkrTree): string[] {
  return tree.goals.length > COLLAPSE_PAST
    ? tree.goals
        .filter((goal) => goal.level === "company")
        .map((goal) => goal.id)
    : [];
}

/** Every objective below one, however deep, for "n hidden". */
function descendants(
  id: string,
  children: ReadonlyMap<string, readonly string[]>,
): number {
  let count = 0;
  const stack = [...(children.get(id) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const next = stack.pop() as string;
    if (seen.has(next)) {
      continue;
    }
    seen.add(next);
    count += 1;
    stack.push(...(children.get(next) ?? []));
  }
  return count;
}

export function layoutOkrTree(
  tree: OkrTree,
  options: {
    readonly collapsed: ReadonlySet<string>;
    /** Dependencies are drawn dashed, and only when asked for. */
    readonly dependencies: boolean;
    /** Cards carry "+ KR" and "+ aligned", for a reader who may add. */
    readonly actions?: boolean;
    /** Objectives with a key result draft row open in their stack. */
    readonly drafts?: ReadonlySet<string>;
    /** The objective an aligned objective is being added under, if any. */
    readonly draftChildOf?: string | null;
  },
): DiagramLayout {
  const cycleId = cycleNodeId(tree.cycle.id);
  const goals = new Map(tree.goals.map((goal) => [goal.id, goal]));
  const contexts = new Map(tree.context.map((entry) => [entry.id, entry]));

  // Which node owns each key result, so an objective aligned to one hangs
  // from that key result's own row.
  const keyResultOwner = new Map<string, string>();
  for (const goal of tree.goals) {
    for (const keyResult of goal.keyResults) {
      keyResultOwner.set(keyResult.id, goal.id);
    }
  }
  for (const entry of tree.context) {
    for (const keyResult of entry.keyResults) {
      keyResultOwner.set(keyResult.id, contextNodeId(entry.id));
    }
  }

  const parentNode = (
    goal: OkrGoal,
  ): { readonly node: string; readonly handle: string | null } => {
    if (goal.parentKeyResultId) {
      const owner = keyResultOwner.get(goal.parentKeyResultId);
      if (owner) {
        return { node: owner, handle: keyResultHandle(goal.parentKeyResultId) };
      }
    }
    if (goal.parentGoalId) {
      if (goals.has(goal.parentGoalId)) {
        return { node: goal.parentGoalId, handle: null };
      }
      if (contexts.has(goal.parentGoalId)) {
        return { node: contextNodeId(goal.parentGoalId), handle: null };
      }
    }
    // A parent the reader cannot see, or none: it hangs from the cycle.
    return { node: cycleId, handle: null };
  };

  // Every objective's parent, and each parent's children in the list's order.
  const parents = new Map<
    string,
    { readonly node: string; readonly handle: string | null }
  >();
  const allChildren = new Map<string, string[]>();
  for (const goal of tree.goals) {
    const parent = parentNode(goal);
    parents.set(goal.id, parent);
    allChildren.set(parent.node, [
      ...(allChildren.get(parent.node) ?? []),
      goal.id,
    ]);
  }
  // A new aligned objective's draft stands last among its parent's children,
  // where the saved one will appear.
  const draftParent =
    options.draftChildOf && goals.has(options.draftChildOf)
      ? options.draftChildOf
      : null;
  if (draftParent) {
    allChildren.set(draftParent, [
      ...(allChildren.get(draftParent) ?? []),
      draftNodeId(draftParent),
    ]);
  }

  const roots = [
    ...tree.context.map((entry) => contextNodeId(entry.id)),
    cycleId,
  ];

  // What is visible: everything under a root, except below a collapse.
  const depthOf = new Map<string, number>();
  const visibleChildren = new Map<string, string[]>();
  const visit = (id: string, depth: number) => {
    if (depthOf.has(id)) {
      return;
    }
    depthOf.set(id, depth);
    if (options.collapsed.has(id)) {
      return;
    }
    const children = allChildren.get(id) ?? [];
    visibleChildren.set(id, children);
    for (const child of children) {
      visit(child, depth + 1);
    }
  };
  for (const root of roots) {
    visit(root, 0);
  }

  const sizeOf = (id: string): { width: number; height: number } => {
    if (id === cycleId) {
      return { width: CYCLE_WIDTH, height: CYCLE_HEIGHT };
    }
    if (draftParent && id === draftNodeId(draftParent)) {
      return { width: OBJECTIVE_WIDTH, height: DRAFT_HEIGHT };
    }
    const goal = goals.get(id);
    if (goal) {
      const rows = options.collapsed.has(id)
        ? 0
        : goal.keyResults.length + (options.drafts?.has(id) ? 1 : 0);
      return {
        width: OBJECTIVE_WIDTH,
        height:
          CARD_HEAD +
          rows * KEY_RESULT_ROW +
          (options.actions && !options.collapsed.has(id)
            ? CARD_ACTIONS
            : CARD_FOOT),
      };
    }
    const context = contexts.get(id.slice("context:".length));
    return {
      width: CONTEXT_WIDTH,
      height: CONTEXT_HEAD + (context?.keyResults.length ?? 0) * CONTEXT_ROW,
    };
  };

  // A row is as tall as its tallest card, and rows stack downwards.
  const rowHeight: number[] = [];
  for (const [id, depth] of depthOf) {
    rowHeight[depth] = Math.max(rowHeight[depth] ?? 0, sizeOf(id).height);
  }
  const rowTop: number[] = [];
  let top = 0;
  for (let depth = 0; depth < rowHeight.length; depth += 1) {
    rowTop[depth] = top;
    top += (rowHeight[depth] ?? 0) + GAP_Y;
  }

  // Each subtree is as wide as its node or its children side by side.
  const spans = new Map<string, number>();
  const span = (id: string): number => {
    const known = spans.get(id);
    if (known !== undefined) {
      return known;
    }
    const children = visibleChildren.get(id) ?? [];
    const childWidth =
      children.reduce((sum, child) => sum + span(child), 0) +
      Math.max(children.length - 1, 0) * GAP_X;
    const width = Math.max(sizeOf(id).width, childWidth);
    spans.set(id, width);
    return width;
  };

  const placed = new Map<string, { x: number; y: number }>();
  const place = (id: string, left: number) => {
    const width = span(id);
    const own = sizeOf(id);
    placed.set(id, {
      x: left + (width - own.width) / 2,
      y: rowTop[depthOf.get(id) ?? 0] ?? 0,
    });
    const children = visibleChildren.get(id) ?? [];
    const childWidth =
      children.reduce((sum, child) => sum + span(child), 0) +
      Math.max(children.length - 1, 0) * GAP_X;
    let cursor = left + (width - childWidth) / 2;
    for (const child of children) {
      place(child, cursor);
      cursor += span(child) + GAP_X;
    }
  };
  let left = 0;
  for (const root of roots) {
    place(root, left);
    left += span(root) + ROOT_GAP_X;
  }

  const nodes: DiagramNode[] = [];
  for (const [id] of depthOf) {
    const at = placed.get(id) ?? { x: 0, y: 0 };
    const size = sizeOf(id);
    const box = { id, ...at, ...size };
    const goal = goals.get(id);
    if (id === cycleId) {
      nodes.push({ ...box, kind: "cycle", name: tree.cycle.name });
    } else if (draftParent && id === draftNodeId(draftParent)) {
      nodes.push({ ...box, kind: "draft", parentId: draftParent });
    } else if (goal) {
      const collapsed = options.collapsed.has(id);
      nodes.push({
        ...box,
        kind: "objective",
        goal,
        collapsed,
        hiddenBelow: collapsed ? descendants(id, allChildren) : 0,
        drafting: !collapsed && (options.drafts?.has(id) ?? false),
      });
    } else {
      const context = contexts.get(id.slice("context:".length));
      if (context) {
        nodes.push({ ...box, kind: "context", context });
      }
    }
  }

  const edges: DiagramEdge[] = [];
  const parentOf = new Map<string, string>();
  for (const goal of tree.goals) {
    const parent = parents.get(goal.id);
    if (!parent || !depthOf.has(goal.id)) {
      continue;
    }
    parentOf.set(goal.id, parent.node);
    edges.push({
      id: `align:${goal.id}`,
      source: parent.node,
      target: goal.id,
      sourceHandle: parent.handle,
      kind: "alignment",
    });
  }
  if (draftParent && depthOf.has(draftNodeId(draftParent))) {
    edges.push({
      id: `align:${draftNodeId(draftParent)}`,
      source: draftParent,
      target: draftNodeId(draftParent),
      sourceHandle: null,
      kind: "alignment",
    });
  }
  if (options.dependencies) {
    for (const link of tree.dependencies) {
      if (depthOf.has(link.fromGoalId) && depthOf.has(link.toGoalId)) {
        edges.push({
          id: `dependency:${link.id}`,
          source: link.fromGoalId,
          target: link.toGoalId,
          sourceHandle: null,
          kind: "dependency",
        });
      }
    }
  }

  return { nodes, edges, parentOf, childrenOf: visibleChildren };
}

/**
 * Where an objective may be moved under (P9-T10b): the cycle itself, any
 * objective, or any key result, except itself and whatever already hangs
 * below it, which would make a loop the server refuses anyway. In the list's
 * order, each objective followed by its key results.
 */
export function moveTargets(
  tree: OkrTree,
  goalId: string,
): {
  readonly value: string;
  readonly kind: "cycle" | "objective" | "keyResult";
  readonly title: string;
  /** The objective a key result belongs to. */
  readonly of?: string;
}[] {
  const owner = new Map<string, string>();
  for (const goal of tree.goals) {
    for (const keyResult of goal.keyResults) {
      owner.set(keyResult.id, goal.id);
    }
  }
  const children = new Map<string, string[]>();
  for (const goal of tree.goals) {
    const parent =
      goal.parentGoalId ??
      (goal.parentKeyResultId ? owner.get(goal.parentKeyResultId) : undefined);
    if (parent) {
      children.set(parent, [...(children.get(parent) ?? []), goal.id]);
    }
  }
  const below = new Set<string>([goalId]);
  const stack = [goalId];
  while (stack.length > 0) {
    for (const child of children.get(stack.pop() as string) ?? []) {
      if (!below.has(child)) {
        below.add(child);
        stack.push(child);
      }
    }
  }
  const targets: ReturnType<typeof moveTargets> = [
    { value: "cycle", kind: "cycle", title: tree.cycle.name },
  ];
  const parents = [
    ...tree.context.map((entry) => ({
      id: entry.id,
      title: entry.title,
      keyResults: entry.keyResults,
    })),
    ...tree.goals,
  ];
  for (const goal of parents) {
    if (below.has(goal.id)) {
      continue;
    }
    targets.push({
      value: `goal:${goal.id}`,
      kind: "objective",
      title: goal.title,
    });
    for (const keyResult of goal.keyResults) {
      targets.push({
        value: `kr:${keyResult.id}`,
        kind: "keyResult",
        title: keyResult.title,
        of: goal.title,
      });
    }
  }
  return targets;
}

/**
 * Where a card moved among its siblings lands (P9-T10b), as the `afterId`
 * `goals.place` takes: the objective it now follows in the cycle's whole
 * order, or null for first. `slot` is its place among the other siblings.
 * The order is the list's, so a sibling put first among its siblings goes
 * just before the sibling that was first, whatever stands between them.
 */
export function afterForSlot(
  order: readonly string[],
  siblings: readonly string[],
  id: string,
  slot: number,
): string | null {
  const rest = siblings.filter((sibling) => sibling !== id);
  if (slot > 0) {
    return rest[Math.min(slot, rest.length) - 1] ?? null;
  }
  const first = rest[0];
  if (first === undefined) {
    return null;
  }
  const others = order.filter((entry) => entry !== id);
  const at = others.indexOf(first);
  return at > 0 ? (others[at - 1] ?? null) : null;
}
