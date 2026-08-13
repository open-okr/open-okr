import {
  type AlignmentGraph,
  type AlignmentPenalties,
  type AlignmentScope,
  alignmentHealthy,
  alignmentScore,
  canonThresholds,
} from "@openokr/method";
import {
  cellJson,
  cellList,
  cellNumber,
  loadGoldenTables,
} from "@openokr/test-support/golden-table";
import { describe, expect, it } from "vitest";

/**
 * The alignment engine against its own golden masters (P3-T09).
 *
 * In `packages/core` rather than `packages/method`, where the functions live,
 * for the reason recorded at P3-T05: the golden-table reader lives in
 * `packages/test-support`, which depends on core, so a method test that used it
 * would make the workspace graph circular.
 *
 * Every matrix is read out of `docs/design/p3-t00-alignment-engine.md` at run
 * time rather than retyped. That document is the fixture.
 */

const thresholds = canonThresholds();

const tables = loadGoldenTables(
  new URL(
    "../../../docs/design/p3-t00-alignment-engine.md",
    import.meta.url,
  ).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);

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

/** The graph notation the design document's §4 defines. */
interface GoldenGraph {
  readonly goals: readonly {
    readonly id: string;
    readonly level: string;
    /** A goal id, or `kr:<goalId>` for a key result parent. */
    readonly parent?: string;
    readonly space?: string;
    readonly krs: number;
    readonly closed?: boolean;
  }[];
  readonly goalDeps?: readonly (readonly [string, string])[];
  readonly krDeps?: readonly {
    readonly goal: string;
    readonly providerSpace: string;
  }[];
}

/**
 * The notation into the engine's own input.
 *
 * The one translation that carries a rule: `kr:<goalId>` resolves to that goal,
 * because §3.4 says a key result parent takes the level of the goal that owns
 * it. The engine never learns which kind of pointer it was, which is why it has
 * no branch for it.
 */
function toGraph(golden: GoldenGraph): AlignmentGraph {
  return {
    goals: golden.goals.map((goal) => ({
      id: goal.id,
      level: goal.level,
      parentGoalId: goal.parent
        ? goal.parent.startsWith("kr:")
          ? goal.parent.slice(3)
          : goal.parent
        : null,
      spaceId: goal.space ?? null,
      keyResultCount: goal.krs,
      closed: goal.closed ?? false,
    })),
    goalDependencies: (golden.goalDeps ?? []).map(([from, to]) => ({
      from,
      to,
    })),
    keyResultDependencies: (golden.krDeps ?? []).map((dependency) => ({
      goalId: dependency.goal,
      providerSpaceId: dependency.providerSpace,
    })),
  };
}

function toScope(raw: string): AlignmentScope {
  if (raw === "workspace") {
    return { kind: "workspace" };
  }
  const [kind, spaceId] = raw.split(":");
  if (kind !== "space" || !spaceId) {
    throw new Error(`Unreadable scope in a golden row: "${raw}".`);
  }
  return { kind: "space", spaceId };
}

const penalties = thresholds["alignment.penalties"] as AlignmentPenalties;

describe("the penalty table", () => {
  /**
   * The matrix is the §11 registry's own defaults, so this proves the two agree
   * rather than proving arithmetic. A penalty edited in METHOD.md and not in the
   * registry fails here, which is the whole point of P4-T01's conformance suite
   * arriving early for this one parameter.
   */
  const byFinding: Readonly<Record<string, keyof AlignmentPenalties>> = {
    "AL-4": "noAnchor",
    "AL-1": "orphan",
    "KR-1": "noKeyResults",
    "AL-3": "levelSkip",
    "AL-6": "silo",
  };

  for (const row of table("alignment.penalties").rows) {
    const ruleKey = row.rule_key as string;
    it(`${ruleKey} costs what §11 says it costs`, () => {
      const key = byFinding[ruleKey];
      expect(key).toBeDefined();
      expect(penalties[key as keyof AlignmentPenalties]).toBe(
        cellNumber(row, "penalty"),
      );
    });
  }
});

describe("the score", () => {
  for (const row of table("alignment.score").rows) {
    it(row.case as string, () => {
      const graph = cellJson<GoldenGraph>(row, "graph");
      if (!graph) {
        throw new Error("A score row needs its graph.");
      }
      const result = alignmentScore(
        toGraph(graph),
        toScope(row.scope as string),
        penalties,
      );

      expect(result.score).toBe(cellNumber(row, "expected_score"));

      // `<ruleKey>:<subject>`, sorted, with an empty subject for the
      // scope-level anchor finding.
      const actual = result.findings.map(
        (finding) => `${finding.ruleKey}:${finding.subjectGoalId ?? ""}`,
      );
      expect(actual).toEqual(cellList(row, "expected_findings"));
    });
  }
});

describe("the healthy threshold", () => {
  for (const row of table("alignment.health").rows) {
    it(row.case as string, () => {
      const score = cellNumber(row, "score");
      const threshold = cellNumber(row, "threshold");
      if (score === null || threshold === null) {
        throw new Error("A health row needs both numbers.");
      }
      expect(alignmentHealthy(score, threshold)).toBe(
        row.expected === "healthy",
      );
    });
  }
});

describe("every finding carries what a surface needs", () => {
  it("names a rule, a severity and a sentence", () => {
    const result = alignmentScore(
      toGraph({
        goals: [{ id: "d1", level: "department", space: "s1", krs: 0 }],
      }),
      { kind: "workspace" },
      penalties,
    );
    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) {
      expect(finding.ruleKey).toMatch(/^(AL-1|AL-3|AL-4|AL-6|KR-1)$/);
      expect(["high", "medium", "low"]).toContain(finding.severity);
      // A finding a facilitator cannot read is a number with no argument.
      expect(finding.reason.length).toBeGreaterThan(10);
      expect(finding.reason.endsWith(".")).toBe(true);
    }
  });

  it("gives the anchor finding no subject, because no goal caused it", () => {
    const result = alignmentScore(
      toGraph({
        goals: [{ id: "d1", level: "department", space: "s1", krs: 2 }],
      }),
      { kind: "workspace" },
      penalties,
    );
    const anchor = result.findings.find(
      (finding) => finding.ruleKey === "AL-4",
    );
    expect(anchor?.subjectGoalId).toBeNull();
  });

  it("survives a parent cycle rather than hanging on it", () => {
    // Unreachable through the interface, reachable through a bad import.
    const result = alignmentScore(
      {
        goals: [
          {
            id: "a",
            level: "department",
            parentGoalId: "b",
            spaceId: "s1",
            keyResultCount: 2,
          },
          {
            id: "b",
            level: "department",
            parentGoalId: "a",
            spaceId: "s1",
            keyResultCount: 2,
          },
        ],
        goalDependencies: [],
        keyResultDependencies: [],
      },
      { kind: "workspace" },
      penalties,
    );
    expect(result.score).not.toBeNull();
  });
});
