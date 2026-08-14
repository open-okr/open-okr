import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Alignment against a real database (P3-T09, METHOD.md §5, design
 * `p3-t00-alignment-engine.md` §6 to §8).
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
  /** The design document's acceptance criterion, and the plan's own example. */
  it("reads 80 with one orphan and one siloed department", async () => {
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
    // 100 minus 12 for the orphan and 8 for the silo, which is the number the
    // plan itself quotes and the design document's acceptance criterion.
    expect(result.score).toBe(80);
    expect(result.healthy).toBe(true);
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
    expect(result.healthy).toBeNull();
    expect(result.findings).toHaveLength(0);
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

describe("the silo finding", () => {
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
    const scoreBefore = before.score as number;

    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addDependency",
      { fromGoalId: team, toGoalId: d2 },
    );

    const after = await read();
    expect(after.findings.filter((f) => f.ruleKey === "AL-6")).toHaveLength(0);
    // Two silos cleared at 8 each.
    expect(after.score).toBe(scoreBefore + 16);
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
