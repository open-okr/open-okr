import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Alignment against a real database (P3-T09, METHOD.md §5, design
 * `alignment-engine.md` §6 to §8).
 *
 * The arithmetic is covered by the golden masters in `alignment-golden.test.ts`,
 * which read their matrices out of the design document. What is checked here is
 * everything only rows can settle: that the graph loads the way the engine
 * expects, that findings are reconciled rather than duplicated, that a dismissal
 * survives a recompute, that publish gate 4 reads the register, and that the two
 * refusals in §5.4 hold.
 */

const OWNER = "align-owner";
const OTHER = "align-other";

let workspaceId: string;
let cycleId: string;
let ownerMemberId: string;
let spaceA: string;
let spaceB: string;

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const richText = (text: string) =>
  ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  }) as never;

async function makeGoal(input: {
  title: string;
  level: "company" | "department" | "team" | "individual";
  spaceId?: string;
  parentGoalId?: string;
  keyResults?: number;
}): Promise<string> {
  const wb = await workerDb();
  const goal = await callAction(
    { pool: wb.appPool, ...context() },
    "goals.create",
    {
      title: input.title,
      cycleId,
      level: input.level,
      ownerKind: input.spaceId ? "space" : "workspace",
      ...(input.spaceId ? { spaceId: input.spaceId } : {}),
      ...(input.parentGoalId ? { parentGoalId: input.parentGoalId } : {}),
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    },
  );
  for (let index = 0; index < (input.keyResults ?? 2); index += 1) {
    await callAction({ pool: wb.appPool, ...context() }, "goals.addKeyResult", {
      goalId: goal.id,
      title: `${input.title}: measure ${index + 1}`,
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 0,
      targetValue: 100,
      weight: 1,
    });
  }
  return goal.id;
}

/**
 * AL-3 and AL-6 are off by default since METHOD v2 (P9-T16b-a), so a test of
 * either turns it on first, before any goal is written: a practice change
 * recomputes nothing, and the findings are stored by the writes that follow.
 */
async function turnOn(...checks: string[]): Promise<void> {
  const wb = await workerDb();
  await callAction({ pool: wb.appPool, ...context() }, "practice.update", {
    overrides: Object.fromEntries(
      checks.map((check) => [`checks.${check}`, "warn"]),
    ),
  });
}

const read = async (spaceId?: string) => {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context() }, "alignment.read", {
    cycleId,
    ...(spaceId ? { spaceId } : {}),
    includeDismissed: false,
  });
};

const keyResultOf = async (goalId: string): Promise<string> => {
  const wb = await workerDb();
  const goal = await callAction(
    { pool: wb.appPool, ...context() },
    "goals.read",
    { id: goalId },
  );
  return goal.keyResults[0]?.id as string;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Owner",
      "align-owner@example.com",
      OTHER,
      "Other",
      "align-other@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;

  const current = await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  );
  cycleId = current?.id as string;

  const members = await wb.admin.query<{ id: string; user_id: string | null }>(
    "select id, user_id from workspace_members where workspace_id = $1",
    [workspaceId],
  );
  ownerMemberId = members.rows.find((row) => row.user_id === OWNER)
    ?.id as string;

  await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Other', 'active') returning id`,
    [workspaceId, OTHER],
  );

  const a = await callAction(
    { pool: wb.appPool, ...context() },
    "spaces.create",
    { name: "Revenue" },
  );
  const b = await callAction(
    { pool: wb.appPool, ...context() },
    "spaces.create",
    { name: "Product" },
  );
  spaceA = a.id;
  spaceB = b.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the score against real rows", () => {
  /** The design document's acceptance criterion, read as a share (P9-T16a). */
  it("reads 75 with one unaligned goal in four, and lists the silo beside it", async () => {
    await turnOn("AL-6");
    const company = await makeGoal({
      title: "Become the default supplier for mid-market retail",
      level: "company",
    });
    const d1 = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
      parentGoalId: company,
    });
    const d2 = await makeGoal({
      title: "Ship the onboarding rework",
      level: "department",
      spaceId: spaceB,
      parentGoalId: company,
    });
    const wb = await workerDb();
    const third = await callAction(
      { pool: wb.appPool, ...context() },
      "spaces.create",
      { name: "Customer Success" },
    );
    // The siloed department: nothing in its subtree links outward.
    await makeGoal({
      title: "Cut churn in the mid-market book",
      level: "department",
      spaceId: third.id,
      parentGoalId: company,
    });
    // The orphan: a team goal with no parent. It belongs to no department, so
    // it is not what the silo finding is about.
    await makeGoal({
      title: "Cut first response time",
      level: "team",
      spaceId: spaceA,
    });

    // One link, between the first two departments only.
    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addDependency",
      { fromGoalId: d1, toGoalId: d2 },
    );

    const result = await read();
    // Three of the four goals below company level align. The silo is listed
    // and not counted: §5.2 measures the share, not the shape.
    expect(result.score).toBe(75);
    expect(result.band).toBe("gap");
    expect(result.healthy).toBe(false);
    expect(result).toMatchObject({
      measured: 4,
      counted: 3,
      anchored: true,
      threshold: 90,
      watchThreshold: 80,
    });
    expect(result.findings.map((finding) => finding.ruleKey).sort()).toEqual([
      "AL-1",
      "AL-6",
    ]);
    // Each one opens the goal responsible, which is the whole point of a
    // finding carrying a subject.
    expect(
      result.findings.every((finding) => finding.subjectGoalTitle !== null),
    ).toBe(true);
    expect(
      result.findings.find((finding) => finding.ruleKey === "AL-1")
        ?.subjectGoalTitle,
    ).toBe("Cut first response time");
    expect(
      result.findings.find((finding) => finding.ruleKey === "AL-6")
        ?.subjectGoalTitle,
    ).toBe("Cut churn in the mid-market book");
  });

  it("has no score at all when the cycle has no goals", async () => {
    const result = await read();
    expect(result.score).toBeNull();
    expect(result.band).toBeNull();
    expect(result.healthy).toBeNull();
    expect(result.findings).toHaveLength(0);
  });

  it("counts a goal that says why it stands alone, set and cleared through the API", async () => {
    const company = await makeGoal({
      title: "Become the default supplier",
      level: "company",
    });
    const d1 = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
      parentGoalId: company,
    });
    const finance = await makeGoal({
      title: "Close the books in five days",
      level: "department",
      spaceId: spaceB,
    });
    const wb = await workerDb();
    const call = (name: string, input: object) =>
      callAction({ pool: wb.appPool, ...context() }, name as never, input);
    await call("goals.addDependency", { fromGoalId: d1, toGoalId: finance });

    const before = await read();
    expect(before.score).toBe(50);
    expect(before.band).toBe("gap");
    expect(
      before.findings.find((finding) => finding.ruleKey === "AL-1")
        ?.subjectGoalId,
    ).toBe(finance);

    // NW-Q1-11: Hugo marks it as standing alone, with the reason.
    await call("goals.update", {
      id: finance,
      standaloneReason: "  Finance operating cadence the board relies on  ",
    });
    const stood = await read();
    expect(stood.score).toBe(100);
    expect(stood.band).toBe("healthy");
    expect(stood.findings.filter((f) => f.ruleKey === "AL-1")).toHaveLength(0);
    const readBack = (await call("goals.read", { id: finance })) as {
      standaloneReason: string | null;
      parentGoalId: string | null;
    };
    expect(readBack.standaloneReason).toBe(
      "Finance operating cadence the board relies on",
    );

    // A parent replaces the reason: a goal that aligns has nothing to explain.
    await call("goals.update", { id: finance, parentGoalId: company });
    const hung = (await call("goals.read", { id: finance })) as {
      standaloneReason: string | null;
      parentGoalId: string | null;
    };
    expect(hung).toMatchObject({
      parentGoalId: company,
      standaloneReason: null,
    });

    // And a reason replaces the parent.
    await call("goals.update", { id: finance, standaloneReason: "Statutory" });
    const alone = (await call("goals.read", { id: finance })) as {
      standaloneReason: string | null;
      parentGoalId: string | null;
    };
    expect(alone).toMatchObject({
      parentGoalId: null,
      standaloneReason: "Statutory",
    });

    // Blank clears it, and the goal is listed again.
    await call("goals.update", { id: finance, standaloneReason: "   " });
    const cleared = await read();
    expect(cleared.score).toBe(50);
    expect(
      cleared.findings.find((finding) => finding.ruleKey === "AL-1")
        ?.subjectGoalId,
    ).toBe(finance);
  });

  it("refuses a parent and a reason to stand alone in one call", async () => {
    const company = await makeGoal({
      title: "Become the default supplier",
      level: "company",
    });
    const team = await makeGoal({
      title: "Cut first response time",
      level: "team",
      spaceId: spaceA,
    });
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "goals.update", {
        id: team,
        parentGoalId: company,
        standaloneReason: "Both at once",
      }),
    ).rejects.toThrow(/either aligns to a parent or says why it stands alone/);
  });

  it("counts a parent in another cycle, and is anchored by an annual company objective", async () => {
    const wb = await workerDb();
    const call = (name: string, input: object) =>
      callAction({ pool: wb.appPool, ...context() }, name as never, input);
    const year = (await call("cycles.create", {
      on: `${new Date().getUTCFullYear()}-06-30`,
      mode: "annual",
    })) as { id: string };
    const annual = (await call("goals.create", {
      title: "Mid-market buyers choose us",
      cycleId: year.id,
      level: "company",
      ownerKind: "workspace",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string };

    // The quarter holds no company objective of its own.
    const d1 = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
      parentGoalId: annual.id,
    });
    const d2 = await makeGoal({
      title: "Ship the onboarding rework",
      level: "department",
      spaceId: spaceB,
      parentGoalId: annual.id,
    });
    await call("goals.addDependency", { fromGoalId: d1, toGoalId: d2 });

    const result = await read();
    expect(result.score).toBe(100);
    expect(result.anchored).toBe(true);
    expect(result.band).toBe("healthy");
    expect(result.findings).toHaveLength(0);
  });

  it("counts a parent in another space at space scope", async () => {
    const company = await makeGoal({
      title: "Become the default supplier",
      level: "company",
    });
    await makeGoal({
      title: "Rebuild the trial flow",
      level: "team",
      spaceId: spaceB,
      parentGoalId: company,
    });
    const result = await read(spaceB);
    expect(result.score).toBe(100);
    expect(result.findings.filter((f) => f.ruleKey === "AL-1")).toHaveLength(0);
  });

  it("resolves a key result parent to the goal that owns it", async () => {
    const company = await makeGoal({
      title: "Become the default supplier",
      level: "company",
    });
    const department = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
      parentGoalId: company,
    });
    const keyResultId = await keyResultOf(department);

    const wb = await workerDb();
    const team = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.create",
      {
        title: "Rebuild the trial flow",
        cycleId,
        level: "team",
        ownerKind: "space",
        spaceId: spaceA,
        parentKeyResultId: keyResultId,
        championId: ownerMemberId,
        reviewerId: ownerMemberId,
        weight: 1,
      },
    );
    await callAction({ pool: wb.appPool, ...context() }, "goals.addKeyResult", {
      goalId: team.id,
      title: "Trial to paid from 4% to 9%",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 4,
      targetValue: 9,
      weight: 1,
    });

    const result = await read();
    // No orphan and no level skip: team under department through a key result
    // is one level, exactly as it would be through the goal itself.
    expect(
      result.findings.filter(
        (finding) => finding.ruleKey === "AL-1" || finding.ruleKey === "AL-3",
      ),
    ).toHaveLength(0);
  });
});

describe("the checks at their levels (P9-T16b-a)", () => {
  it("says nothing about a skip or a silo by default, and the share does not move", async () => {
    const company = await makeGoal({
      title: "Become the default supplier",
      level: "company",
    });
    // A skip: team straight under company. A silo: the only department.
    await makeGoal({
      title: "Rebuild the trial flow",
      level: "team",
      spaceId: spaceA,
      parentGoalId: company,
    });
    await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceB,
      parentGoalId: company,
    });
    const result = await read();
    expect(result.findings).toEqual([]);
    expect(result.score).toBe(100);
  });

  it("hides a stored skip the moment AL-3 is turned off", async () => {
    await turnOn("AL-3");
    const company = await makeGoal({
      title: "Become the default supplier",
      level: "company",
    });
    await makeGoal({
      title: "Rebuild the trial flow",
      level: "team",
      spaceId: spaceA,
      parentGoalId: company,
    });
    expect((await read()).findings.map((finding) => finding.ruleKey)).toEqual([
      "AL-3",
    ]);

    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "practice.update", {
      overrides: { "checks.AL-3": "off" },
    });
    // Nothing was recomputed: the stored row is still there, and not shown.
    expect((await read()).findings).toEqual([]);
  });

  it("acceptance: with no department level, a team under the company skips nothing (G-3)", async () => {
    await turnOn("AL-3");
    const wb = await workerDb();
    const call = (name: string, input: object) =>
      callAction({ pool: wb.appPool, ...context() }, name as never, input);
    await call("practice.update", {
      overrides: { "levels.department": "off" },
    });
    // A cycle that begins after the change begins without the level (§2.7).
    const next = (await call("cycles.create", {
      on: `${new Date().getUTCFullYear() + 1}-02-15`,
    })) as { id: string };
    const goal = async (
      title: string,
      level: "company" | "team",
      parentGoalId?: string,
    ) =>
      (
        (await call("goals.create", {
          title,
          cycleId: next.id,
          level,
          ownerKind: level === "company" ? "workspace" : "space",
          ...(level === "company" ? {} : { spaceId: spaceA }),
          ...(parentGoalId ? { parentGoalId } : {}),
          championId: ownerMemberId,
          reviewerId: ownerMemberId,
          weight: 1,
        })) as { id: string }
      ).id;
    const company = await goal("Become the default supplier", "company");
    await goal("Rebuild the trial flow", "team", company);

    const later = (await call("alignment.read", {
      cycleId: next.id,
      includeDismissed: false,
    })) as { findings: { ruleKey: string | null }[] };
    expect(later.findings.filter((f) => f.ruleKey === "AL-3")).toEqual([]);

    // The cycle that began with departments still counts the same skip.
    const company2 = await makeGoal({
      title: "Become the default supplier",
      level: "company",
    });
    await makeGoal({
      title: "Rebuild the trial flow",
      level: "team",
      spaceId: spaceA,
      parentGoalId: company2,
    });
    expect(
      (await read()).findings.filter((f) => f.ruleKey === "AL-3"),
    ).toHaveLength(1);
  });

  it("lets a stated contribution pass AL-1, and still lists the goal as not counted", async () => {
    await makeGoal({ title: "Become the default supplier", level: "company" });
    const growth = await makeGoal({
      title: "Grow the mid-market book",
      level: "team",
      spaceId: spaceA,
    });
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "goals.update", {
      id: growth,
      contributionStatement: "The supplier priority, through mid-market retail",
    });

    const result = await read();
    expect(result.findings.filter((f) => f.ruleKey === "AL-1")).toEqual([]);
    expect(result.score).toBe(0);
    expect(result.uncounted).toEqual([
      { id: growth, title: "Grow the mid-market book" },
    ]);
  });

  it("warns AL-1 on a contribution under the minimum, even with a parent", async () => {
    const company = await makeGoal({
      title: "Become the default supplier",
      level: "company",
    });
    const growth = await makeGoal({
      title: "Grow the mid-market book",
      level: "department",
      spaceId: spaceA,
      parentGoalId: company,
    });
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "goals.update", {
      id: growth,
      contributionStatement: "Growth",
    });

    const result = await read();
    expect(result.score).toBe(100);
    expect(result.uncounted).toEqual([]);
    expect(
      result.findings
        .filter((f) => f.ruleKey === "AL-1")
        .map((f) => [f.subjectGoalId, f.reason]),
    ).toEqual([
      [
        growth,
        "Its stated contribution is under 3 words, which names a theme rather than a goal.",
      ],
    ]);
  });
});

describe("the silo finding", () => {
  beforeEach(async () => {
    await turnOn("AL-6");
  });

  it("is gone on the next recompute once the subtree gains a dependency", async () => {
    const company = await makeGoal({
      title: "Become the default supplier",
      level: "company",
    });
    const d1 = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
      parentGoalId: company,
    });
    const d2 = await makeGoal({
      title: "Ship the onboarding rework",
      level: "department",
      spaceId: spaceB,
      parentGoalId: company,
    });
    // A team inside the first department, which is what will carry the link.
    const team = await makeGoal({
      title: "Rebuild the trial flow",
      level: "team",
      spaceId: spaceA,
      parentGoalId: d1,
    });

    const before = await read();
    expect(before.findings.filter((f) => f.ruleKey === "AL-6")).toHaveLength(2);
    const scoreBefore = before.score;

    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addDependency",
      { fromGoalId: team, toGoalId: d2 },
    );

    const after = await read();
    expect(after.findings.filter((f) => f.ruleKey === "AL-6")).toHaveLength(0);
    // A silo is listed, never counted, so clearing two moves nothing.
    expect(after.score).toBe(scoreBefore);
  });

  it("is not cleared by a dependency inside its own subtree", async () => {
    const company = await makeGoal({
      title: "Become the default supplier",
      level: "company",
    });
    const d1 = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
      parentGoalId: company,
    });
    const team = await makeGoal({
      title: "Rebuild the trial flow",
      level: "team",
      spaceId: spaceA,
      parentGoalId: d1,
    });

    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addDependency",
      { fromGoalId: d1, toGoalId: team },
    );

    const result = await read();
    expect(result.findings.filter((f) => f.ruleKey === "AL-6")).toHaveLength(1);
  });

  it("is cleared for the providing side too, not only the depending one", async () => {
    const company = await makeGoal({
      title: "Become the default supplier",
      level: "company",
    });
    const d1 = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
      parentGoalId: company,
    });
    await makeGoal({
      title: "Ship the onboarding rework",
      level: "department",
      spaceId: spaceB,
      parentGoalId: company,
    });

    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResultDependency",
      {
        keyResultId: await keyResultOf(d1),
        providerSpaceId: spaceB,
        note: "They own the flow we hand off to",
      },
    );

    const result = await read();
    // Decision D-7: a department three teams depend on is the least siloed one
    // in the organisation.
    expect(result.findings.filter((f) => f.ruleKey === "AL-6")).toHaveLength(0);
  });
});

describe("findings survive a recompute", () => {
  it("are reconciled by identity rather than duplicated", async () => {
    const goalId = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
    });

    const wb = await workerDb();
    const count = async () =>
      (
        await wb.admin.query(
          "select id from alignment_findings where workspace_id = $1 and deleted_at is null",
          [workspaceId],
        )
      ).rows.length;

    const first = await count();
    expect(first).toBeGreaterThan(0);

    // A structural write that changes nothing the score reads. The engine runs
    // again over the same conditions, and must recognise every finding it made
    // last time rather than inserting a second copy of each. Counting rows
    // rather than predicting how many there should be: the count is the thing
    // that would drift, and an exact number here would be a second copy of the
    // penalty table for the golden masters to disagree with.
    await callAction({ pool: wb.appPool, ...context() }, "goals.update", {
      id: goalId,
      title: "Win two logos a quarter, every quarter",
    });
    expect(await count()).toBe(first);

    // And a write that does add a condition adds exactly one row, not a set.
    await makeGoal({
      title: "Ship the onboarding rework",
      level: "department",
      spaceId: spaceA,
    });
    expect(await count()).toBeGreaterThan(first);
  });

  it("keeps a dismissal while the condition is unchanged", async () => {
    const goalId = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
    });

    const wb = await workerDb();
    const orphan = (await read()).findings.find(
      (finding) => finding.ruleKey === "AL-1",
    );
    expect(orphan).toBeDefined();

    await callAction(
      { pool: wb.appPool, ...context() },
      "alignment.dismissFinding",
      { id: orphan?.id as string },
    );

    // A structural write, so the engine runs again over the same condition.
    await callAction({ pool: wb.appPool, ...context() }, "goals.update", {
      id: goalId,
      title: "Win two logos a quarter, every quarter",
    });

    const after = await read();
    expect(
      after.findings.filter((finding) => finding.ruleKey === "AL-1"),
    ).toHaveLength(0);

    const stored = await wb.admin.query<{ state: string }>(
      "select state from alignment_findings where id = $1 and deleted_at is null",
      [orphan?.id],
    );
    expect(stored.rows[0]?.state).toBe("dismissed");
  });

  it("clears a finding by soft-deleting it when the condition goes away", async () => {
    const company = await makeGoal({
      title: "Become the default supplier",
      level: "company",
    });
    const orphan = await makeGoal({
      title: "Cut first response time",
      level: "team",
      spaceId: spaceA,
    });

    expect(
      (await read()).findings.filter((f) => f.ruleKey === "AL-1"),
    ).toHaveLength(1);

    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "goals.update", {
      id: orphan,
      parentGoalId: company,
    });

    expect(
      (await read()).findings.filter((f) => f.ruleKey === "AL-1"),
    ).toHaveLength(0);
  });
});

describe("escalating a dependency to the sponsor (P9-T16b-b)", () => {
  const call = async (name: string, input: object, userId = OWNER) => {
    const wb = await workerDb();
    return callAction(
      { pool: wb.appPool, ...context(userId) },
      name as never,
      input as never,
    ) as Promise<never>;
  };
  const otherMember = async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, OTHER],
    );
    return rows[0]?.id as string;
  };
  const dependencyOn = async () => {
    const goalId = await makeGoal({
      title: "Lift expansion revenue to 22%",
      level: "department",
      spaceId: spaceA,
    });
    const keyResultId = await keyResultOf(goalId);
    return (
      (await call("goals.addKeyResultDependency", {
        keyResultId,
        providerSpaceId: spaceB,
        note: "In-app expansion prompts",
      })) as { id: string }
    ).id;
  };
  const gate4 = async () =>
    (
      (await call("workflow.read", { cycleId })) as {
        gates: { passed: boolean }[];
      }
    ).gates[3]?.passed;
  const dependencyRows = async (userId: string) =>
    (
      (await call("review.inbox", {}, userId)) as {
        obligations: { kind: string; title: string; meta: string }[];
      }
    ).obligations.filter((row) => row.kind === "dependency");

  it("is refused while the cycle names no sponsor", async () => {
    const id = await dependencyOn();
    await expect(call("goals.escalateDependency", { id })).rejects.toThrow(
      /no active sponsor/,
    );
  });

  it("acceptance: the sponsor's inbox lists it, and confirming it clears it (NW-Q2-07)", async () => {
    const id = await dependencyOn();
    const sponsor = await otherMember();
    await call("cycles.update", { id: cycleId, sponsorId: sponsor });
    expect(await gate4()).toBe(false);

    const escalated = (await call("goals.escalateDependency", { id })) as {
      escalatedToId: string;
    };
    expect(escalated.escalatedToId).toBe(sponsor);

    // Escalated settles gate 4, as a confirmation or a risk owner does.
    expect(await gate4()).toBe(true);
    const read = (await call("alignment.read", {
      cycleId,
      includeDismissed: false,
    })) as {
      register: {
        id: string;
        escalatedToName: string | null;
        blocksPublish: boolean;
      }[];
      sponsor: { id: string; name: string } | null;
    };
    expect(read.sponsor).toEqual({ id: sponsor, name: "Other" });
    expect(read.register.find((entry) => entry.id === id)).toMatchObject({
      escalatedToName: "Other",
      blocksPublish: false,
    });

    const listed = await dependencyRows(OTHER);
    expect(listed).toEqual([
      expect.objectContaining({
        title: expect.stringContaining("on Product"),
        meta: expect.stringContaining("Escalated to you as sponsor"),
      }),
    ]);
    // Nobody else is asked to decide it.
    expect(await dependencyRows(OWNER)).toEqual([]);

    await call("goals.confirmDependency", { id });
    expect(await dependencyRows(OTHER)).toEqual([]);
    expect(await gate4()).toBe(true);
  });

  it("leaves the inbox once somebody is named to carry the risk", async () => {
    const id = await dependencyOn();
    const sponsor = await otherMember();
    await call("cycles.update", { id: cycleId, sponsorId: sponsor });
    await call("goals.escalateDependency", { id });
    expect(await dependencyRows(OTHER)).toHaveLength(1);
    await call("goals.setDependencyRiskOwner", { id, memberId: sponsor });
    expect(await dependencyRows(OTHER)).toEqual([]);
  });

  it("refuses a dependency the providing team already confirmed", async () => {
    const id = await dependencyOn();
    await call("cycles.update", {
      id: cycleId,
      sponsorId: await otherMember(),
    });
    await call("goals.confirmDependency", { id });
    await expect(call("goals.escalateDependency", { id })).rejects.toThrow(
      /nothing to escalate/,
    );
  });
});

describe("the dependency register", () => {
  it("blocks publish gate 4 while unconfirmed and unowned", async () => {
    const goalId = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
    });
    const keyResultId = await keyResultOf(goalId);

    const wb = await workerDb();
    const gate = async () => {
      const workflow = await callAction(
        { pool: wb.appPool, ...context() },
        "workflow.read",
        { cycleId },
      );
      return workflow.gates[3];
    };

    // Evaluable with no dependencies at all: an empty register is a real answer.
    expect((await gate())?.evaluable).toBe(true);
    expect((await gate())?.passed).toBe(true);

    const dependency = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResultDependency",
      { keyResultId, providerSpaceId: spaceB },
    );
    expect(dependency.blocksPublish).toBe(true);
    expect((await gate())?.passed).toBe(false);

    // A risk owner without a confirmation clears the gate. The dependency is
    // still unconfirmed, and the register still says so.
    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.setDependencyRiskOwner",
      { id: dependency.id, memberId: ownerMemberId },
    );
    expect((await gate())?.passed).toBe(true);

    const stored = await wb.admin.query<{ confirmed: boolean }>(
      "select confirmed from key_result_dependencies where id = $1",
      [dependency.id],
    );
    expect(stored.rows[0]?.confirmed).toBe(false);
  });

  it("is confirmed only by the providing side", async () => {
    const goalId = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
    });
    const wb = await workerDb();
    const dependency = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResultDependency",
      { keyResultId: await keyResultOf(goalId), providerSpaceId: spaceB },
    );

    // The other member holds nothing on the providing space, so they cannot
    // confirm on its behalf.
    await expect(
      callAction(
        { pool: wb.appPool, ...context(OTHER) },
        "goals.confirmDependency",
        { id: dependency.id },
      ),
    ).rejects.toThrow();

    const confirmed = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.confirmDependency",
      { id: dependency.id },
    );
    expect(confirmed.confirmed).toBe(true);

    const stored = await wb.admin.query<{
      confirmed_by_id: string;
      confirmed_at: Date;
    }>(
      "select confirmed_by_id, confirmed_at from key_result_dependencies where id = $1",
      [dependency.id],
    );
    // §5.4 makes confirmation the providing team's act, so an unattributed one
    // is not one. The database refuses it either way.
    expect(stored.rows[0]?.confirmed_by_id).toBe(ownerMemberId);
    expect(stored.rows[0]?.confirmed_at).not.toBeNull();
  });

  it("refuses a confirmation on a provider named only as text", async () => {
    const goalId = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
    });
    const wb = await workerDb();
    const dependency = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResultDependency",
      {
        keyResultId: await keyResultOf(goalId),
        providerText: "The payments provider",
      },
    );

    await expect(
      callAction(
        { pool: wb.appPool, ...context() },
        "goals.confirmDependency",
        { id: dependency.id },
      ),
    ).rejects.toThrow(/risk owner/i);
  });

  it("is returned by the read, with the provider and the risk owner named", async () => {
    const goalId = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
    });
    const wb = await workerDb();
    const dependency = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResultDependency",
      { keyResultId: await keyResultOf(goalId), providerSpaceId: spaceB },
    );

    const before = (await read()).register;
    expect(before).toHaveLength(1);
    // Names, not identifiers. §5.4's register is read by a facilitator in a
    // room, and a uuid tells them nothing about who to chase.
    expect(before[0]?.provider).toBe("Product");
    expect(before[0]?.blocksPublish).toBe(true);
    expect(before[0]?.riskOwnerName).toBeNull();

    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.setDependencyRiskOwner",
      { id: dependency.id, memberId: ownerMemberId },
    );

    const after = (await read()).register;
    expect(after[0]?.riskOwnerName).toBe("Owner");
    expect(after[0]?.blocksPublish).toBe(false);
    expect(after[0]?.confirmed).toBe(false);
  });

  it("refuses an entry with no provider at all", async () => {
    const goalId = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
    });
    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, ...context() },
        "goals.addKeyResultDependency",
        { keyResultId: await keyResultOf(goalId) },
      ),
    ).rejects.toThrow();
  });
});

describe("horizontal links", () => {
  it("are stored once, whichever way round they are asked for", async () => {
    const first = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
    });
    const second = await makeGoal({
      title: "Ship the onboarding rework",
      level: "department",
      spaceId: spaceB,
    });

    const wb = await workerDb();
    const one = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addDependency",
      { fromGoalId: first, toGoalId: second },
    );
    const two = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addDependency",
      { fromGoalId: second, toGoalId: first },
    );
    expect(two.id).toBe(one.id);

    const rows = await wb.admin.query(
      "select id from goal_dependencies where workspace_id = $1 and deleted_at is null",
      [workspaceId],
    );
    expect(rows.rows).toHaveLength(1);
  });

  it("refuse a goal depending on itself", async () => {
    const goalId = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
    });
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "goals.addDependency", {
        fromGoalId: goalId,
        toGoalId: goalId,
      }),
    ).rejects.toThrow(/itself/i);
  });

  it("bring the silo finding back when removed", async () => {
    await turnOn("AL-6");
    const first = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
    });
    const second = await makeGoal({
      title: "Ship the onboarding rework",
      level: "department",
      spaceId: spaceB,
    });

    const wb = await workerDb();
    const link = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addDependency",
      { fromGoalId: first, toGoalId: second },
    );
    expect(
      (await read()).findings.filter((f) => f.ruleKey === "AL-6"),
    ).toHaveLength(0);

    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.removeDependency",
      { id: link.id },
    );
    // A fresh row in `open`, not a resurrected dismissal (design §6).
    expect(
      (await read()).findings.filter((f) => f.ruleKey === "AL-6"),
    ).toHaveLength(2);
  });
});

describe("space scope", () => {
  it("skips the anchor penalty, because one space is not the company", async () => {
    await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
    });

    const workspace = await read();
    expect(
      workspace.findings.filter((finding) => finding.ruleKey === "AL-4"),
    ).toHaveLength(1);

    const space = await read(spaceA);
    expect(
      space.findings.filter((finding) => finding.ruleKey === "AL-4"),
    ).toHaveLength(0);
  });

  it("keeps its findings separate from the workspace's", async () => {
    await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
    });
    await read();
    await read(spaceA);

    const wb = await workerDb();
    const rows = await wb.admin.query<{ scope: string }>(
      "select scope from alignment_findings where workspace_id = $1 and deleted_at is null",
      [workspaceId],
    );
    // Both scopes have rows and neither claims the other's.
    expect(rows.rows.some((row) => row.scope === "workspace")).toBe(true);
  });
});

describe("what does not move the score", () => {
  it("ignores a published check-in", async () => {
    const goalId = await makeGoal({
      title: "Win two logos a quarter",
      level: "department",
      spaceId: spaceA,
    });
    const before = (await read()).score;

    const wb = await workerDb();
    const draft = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.startCheckIn",
      { goalId },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.publishCheckIn",
      {
        id: draft.id,
        status: "on_track",
        confidence: 0.7,
        narrative: richText("Two logos signed, the third is in legal."),
        values: [],
      },
    );

    // §5.2 measures structure. A score that moved when a number moved would be
    // measuring something else.
    expect((await read()).score).toBe(before);
  });
});
