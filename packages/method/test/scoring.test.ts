import {
  cellJson,
  cellNumber,
  loadGoldenTables,
} from "@openokr/test-support/golden-table";
import { describe, expect, it } from "vitest";
import {
  type CascadeGoal,
  cascadeProgress,
  confidenceBand,
  draftVerdict,
  goalHealth,
  type KeyResultDirection,
  keyResultProgress,
  portfolioVerdictOf,
  progressSignal,
  scoreAnnotation,
  scoreBand,
  trendForecast,
  weightedProgress,
} from "../src/scoring.ts";
import { canonThresholds } from "../src/thresholds.ts";

/**
 * The scoring and health engine against its own golden masters (P3-T05).
 *
 * Every matrix here is read out of `docs/design/p3-t00-scoring-and-health-engine.md`
 * at run time rather than retyped. That document is the fixture: changing a number
 * in it changes what this suite asserts, and deleting a table breaks the build
 * rather than silently testing nothing. Two copies of a correctness matrix is a
 * matrix nobody owns.
 */

const thresholds = canonThresholds();

const tables = loadGoldenTables(
  new URL(
    "../../../docs/design/p3-t00-scoring-and-health-engine.md",
    import.meta.url,
  ).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);

const num = (row: Record<string, string>, column: string): number => {
  const value = cellNumber(row, column);
  if (value === null) {
    throw new Error(
      `Column "${column}" is blank in a row that needs a number. A blank cell means "no value" in these matrices, and this column never has one.`,
    );
  }
  return value;
};

const json = <T>(row: Record<string, string>, column: string): T => {
  const value = cellJson<T>(row, column);
  if (value === null) {
    throw new Error(`Column "${column}" is blank and this row needs its JSON.`);
  }
  return value;
};

const table = (id: string) => {
  const found = tables.get(id);
  if (!found) {
    throw new Error(
      `Golden table "${id}" is not in the design document. The suite asserts ` +
        "nothing without it, so this is a build failure rather than a skip.",
    );
  }
  return found;
};

describe("key result progress", () => {
  for (const row of table("scoring.kr-progress").rows) {
    it(`${row.case}`, () => {
      expect(
        keyResultProgress({
          direction: row.direction as KeyResultDirection,
          baseline: num(row, "baseline"),
          target: num(row, "target"),
          current: num(row, "current"),
        }),
      ).toBe(num(row, "expected_pct"));
    });
  }

  for (const row of table("scoring.kr-progress-kpi").rows) {
    it(`${row.case}`, () => {
      const achievement = row.achievement_pct?.trim();
      expect(
        keyResultProgress({
          direction: "increase",
          baseline: 0,
          target: 100,
          current: 0,
          // An empty cell is "no achievement yet", which is a different fact from
          // an achievement of zero. Both answer 0 here, and only one of them is
          // allowed to bypass the direction formula.
          kpiAchievementPct:
            achievement === undefined || achievement === ""
              ? null
              : Number(achievement),
        }),
      ).toBe(num(row, "expected_pct"));
    });
  }
});

/** A `{"krs":[[w,p]],"children":[...]}` subtree, as the matrix writes them. */
interface TreeNode {
  readonly w?: number;
  readonly krs?: readonly [number, number][];
  readonly children?: readonly TreeNode[];
}

/** The tree matrix, flattened into the node list the cascade takes. */
function flatten(
  node: TreeNode,
  id: string,
  parentGoalId: string | null,
  into: CascadeGoal[],
): void {
  into.push({
    id,
    weight: node.w ?? 1,
    parentGoalId,
    keyResults: (node.krs ?? []).map(([weight, progressPct], index) => ({
      id: `${id}-k${index}`,
      weight,
      progressPct,
    })),
  });
  (node.children ?? []).forEach((child, index) => {
    flatten(child, `${id}-c${index}`, id, into);
  });
}

describe("goal progress", () => {
  for (const row of table("scoring.goal-progress").rows) {
    it(`${row.case}`, () => {
      const tree = json<TreeNode>(row, "tree");
      const nodes: CascadeGoal[] = [];
      flatten(tree, "root", null, nodes);
      const result = cascadeProgress(nodes);
      expect(result.goals.get("root")).toBe(num(row, "expected_pct"));
      expect(result.diagnostics).toEqual([]);
    });
  }

  it("weights above the clamp are the caller's problem, not this function's", () => {
    // The matrix row "a weight above the clamp is clamped to 100" reads 99.01,
    // which is 100 and 0 weighted 100 to 1. The clamp happens on write (P3-T04),
    // so the arithmetic here is handed the clamped value.
    expect(
      weightedProgress([
        { weight: 100, progressPct: 100 },
        { weight: 1, progressPct: 0 },
      ]),
    ).toBe(99.01);
  });
});

/** One row of the cascade matrix's explicit node list. */
interface CascadeNode {
  readonly id: string;
  readonly parent?: string;
  readonly w?: number;
  readonly krs?: readonly [number, number][];
  readonly krIds?: readonly string[];
}

describe("the upward cascade", () => {
  for (const row of table("scoring.cascade").rows) {
    it(`${row.case}`, () => {
      const nodes = json<CascadeNode[]>(row, "nodes");
      const goals: CascadeGoal[] = nodes.map((node) => {
        const parent = node.parent ?? null;
        const viaKeyResult = parent?.startsWith("kr:") ?? false;
        return {
          id: node.id,
          weight: node.w ?? 1,
          parentGoalId: viaKeyResult ? null : parent,
          parentKeyResultId: viaKeyResult
            ? (parent as string).slice("kr:".length)
            : null,
          keyResults: (node.krs ?? []).map(([weight, progressPct], index) => ({
            // The matrix names a key result explicitly only where a child aligns
            // to it; everywhere else the id is never referenced.
            id: node.krIds?.[index] ?? `${node.id}-k${index}`,
            weight,
            progressPct,
          })),
        };
      });

      const result = cascadeProgress(goals);
      const expected = json<Record<string, number>>(row, "expected");
      for (const [id, value] of Object.entries(expected)) {
        const fromGoals = result.goals.get(id);
        if (fromGoals !== undefined) {
          expect(fromGoals, id).toBe(value);
          continue;
        }
        // A key result in the expected column is decision D-2 being asserted: its
        // own measured progress is untouched by the child aligned beneath it.
        const measured = goals
          .flatMap((goal) => goal.keyResults)
          .find((keyResult) => keyResult.id === id);
        expect(measured?.progressPct, id).toBe(value);
      }

      const diagnostics = (row.diagnostics ?? "").trim();
      expect(result.diagnostics).toEqual(
        diagnostics === "" ? [] : diagnostics.split(/\s*,\s*/),
      );
    });
  }

  it("finishes a thousand-goal chain inside the budget", () => {
    // Decision D-13: under 200 ms for 1,000 goals with no I/O, derived from the
    // neighbouring alignment budget in §13.1.
    const goals: CascadeGoal[] = Array.from({ length: 1000 }, (_, index) => ({
      id: `g${String(index).padStart(4, "0")}`,
      weight: 1,
      parentGoalId:
        index === 0 ? null : `g${String(index - 1).padStart(4, "0")}`,
      keyResults: [{ id: `k${index}`, weight: 1, progressPct: index % 101 }],
    }));

    const started = performance.now();
    const result = cascadeProgress(goals);
    const elapsed = performance.now() - started;

    expect(result.goals.size).toBe(1000);
    expect(result.diagnostics).toEqual([]);
    expect(elapsed).toBeLessThan(200);
  });
});

describe("health", () => {
  for (const row of table("scoring.health").rows) {
    it(`${row.case}`, () => {
      const latest = row.latest_status?.trim();
      expect(
        goalHealth({
          closed: row.closed?.trim() === "yes",
          successStatus:
            row.success_status?.trim() === ""
              ? null
              : (row.success_status?.trim() as "achieved" | "missed"),
          latestStatus:
            latest === undefined || latest === ""
              ? null
              : (latest as "on_track" | "caution" | "off_track"),
          daysPastDue: cellNumber(row, "days_past_due"),
          graceDays: num(row, "grace_days"),
        }),
      ).toBe(row.expected);
    });
  }

  it("reads pending when there is no due date at all", () => {
    // A goal with no cadence yet cannot be stale, and calling it outdated would
    // punish somebody for a date nobody set.
    expect(goalHealth({ closed: false, daysPastDue: null, graceDays: 3 })).toBe(
      "pending",
    );
  });
});

describe("the progress signal", () => {
  for (const row of table("scoring.rag").rows) {
    it(`${row.case}`, () => {
      expect(
        progressSignal(num(row, "progress_pct"), {
          ...thresholds,
          "scoring.progressSignalPass": num(row, "pass_pct"),
          "scoring.progressSignalFail": num(row, "fail_pct"),
        }),
      ).toBe(row.expected);
    });
  }
});

describe("the trend forecast", () => {
  for (const row of table("scoring.forecast").rows) {
    it(`${row.case}`, () => {
      const points = json<[number, number][]>(row, "points").map(
        ([at, value]) => ({ at, value }),
      );
      const forecast = trendForecast(points, num(row, "horizon_day"), {
        direction: row.direction as KeyResultDirection,
        baseline: num(row, "baseline"),
        target: num(row, "target"),
      });

      const expected = row.expected_projected?.trim();
      if (expected === undefined || expected === "") {
        expect(forecast).toBeNull();
        return;
      }
      expect(forecast?.projected).toBe(Number(expected));
      expect(forecast?.trendingOffTrack).toBe(
        row.expected_trending?.trim() === "yes",
      );
    });
  }
});

describe("score bands and annotations", () => {
  for (const row of table("scoring.score-bands").rows) {
    it(`${row.case}`, () => {
      const score = num(row, "score");
      expect(scoreBand(score, thresholds)).toBe(row.expected_band);
      expect(scoreAnnotation(score, thresholds)).toBe(row.expected_annotation);
    });
  }
});

describe("the portfolio verdict", () => {
  for (const row of table("scoring.portfolio").rows) {
    it(`${row.case}`, () => {
      expect(portfolioVerdictOf(num(row, "average"), thresholds)).toBe(
        row.expected,
      );
    });
  }
});

describe("confidence bands", () => {
  for (const row of table("scoring.confidence-bands").rows) {
    it(`${row.case}`, () => {
      const verdict = confidenceBand(num(row, "confidence"), thresholds);
      expect(verdict.band).toBe(row.expected_band);
      expect(verdict.escalatesSameDay).toBe(
        row.escalates_same_day?.trim() === "yes",
      );
    });
  }
});

describe("the draft set verdict", () => {
  for (const row of table("scoring.draft-confidence").rows) {
    it(`${row.case}`, () => {
      expect(draftVerdict(num(row, "average"), thresholds)).toBe(row.expected);
    });
  }
});
