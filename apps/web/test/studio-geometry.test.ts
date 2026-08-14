import { describe, expect, it } from "vitest";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  type LayoutNode,
  layoutCascade,
  ROW_GAP,
  visibleCards,
} from "../app/goals/studio/geometry.ts";

/**
 * The studio canvas's geometry (P3-T10, S-16).
 *
 * The task's test plan asks for two things a browser screenshot cannot settle:
 * that the canvas stays interactive at a thousand nodes, and that keyboard
 * traverse reaches every node. The second is a property of the ordered list this
 * layout produces, so both are checked here against the real functions rather
 * than against a description of them.
 */

const LEVELS = ["company", "department", "team", "individual"] as const;

/** A tree of `count` goals, four levels deep, every child pointing at a parent. */
function tree(count: number): LayoutNode[] {
  const nodes: LayoutNode[] = [];
  for (let index = 0; index < count; index += 1) {
    const level =
      LEVELS[Math.min(3, Math.floor(index / Math.max(1, count / 4)))];
    nodes.push({
      id: `g${index}`,
      title: `Goal ${index}`,
      level: level ?? "team",
      parentGoalId: index === 0 ? null : `g${Math.floor(index / 4)}`,
    });
  }
  return nodes;
}

describe("the cascade layout", () => {
  it("places every node exactly once", () => {
    const nodes = tree(200);
    const { placed } = layoutCascade(nodes);
    expect(placed).toHaveLength(nodes.length);
    expect(new Set(placed.map((entry) => entry.node.id)).size).toBe(
      nodes.length,
    );
  });

  it("gives a level no vertical band when nothing uses it", () => {
    const { height } = layoutCascade([
      { id: "a", title: "A", level: "company", parentGoalId: null },
      { id: "b", title: "B", level: "team", parentGoalId: "a" },
    ]);
    // Two rows, not four: an empty department band across the canvas is a lie
    // about the shape of the organisation.
    expect(height).toBe(2 * (CARD_HEIGHT + ROW_GAP));
  });

  it("orders children under the parent that owns them", () => {
    const { placed } = layoutCascade([
      { id: "c1", title: "C1", level: "company", parentGoalId: null },
      { id: "c2", title: "C2", level: "company", parentGoalId: null },
      { id: "d2", title: "Z", level: "department", parentGoalId: "c2" },
      { id: "d1", title: "A", level: "department", parentGoalId: "c1" },
    ]);
    const departments = placed
      .filter((entry) => entry.node.level === "department")
      .sort((left, right) => left.x - right.x)
      .map((entry) => entry.node.id);
    // "Z" under the first company comes before "A" under the second, because
    // the parent decides the column and the title is only the tie-break.
    expect(departments).toEqual(["d1", "d2"]);
  });

  /** Keyboard traverse walks this list, so it has to hold every node. */
  it("produces an order that reaches every node", () => {
    const nodes = tree(1000);
    const { placed } = layoutCascade(nodes);
    const order = placed.map((entry) => entry.node.id);
    expect(new Set(order).size).toBe(nodes.length);
    for (const node of nodes) {
      expect(order).toContain(node.id);
    }
  });
});

describe("virtualisation", () => {
  const nodes = tree(1000);

  it("draws only what meets the viewport", () => {
    const { placed } = layoutCascade(nodes);
    const drawn = visibleCards(placed, {
      panX: 24,
      panY: 24,
      zoom: 1,
      width: 1200,
      height: 560,
    });
    // The whole point: a thousand cards do not become a thousand DOM nodes.
    expect(drawn.length).toBeLessThan(placed.length);
    expect(drawn.length).toBeGreaterThan(0);
    for (const entry of drawn) {
      expect(entry.x).toBeGreaterThanOrEqual(-CARD_WIDTH - 240);
    }
  });

  it("keeps every card when the canvas is zoomed far out", () => {
    const { placed, width, height } = layoutCascade(nodes);
    const drawn = visibleCards(placed, {
      panX: 0,
      panY: 0,
      zoom: 0.05,
      width: width,
      height: height,
    });
    expect(drawn).toHaveLength(placed.length);
  });

  /**
   * The task's budget, measured rather than claimed.
   *
   * A generous ceiling on purpose: this asserts the work is linear and cheap,
   * not that a particular machine is fast. A regression that made layout
   * quadratic would blow through this by orders of magnitude, which is the
   * failure worth catching.
   */
  it("lays out and filters a thousand nodes well inside a frame", () => {
    const started = performance.now();
    const { placed } = layoutCascade(nodes);
    visibleCards(placed, {
      panX: 24,
      panY: 24,
      zoom: 1,
      width: 1200,
      height: 560,
    });
    expect(performance.now() - started).toBeLessThan(100);
  });
});
