/**
 * The studio canvas's pure geometry (S-16, P3-T10).
 *
 * Separate from the component so the thousand-node budget in the task's test
 * plan can actually be measured rather than asserted. Everything here is a
 * function of the tree: no coordinates are stored, because a saved position is a
 * second thing to keep in step and it goes stale the moment somebody re-parents
 * a goal.
 */

export interface LayoutNode {
  readonly id: string;
  readonly title: string;
  readonly level: string;
  readonly parentGoalId: string | null;
}

export interface Placed<TNode extends LayoutNode> {
  readonly node: TNode;
  readonly x: number;
  readonly y: number;
}

export const LEVELS = ["company", "department", "team", "individual"] as const;

export const CARD_WIDTH = 220;
export const CARD_HEIGHT = 96;
export const COLUMN_GAP = 28;
export const ROW_GAP = 96;

/**
 * One row per level, children ordered under the parent that owns them.
 *
 * Ordering by parent rather than alphabetically keeps the connectors from
 * crossing in the common case. It is a heuristic, not a layout engine: a goal
 * cannot have two parents, so the crossings left over come from dependencies,
 * which are dashed precisely because they cut across the tree.
 *
 * A level the workspace does not use takes no vertical space, so a company and
 * team set does not leave an empty department band across the canvas.
 */
export function layoutCascade<TNode extends LayoutNode>(
  nodes: readonly TNode[],
): { placed: Placed<TNode>[]; width: number; height: number } {
  const byLevel = new Map<string, TNode[]>();
  for (const node of nodes) {
    const row = byLevel.get(node.level);
    if (row) {
      row.push(node);
    } else {
      byLevel.set(node.level, [node]);
    }
  }

  const used = LEVELS.filter((level) => (byLevel.get(level)?.length ?? 0) > 0);
  // A level the four canonical ones do not name still gets a row rather than
  // vanishing, because an unreadable card beats a missing goal.
  for (const level of byLevel.keys()) {
    if (!(LEVELS as readonly string[]).includes(level)) {
      used.push(level as (typeof LEVELS)[number]);
    }
  }

  const orderOf = new Map<string, number>();
  let running = 0;
  for (const level of used) {
    const row = byLevel.get(level) ?? [];
    row.sort((left, right) => {
      const leftKey =
        orderOf.get(left.parentGoalId ?? "") ?? Number.MAX_SAFE_INTEGER;
      const rightKey =
        orderOf.get(right.parentGoalId ?? "") ?? Number.MAX_SAFE_INTEGER;
      if (leftKey !== rightKey) {
        return leftKey - rightKey;
      }
      return left.title.localeCompare(right.title);
    });
    for (const node of row) {
      orderOf.set(node.id, running);
      running += 1;
    }
  }

  const placed: Placed<TNode>[] = [];
  let widest = 0;
  used.forEach((level, rowIndex) => {
    const row = byLevel.get(level) ?? [];
    row.forEach((node, columnIndex) => {
      placed.push({
        node,
        x: columnIndex * (CARD_WIDTH + COLUMN_GAP),
        y: rowIndex * (CARD_HEIGHT + ROW_GAP),
      });
    });
    widest = Math.max(widest, row.length);
  });

  return {
    placed,
    width: Math.max(1, widest) * (CARD_WIDTH + COLUMN_GAP),
    height: Math.max(1, used.length) * (CARD_HEIGHT + ROW_GAP),
  };
}

export interface Viewport {
  readonly panX: number;
  readonly panY: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
}

/** Cards whose rectangle meets the visible one, plus a margin so panning is smooth. */
export function visibleCards<TNode extends LayoutNode>(
  placed: readonly Placed<TNode>[],
  viewport: Viewport,
  margin = 240,
): Placed<TNode>[] {
  const left = (-viewport.panX - margin) / viewport.zoom;
  const top = (-viewport.panY - margin) / viewport.zoom;
  const right = (-viewport.panX + viewport.width + margin) / viewport.zoom;
  const bottom = (-viewport.panY + viewport.height + margin) / viewport.zoom;
  return placed.filter(
    (entry) =>
      entry.x + CARD_WIDTH >= left &&
      entry.x <= right &&
      entry.y + CARD_HEIGHT >= top &&
      entry.y <= bottom,
  );
}
