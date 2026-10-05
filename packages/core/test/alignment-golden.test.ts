import {
  type AlignmentGraph,
  type AlignmentScope,
  type AlignmentThresholds,
  alignmentBand,
  alignmentScore,
  canonThresholds,
  defaultPractice,
  enforceAlignment,
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
    /** The level of a parent outside the scope (P9-T16a). */
    readonly outside?: string;
    readonly standalone?: string;
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
      outsideParentLevel: goal.outside ?? null,
      standaloneReason: goal.standalone ?? null,
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

const canon: AlignmentThresholds = {
  healthy: thresholds["alignment.healthyThreshold"],
  watch: thresholds["alignment.watchThreshold"],
};

describe("the findings table", () => {
  const severityOf = new Map(
    table("alignment.findings").rows.map((row) => [
      row.rule_key as string,
      row.severity as string,
    ]),
  );
  const raised = table("alignment.score").rows.flatMap((row) => {
    const graph = cellJson<GoldenGraph>(row, "graph");
    return graph
      ? alignmentScore(toGraph(graph), toScope(row.scope as string), canon)
          .findings
      : [];
  });

  for (const [ruleKey, severity] of severityOf) {
    it(`${ruleKey} is raised by the matrix, at ${severity}`, () => {
      const mine = raised.filter((finding) => finding.ruleKey === ruleKey);
      // A row in this table that no score row exercises is a claim nothing
      // checks.
      expect(mine.length).toBeGreaterThan(0);
      for (const finding of mine) {
        expect(finding.severity).toBe(severity);
      }
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
        canon,
      );

      expect(result.score).toBe(cellNumber(row, "expected_score"));
      expect(result.band).toBe((row.expected_band as string) || null);

      // `<ruleKey>:<subject>`, sorted, with an empty subject for the
      // scope-level anchor finding.
      const actual = result.findings.map(
        (finding) => `${finding.ruleKey}:${finding.subjectGoalId ?? ""}`,
      );
      expect(actual).toEqual(cellList(row, "expected_findings"));
    });
  }
});

describe("the bands", () => {
  for (const row of table("alignment.band").rows) {
    it(row.case as string, () => {
      const score = cellNumber(row, "score");
      const healthy = cellNumber(row, "healthy");
      const watch = cellNumber(row, "watch");
      if (score === null || healthy === null || watch === null) {
        throw new Error("A band row needs all three numbers.");
      }
      expect(
        alignmentBand(score, { healthy, watch }, row.anchored === "yes"),
      ).toBe(row.expected);
    });
  }

  it("reads §11's own defaults", () => {
    expect(canon).toEqual({ healthy: 90, watch: 80 });
  });
});

describe("the acceptance case: a hundred goals, ninety-two counted", () => {
  // Too large for a table cell, which is the only reason it is here.
  const goals = [
    {
      id: "c",
      level: "company",
      parentGoalId: null,
      spaceId: null,
      keyResultCount: 2,
    },
    ...Array.from({ length: 100 }, (_, index) => ({
      id: `t${String(index).padStart(3, "0")}`,
      level: "team",
      parentGoalId: index < 80 ? "c" : null,
      // Twelve stand alone with a reason, and eight do neither.
      standaloneReason: index >= 80 && index < 92 ? "Regulatory work" : null,
      spaceId: "s1",
      keyResultCount: 2,
    })),
  ];
  const result = alignmentScore(
    { goals, goalDependencies: [], keyResultDependencies: [] },
    { kind: "workspace" },
    canon,
  );

  it("reads 92 and healthy", () => {
    expect(result.measured).toBe(100);
    expect(result.counted).toBe(92);
    expect(result.score).toBe(92);
    expect(result.band).toBe("healthy");
  });

  it("lists each of the eight", () => {
    const unaligned = result.findings.filter(
      (finding) => finding.ruleKey === "AL-1",
    );
    expect(unaligned.map((finding) => finding.subjectGoalId)).toEqual(
      Array.from({ length: 8 }, (_, index) => `t0${92 + index}`),
    );
  });

  it("weighs the same eight lightly in a company five times the size", () => {
    // The case the penalties got wrong: eight unaligned goals cost 96 points
    // whatever surrounded them, so this company sat at the floor beside a
    // ten-goal one.
    const large = alignmentScore(
      {
        goals: [
          goals[0] as (typeof goals)[number],
          ...Array.from({ length: 500 }, (_, index) => ({
            id: `l${index}`,
            level: "team",
            parentGoalId: index < 492 ? "c" : null,
            spaceId: "s1",
            keyResultCount: 2,
          })),
        ],
        goalDependencies: [],
        keyResultDependencies: [],
      },
      { kind: "workspace" },
      canon,
    );
    expect(large.score).toBe(98);
    expect(large.band).toBe("healthy");
  });
});

describe("every finding carries what a surface needs", () => {
  it("names a rule, a severity and a sentence", () => {
    const result = alignmentScore(
      toGraph({
        goals: [{ id: "d1", level: "department", space: "s1", krs: 0 }],
      }),
      { kind: "workspace" },
      canon,
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
      canon,
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
      canon,
    );
    expect(result.score).not.toBeNull();
  });
});

describe("the checks at their levels (P9-T16b-a)", () => {
  const skip = toGraph({
    goals: [
      { id: "c", level: "company", krs: 2 },
      { id: "t", level: "team", parent: "c", space: "s1", krs: 2 },
      { id: "d", level: "department", parent: "c", space: "s2", krs: 2 },
    ],
  });
  const rules = (graph: AlignmentGraph, levels?: readonly string[]) =>
    alignmentScore(
      graph,
      { kind: "workspace" },
      canon,
      levels ? { levels } : {},
    ).findings.map((finding) => `${finding.ruleKey}:${finding.subjectGoalId}`);

  it("measures a skip over the levels the cycle uses (G-3)", () => {
    expect(rules(skip)).toContain("AL-3:t");
    expect(rules(skip, ["company", "team"])).not.toContain("AL-3:t");
    // A level the cycle never began with still counts where a goal sits on
    // it: the department goal is measured from where it is.
    expect(
      rules(
        toGraph({
          goals: [
            { id: "c", level: "company", krs: 2 },
            { id: "i", level: "individual", parent: "c", space: "s1", krs: 2 },
          ],
        }),
        ["company", "team", "individual"],
      ),
    ).toContain("AL-3:i");
  });

  it("drops the findings of a check the practice turned off, and keeps the share", () => {
    const raw = alignmentScore(skip, { kind: "workspace" }, canon);
    const byDefault = enforceAlignment(raw, defaultPractice());
    // The skip, and the one department, which links to nobody.
    expect(raw.findings.map((finding) => finding.ruleKey)).toEqual([
      "AL-3",
      "AL-6",
    ]);
    expect(byDefault.findings).toEqual([]);
    expect(byDefault.score).toBe(raw.score);

    const strictCascade = enforceAlignment(raw, {
      ...defaultPractice(),
      "checks.AL-3": "warn",
    });
    expect(strictCascade.findings.map((finding) => finding.ruleKey)).toEqual([
      "AL-3",
    ]);
  });

  it("lets a contribution pass AL-1 while the share leaves the goal out", () => {
    const result = alignmentScore(
      {
        goals: [
          {
            id: "c",
            level: "company",
            parentGoalId: null,
            spaceId: null,
            keyResultCount: 2,
          },
          {
            id: "t",
            level: "team",
            parentGoalId: null,
            contributionStatement: "The supplier priority, through retail",
            spaceId: "s1",
            keyResultCount: 2,
          },
        ],
        goalDependencies: [],
        keyResultDependencies: [],
      },
      { kind: "workspace" },
      canon,
    );
    expect(result.findings).toEqual([]);
    expect(result.uncounted).toEqual(["t"]);
    expect(result.score).toBe(0);
  });

  it("warns AL-1 on a contribution under the minimum, parent or not", () => {
    const short = (contributionMinimum: number) =>
      alignmentScore(
        {
          goals: [
            {
              id: "c",
              level: "company",
              parentGoalId: null,
              spaceId: null,
              keyResultCount: 2,
            },
            {
              id: "t",
              level: "team",
              parentGoalId: "c",
              contributionStatement: "Grow revenue",
              spaceId: "s1",
              keyResultCount: 2,
            },
          ],
          goalDependencies: [],
          keyResultDependencies: [],
        },
        { kind: "workspace" },
        canon,
        { contributionMinimum, levels: ["company", "team"] },
      ).findings;
    expect(short(3)).toEqual([
      expect.objectContaining({
        ruleKey: "AL-1",
        condition: "Stated contribution under the contribution minimum",
        subjectGoalId: "t",
      }),
    ]);
    expect(short(2)).toEqual([]);
  });
});
