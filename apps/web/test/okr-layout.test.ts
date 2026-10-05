import { describe, expect, test } from "vitest";
import {
  afterForSlot,
  COLLAPSE_PAST,
  collapsedByDefault,
  contextNodeId,
  cycleNodeId,
  type DiagramNode,
  keyResultHandle,
  layoutOkrTree,
  moveTargets,
} from "../app/goals/okr-layout.ts";
import type { OkrTree } from "../lib/okr-tree/cache.ts";

/**
 * The OKR diagram's layout (P9-T09a, docs/design/p9-t00-okr-writing.md §5.2).
 *
 * The claims the design makes of the picture, each checked on the boxes the
 * layout returns: siblings in the list's order, an objective aligned to a key
 * result hanging from that row, parents from another cycle in the band
 * above, a collapse hiding what is below it, the company's shape on arrival
 * past the node budget, and no two cards on top of each other.
 */

type Goal = OkrTree["goals"][number];

const keyResult = (id: string, goalId: string) => ({
  id,
  goalId,
  title: `Key result ${id}`,
  unit: null,
  kind: "metric",
  doneAt: null,
  addedMidCycleAt: null,
  draft: null,
  direction: "increase",
  indicatorType: "lagging",
  baselineValue: 0,
  targetValue: 100,
  currentValue: 10,
  dueOn: null,
  owner: null,
  weight: 1,
  kpiId: null,
  progressPct: 10,
  confidence: null,
  qualityFlags: [],
  position: 0,
});

const goal = (
  id: string,
  options: Partial<Goal> & { readonly keyResultIds?: readonly string[] } = {},
): Goal => {
  const { keyResultIds = [], ...rest } = options;
  return {
    id,
    title: `Objective ${id}`,
    cycleId: "c",
    level: "team",
    kind: "aspirational",
    addedMidCycleAt: null,
    draft: null,
    draftState: null,
    reportedStatus: null,
    spaceId: null,
    champion: { id: "m", name: "Mei" },
    reviewer: null,
    parentGoalId: null,
    parentKeyResultId: null,
    weight: 1,
    contributionStatement: null,
    standaloneReason: null,
    progressPct: 10,
    health: "on_track",
    closedAt: null,
    nextCheckInOn: null,
    daysPastDue: null,
    position: 0,
    quality: { score: null, flags: [] },
    keyResults: keyResultIds.map((krId) => keyResult(krId, id)) as never,
    ...rest,
  };
};

const tree = (
  goals: readonly Goal[],
  extra: Partial<Pick<OkrTree, "context" | "dependencies">> = {},
): OkrTree => ({
  cycle: {
    id: "c",
    name: "Q1 2027",
    mode: "quarterly",
    startsOn: "2027-01-01",
    endsOn: "2027-03-31",
    midCycle: false,
  },
  viewerId: "00000000-0000-4000-8000-000000000001",
  goals: [...goals],
  context: [...(extra.context ?? [])],
  dependencies: [...(extra.dependencies ?? [])],
});

const open = { collapsed: new Set<string>(), dependencies: false };

const node = (nodes: readonly DiagramNode[], id: string) => {
  const found = nodes.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`${id} was not drawn`);
  }
  return found;
};

describe("the shape", () => {
  test("the cycle is the root and its objectives hang below it", () => {
    const layout = layoutOkrTree(
      tree([goal("a", { level: "company" }), goal("b", { level: "company" })]),
      open,
    );
    const cycle = node(layout.nodes, cycleNodeId("c"));
    expect(cycle.kind).toBe("cycle");
    for (const id of ["a", "b"]) {
      expect(node(layout.nodes, id).y).toBeGreaterThan(cycle.y);
      expect(layout.parentOf.get(id)).toBe(cycleNodeId("c"));
    }
  });

  test("siblings stand in the list's order, and move when it does", () => {
    const xs = (order: readonly string[]) => {
      const layout = layoutOkrTree(
        tree(order.map((id) => goal(id, { level: "company" }))),
        open,
      );
      return [...layout.nodes]
        .filter((entry) => entry.kind === "objective")
        .sort((one, other) => one.x - other.x)
        .map((entry) => entry.id);
    };
    expect(xs(["a", "b", "c"])).toEqual(["a", "b", "c"]);
    expect(xs(["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  test("an objective aligned to a key result hangs from that key result's row", () => {
    const layout = layoutOkrTree(
      tree([
        goal("company", { level: "company", keyResultIds: ["k1", "k2"] }),
        goal("team", { parentKeyResultId: "k2" }),
      ]),
      open,
    );
    expect(layout.edges).toContainEqual({
      id: "align:team",
      source: "company",
      target: "team",
      sourceHandle: keyResultHandle("k2"),
      kind: "alignment",
    });
    expect(node(layout.nodes, "team").y).toBeGreaterThan(
      node(layout.nodes, "company").y,
    );
  });

  test("a parent from another cycle is drawn in the band above, and its children hang from it", () => {
    const layout = layoutOkrTree(
      tree([goal("quarterly", { parentGoalId: "annual" })], {
        context: [
          {
            id: "annual",
            title: "Win the mid-market this year",
            level: "company",
            cycleId: "y",
            cycleName: "2027",
            otherCycle: true,
            progressPct: 30,
            keyResults: [],
          },
        ],
      }),
      open,
    );
    const band = node(layout.nodes, contextNodeId("annual"));
    expect(band.kind).toBe("context");
    expect(band.y).toBe(node(layout.nodes, cycleNodeId("c")).y);
    expect(layout.parentOf.get("quarterly")).toBe(contextNodeId("annual"));
  });

  test("a parent the reader cannot see leaves its child under the cycle", () => {
    const layout = layoutOkrTree(
      tree([goal("orphan", { parentGoalId: "hidden" })]),
      open,
    );
    expect(layout.parentOf.get("orphan")).toBe(cycleNodeId("c"));
  });

  test("no two cards on one row overlap", () => {
    const goals = [
      goal("a", { level: "company", keyResultIds: ["ka"] }),
      goal("b", { level: "company" }),
      goal("a1", { parentGoalId: "a" }),
      goal("a2", { parentGoalId: "a" }),
      goal("a3", { parentKeyResultId: "ka" }),
      goal("b1", { parentGoalId: "b" }),
    ];
    const layout = layoutOkrTree(tree(goals), open);
    const rows = new Map<number, DiagramNode[]>();
    for (const entry of layout.nodes) {
      rows.set(entry.y, [...(rows.get(entry.y) ?? []), entry]);
    }
    for (const row of rows.values()) {
      const sorted = [...row].sort((one, other) => one.x - other.x);
      for (let index = 1; index < sorted.length; index += 1) {
        const before = sorted[index - 1] as DiagramNode;
        expect((sorted[index] as DiagramNode).x).toBeGreaterThanOrEqual(
          before.x + before.width,
        );
      }
    }
  });
});

describe("collapsing", () => {
  test("a collapsed objective hides what is aligned below it, says how many, and folds its key results", () => {
    const goals = [
      goal("a", { level: "company", keyResultIds: ["k1", "k2"] }),
      goal("a1", { parentGoalId: "a" }),
      goal("a11", { parentGoalId: "a1" }),
    ];
    const opened = layoutOkrTree(tree(goals), open);
    const folded = layoutOkrTree(tree(goals), {
      collapsed: new Set(["a"]),
      dependencies: false,
    });
    expect(folded.nodes.map((entry) => entry.id)).not.toContain("a1");
    expect(folded.nodes.map((entry) => entry.id)).not.toContain("a11");
    const card = node(folded.nodes, "a");
    expect(card.kind === "objective" && card.hiddenBelow).toBe(2);
    expect(card.height).toBeLessThan(node(opened.nodes, "a").height);
  });

  test(`past ${COLLAPSE_PAST} objectives the company level arrives collapsed, and not before`, () => {
    const many = (count: number) =>
      tree(
        Array.from({ length: count }, (_, index) =>
          goal(`g${index}`, {
            level: index % 10 === 0 ? "company" : "team",
            parentGoalId: index % 10 === 0 ? null : `g${index - (index % 10)}`,
          }),
        ),
      );
    expect(collapsedByDefault(many(COLLAPSE_PAST))).toEqual([]);
    const folded = collapsedByDefault(many(300));
    expect(folded).toHaveLength(30);
    const layout = layoutOkrTree(many(300), {
      collapsed: new Set(folded),
      dependencies: false,
    });
    // The cycle and its thirty company objectives, and nothing below them.
    expect(layout.nodes).toHaveLength(31);
  });
});

describe("dependencies", () => {
  const linked = tree(
    [goal("a"), goal("b"), goal("c", { parentGoalId: "b" })],
    {
      dependencies: [
        { id: "d1", fromGoalId: "a", toGoalId: "b" },
        { id: "d2", fromGoalId: "a", toGoalId: "c" },
      ],
    },
  );

  test("are drawn only when asked for", () => {
    expect(
      layoutOkrTree(linked, open).edges.filter(
        (edge) => edge.kind === "dependency",
      ),
    ).toEqual([]);
    expect(
      layoutOkrTree(linked, { ...open, dependencies: true }).edges.filter(
        (edge) => edge.kind === "dependency",
      ),
    ).toHaveLength(2);
  });

  test("leave out an end a collapse is hiding", () => {
    const edges = layoutOkrTree(linked, {
      collapsed: new Set(["b"]),
      dependencies: true,
    }).edges.filter((edge) => edge.kind === "dependency");
    expect(edges.map((edge) => edge.id)).toEqual(["dependency:d1"]);
  });
});

/** Editing and adding on a card (P9-T10a): room for what is being added. */
describe("drafts and actions", () => {
  test("a key result draft makes room for one more row, and the actions for their buttons", () => {
    const goals = [goal("a", { keyResultIds: ["k1"] })];
    const plain = node(layoutOkrTree(tree(goals), open).nodes, "a");
    const acting = node(
      layoutOkrTree(tree(goals), { ...open, actions: true }).nodes,
      "a",
    );
    const drafting = node(
      layoutOkrTree(tree(goals), {
        ...open,
        actions: true,
        drafts: new Set(["a"]),
      }).nodes,
      "a",
    );
    expect(acting.height).toBeGreaterThan(plain.height);
    expect(drafting.height).toBe(acting.height + 30);
    expect(drafting.kind === "objective" && drafting.drafting).toBe(true);
  });

  test("an aligned objective's draft stands last under its parent, joined to it", () => {
    const layout = layoutOkrTree(
      tree([
        goal("a", { level: "company" }),
        goal("a1", { parentGoalId: "a" }),
      ]),
      { ...open, draftChildOf: "a" },
    );
    const draft = node(layout.nodes, "draft:a");
    expect(draft.kind).toBe("draft");
    expect(layout.childrenOf.get("a")).toEqual(["a1", "draft:a"]);
    expect(draft.x).toBeGreaterThan(node(layout.nodes, "a1").x);
    expect(layout.edges.map((edge) => edge.id)).toContain("align:draft:a");
  });

  test("a draft under an objective that is not drawn is not drawn either", () => {
    const layout = layoutOkrTree(tree([goal("a")]), {
      ...open,
      draftChildOf: "elsewhere",
    });
    expect(layout.nodes.map((entry) => entry.id)).not.toContain(
      "draft:elsewhere",
    );
  });
});

test("a folded card carries no actions, so three hundred arrive lean", () => {
  const goals = [goal("a", { keyResultIds: ["k1"] })];
  const folded = node(
    layoutOkrTree(tree(goals), {
      ...open,
      actions: true,
      collapsed: new Set(["a"]),
    }).nodes,
    "a",
  );
  const bare = node(
    layoutOkrTree(tree(goals), { ...open, collapsed: new Set(["a"]) }).nodes,
    "a",
  );
  expect(folded.height).toBe(bare.height);
});

/** Moving on the diagram (P9-T10b). */
describe("moving", () => {
  test("an objective may move under the cycle, anything else, or a key result, but not under itself or what hangs below it", () => {
    const targets = moveTargets(
      tree([
        goal("a", { level: "company", keyResultIds: ["ka"] }),
        goal("b", { level: "company" }),
        goal("a1", { parentGoalId: "a", keyResultIds: ["ka1"] }),
        goal("a11", { parentKeyResultId: "ka1" }),
      ]),
      "a1",
    ).map((target) => target.value);
    expect(targets).toEqual(["cycle", "goal:a", "kr:ka", "goal:b"]);
  });

  test("a card put among its siblings lands after the one to its left, or just before the first", () => {
    const order = ["x", "a", "y", "b", "c"];
    const siblings = ["a", "b", "c"];
    expect(afterForSlot(order, siblings, "c", 1)).toBe("a");
    expect(afterForSlot(order, siblings, "a", 2)).toBe("c");
    // First among its siblings: just before "a", which "x" precedes.
    expect(afterForSlot(order, siblings, "c", 0)).toBe("x");
    expect(afterForSlot(["a", "b"], ["a", "b"], "b", 0)).toBeNull();
  });
});
