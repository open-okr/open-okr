import { describe, expect, it } from "vitest";
import {
  filterGoals,
  kindIn,
  mergeGoal,
  type OkrGoal,
  type OkrTree,
  okrCycleKey,
  okrTreeKey,
  patchGoalIn,
  patchKeyResultIn,
  placeGoalIn,
  placeKeyResultIn,
  reparentIn,
  withoutGoal,
  withoutKeyResult,
} from "../lib/okr-tree/cache.ts";

/**
 * The OKR tree's cache, changed before the server answers (P9-T06c).
 *
 * Pure, so the hook can hold the tree it had and put it back. Every function
 * returns a new tree and leaves the one it was given alone, which is the whole
 * of rollback: there is nothing to undo, only a reference to restore.
 */

const keyResult = (id: string, goalId: string) => ({
  id,
  goalId,
  title: `Key result ${id}`,
  unit: null,
  kind: "metric" as const,
  doneAt: null,
  addedMidCycleAt: null,
  draft: null,
  direction: "increase" as const,
  indicatorType: "lagging" as const,
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

const goal = (id: string, extra: Partial<OkrGoal> = {}): OkrGoal => ({
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
  keyResults: [keyResult(`${id}-kr`, id)],
  ...extra,
});

const tree: OkrTree = {
  cycle: {
    id: "c",
    name: "Q1",
    mode: "quarterly",
    startsOn: "2027-01-01",
    endsOn: "2027-03-31",
    midCycle: false,
  },
  viewerId: "00000000-0000-4000-8000-000000000001",
  goals: [goal("a"), goal("b", { level: "company", closedAt: "2027-02-01" })],
  context: [],
  dependencies: [],
};

describe("the cache key", () => {
  it("is one entry per cycle and scope, under one prefix per cycle", () => {
    expect(okrTreeKey("c", "mine")).toEqual(["okr-tree", "c", "mine"]);
    expect(okrTreeKey("c", "all").slice(0, 2)).toEqual(okrCycleKey("c"));
  });
});

describe("changes made before the server answers", () => {
  it("patches one objective and leaves the tree it was given alone", () => {
    const next = patchGoalIn(tree, "a", { title: "Renamed" });
    expect(next.goals[0]?.title).toBe("Renamed");
    expect(tree.goals[0]?.title).toBe("Objective a");
    expect(next.goals[1]).toBe(tree.goals[1]);
  });

  it("patches one key result and keeps its progress for the server to recompute", () => {
    const next = patchKeyResultIn(tree, "a-kr", { currentValue: 60 });
    expect(next.goals[0]?.keyResults[0]).toMatchObject({
      currentValue: 60,
      progressPct: 10,
    });
  });

  it("takes a key result off its objective", () => {
    const next = withoutKeyResult(tree, "a-kr");
    expect(next.goals[0]?.keyResults).toEqual([]);
    expect(tree.goals[0]?.keyResults).toHaveLength(1);
  });

  it("puts the server's node over the guess, and adds one it did not hold", () => {
    const server = goal("a", { title: "Server's", progressPct: 55 });
    expect(mergeGoal(tree, server).goals[0]).toBe(server);
    expect(mergeGoal(tree, goal("c")).goals.map((row) => row.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("what a filter keeps", () => {
  it("leaves closed objectives out unless asked, and narrows by level and health", () => {
    expect(
      filterGoals(tree.goals, { includeClosed: false }).map((row) => row.id),
    ).toEqual(["a"]);
    expect(
      filterGoals(tree.goals, { includeClosed: true, level: "company" }).map(
        (row) => row.id,
      ),
    ).toEqual(["b"]);
    expect(
      filterGoals(tree.goals, { includeClosed: true, health: "off_track" }),
    ).toEqual([]);
  });

  it("narrows by champion, by space, and to the reader's own spaces", () => {
    const spaced = [
      goal("x", { spaceId: "s1" }),
      goal("y", { spaceId: "s2", champion: { id: "p", name: "Priya" } }),
      goal("z", { spaceId: null }),
    ];
    const ids = (filters: Parameters<typeof filterGoals>[1]) =>
      filterGoals(spaced, filters).map((row) => row.id);
    expect(ids({ includeClosed: false, championId: "p" })).toEqual(["y"]);
    expect(ids({ includeClosed: false, spaceId: "s1" })).toEqual(["x"]);
    // An objective in no space is nobody's team's.
    expect(ids({ includeClosed: false, spaceIds: ["s1", "s2"] })).toEqual([
      "x",
      "y",
    ]);
    expect(ids({ includeClosed: false, spaceIds: [] })).toEqual([]);
  });
});

describe("moving and deleting before the server answers (P9-T07b-b)", () => {
  it("places an objective first, or after another, as the server will", () => {
    const three = { ...tree, goals: [goal("a"), goal("b"), goal("c")] };
    expect(placeGoalIn(three, "c", null).goals.map((row) => row.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(placeGoalIn(three, "a", "b").goals.map((row) => row.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("places a key result within its own objective only", () => {
    const withThree = {
      ...tree,
      goals: [
        goal("a", {
          keyResults: [
            keyResult("k1", "a"),
            keyResult("k2", "a"),
            keyResult("k3", "a"),
          ],
        }),
        goal("b"),
      ],
    };
    const moved = placeKeyResultIn(withThree, "k3", null);
    expect(moved.goals[0]?.keyResults.map((row) => row.id)).toEqual([
      "k3",
      "k1",
      "k2",
    ]);
    expect(moved.goals[1]).toBe(withThree.goals[1]);
  });

  it("takes an objective off the list", () => {
    expect(withoutGoal(tree, "a").goals.map((row) => row.id)).toEqual(["b"]);
  });
});

describe("reparentIn (P9-T10b)", () => {
  const tree = (): OkrTree =>
    ({
      cycle: {
        id: "c",
        name: "Q1",
        mode: "quarterly",
        startsOn: "2027-01-01",
        endsOn: "2027-03-31",
        midCycle: false,
      },
      viewerId: "00000000-0000-4000-8000-000000000001",
      goals: [goal("a"), goal("b", { parentGoalId: "a" })],
      context: [],
      dependencies: [],
    }) as OkrTree;

  it("hangs an objective under a key result and clears its objective parent, one pointer at most", () => {
    const moved = reparentIn(tree(), "b", {
      parentGoalId: null,
      parentKeyResultId: "k",
    }).goals[1];
    expect(moved?.parentGoalId).toBeNull();
    expect(moved?.parentKeyResultId).toBe("k");
  });

  it("hangs it from the cycle when both are null, and touches nothing else", () => {
    const next = reparentIn(tree(), "b", {
      parentGoalId: null,
      parentKeyResultId: null,
    });
    expect(next.goals[1]?.parentGoalId).toBeNull();
    expect(next.goals[0]).toEqual(tree().goals[0]);
  });
});

describe("the kind (P9-T11b-a)", () => {
  it("changes one objective's kind before the server answers", () => {
    const changed = kindIn(tree, "a", "committed");
    expect(changed.goals.map((entry) => entry.kind)).toEqual([
      "committed",
      "aspirational",
    ]);
    // The tree it came from is left as it was, for a refusal to put back.
    expect(tree.goals[0]?.kind).toBe("aspirational");
  });

  it("keeps one kind when the filter asks for it", () => {
    const mixed = kindIn(tree, "b", "committed");
    expect(
      filterGoals(mixed.goals, {
        includeClosed: true,
        kind: "committed",
      }).map((entry) => entry.id),
    ).toEqual(["b"]);
  });
});
