import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Kinds of key result in the data (METHOD.md §2.10, P9-T12b).
 *
 * A milestone or a baseline is written without numbers and reads its
 * progress from being done; a baseline is done by its first value; a kind
 * the workspace turned off is refused; and an objective's progress counts
 * the goals aligned beneath it only where the workspace says so (§3.1).
 */

const OWNER = "kinds-owner";

let workspaceId: string;
let ownerMemberId: string;
let quarterId: string;

async function call<T>(action: string, input: unknown): Promise<T> {
  return (await callAction(
    {
      pool: (await workerDb()).appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    action as never,
    input as never,
  )) as T;
}

async function objective(
  title: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  return (
    await call<{ id: string }>("goals.create", {
      title,
      cycleId: quarterId,
      level: "team",
      ownerKind: "workspace",
      championId: ownerMemberId,
      ...extra,
    })
  ).id;
}

interface ReadKeyResult {
  id: string;
  kind: string;
  doneAt: string | null;
  progressPct: number;
  baselineValue: number;
  currentValue: number;
  qualityFlags: string[];
}

async function read(goalId: string) {
  return call<{ progressPct: number; keyResults: ReadKeyResult[] }>(
    "goals.read",
    { id: goalId },
  );
}

async function keyResultOf(goalId: string, id: string) {
  return (await read(goalId)).keyResults.find((entry) => entry.id === id);
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Priya Owner", `${OWNER}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Priya Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  const year = new Date().getUTCFullYear() + 2;
  quarterId = (
    await call<{ id: string }>("cycles.create", {
      on: `${year}-05-15`,
      mode: "quarterly",
    })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a milestone", () => {
  it("acceptance: is written without numbers, and marking it done moves it and its objective to done", async () => {
    const goalId = await objective("Keep the whole team safe this season");
    const { id } = await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "No one on the team experienced a major injury",
      kind: "milestone",
      indicatorType: "lagging",
      dueOn: "2030-06-30",
      ownerId: ownerMemberId,
    });
    expect((await keyResultOf(goalId, id))?.progressPct).toBe(0);
    // A milestone has no target to miss and nothing to measure: KR-2 and
    // KR-3 pass on its date and owner (METHOD.md §4.2).
    const flags = (await keyResultOf(goalId, id))?.qualityFlags ?? [];
    expect(flags).not.toContain("KR-2");
    expect(flags).not.toContain("KR-3");

    await call("goals.updateKeyResult", { id, done: true });
    const done = await keyResultOf(goalId, id);
    expect(done?.kind).toBe("milestone");
    expect(done?.doneAt).not.toBeNull();
    expect(done?.progressPct).toBe(100);
    expect((await read(goalId)).progressPct).toBe(100);

    await call("goals.updateKeyResult", { id, done: false });
    expect((await keyResultOf(goalId, id))?.progressPct).toBe(0);
  });

  it("is marked done through the list's patch, compared like any other field", async () => {
    const goalId = await objective("Launch the partner programme");
    const { id } = await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "The partner programme is open to applications",
      kind: "milestone",
      indicatorType: "lagging",
    });
    await call("goals.patchKeyResult", {
      id,
      set: { done: true },
      read: { done: false },
    });
    expect((await keyResultOf(goalId, id))?.progressPct).toBe(100);
    // Read as not done by somebody who had not seen it done: refused.
    await expect(
      call("goals.patchKeyResult", {
        id,
        set: { done: false },
        read: { done: false },
      }),
    ).rejects.toThrow();
  });

  it("refuses done on a metric, which reads its number instead", async () => {
    const goalId = await objective("Grow activation");
    const { id } = await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "Activation from 30% to 45%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 30,
      targetValue: 45,
    });
    await expect(
      call("goals.updateKeyResult", { id, done: true }),
    ).rejects.toThrow(/Only a milestone or a baseline/);
  });

  it("is done with a check-in that says so", async () => {
    const goalId = await objective("Open the Kuala Lumpur office");
    const { id } = await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "The office lease is signed",
      kind: "milestone",
      indicatorType: "lagging",
    });
    await call("goals.publishDraftedCheckIn", {
      goalId,
      status: "on_track",
      confidence: 0.8,
      narrative: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Signed." }] },
        ],
      },
      values: [{ keyResultId: id, done: true }],
    });
    expect((await keyResultOf(goalId, id))?.progressPct).toBe(100);
  });
});

describe("a baseline", () => {
  it("is recorded by its first value, which becomes its baseline, and no later value moves that", async () => {
    const goalId = await objective("Know how teams use the product");
    const { id } = await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "Establish the baseline for weekly active teams",
      kind: "baseline",
      indicatorType: "lagging",
    });
    expect((await keyResultOf(goalId, id))?.progressPct).toBe(0);

    await call("goals.recordValue", { id, value: 412 });
    const recorded = await keyResultOf(goalId, id);
    expect(recorded?.doneAt).not.toBeNull();
    expect(recorded?.baselineValue).toBe(412);
    expect(recorded?.progressPct).toBe(100);

    await call("goals.recordValue", { id, value: 450 });
    const later = await keyResultOf(goalId, id);
    expect(later?.baselineValue).toBe(412);
    expect(later?.currentValue).toBe(450);
  });
});

describe("the kind on a key result", () => {
  it("is maintain for a key result written with a maintain direction, as before kinds", async () => {
    const goalId = await objective("Keep the service up");
    const { id } = await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "Hold uptime between 99.5% and 99.9%",
      direction: "maintain",
      indicatorType: "lagging",
      baselineValue: 99.5,
      targetValue: 99.9,
      currentValue: 99.7,
    });
    const keyResult = await keyResultOf(goalId, id);
    expect(keyResult?.kind).toBe("maintain");
    expect(keyResult?.progressPct).toBe(100);
  });

  it("asks a metric for its numbers", async () => {
    const goalId = await objective("Grow activation");
    await expect(
      call("goals.addKeyResult", {
        goalId,
        title: "Activation grows",
        indicatorType: "lagging",
      }),
    ).rejects.toThrow();
  });

  it("is refused where the workspace has turned that kind off, citing the setting", async () => {
    await call("practice.update", {
      overrides: { "keyResultKinds.milestone": "off" },
    });
    const goalId = await objective("Launch the partner programme");
    await expect(
      call("goals.addKeyResult", {
        goalId,
        title: "The partner programme is open",
        kind: "milestone",
        indicatorType: "lagging",
      }),
    ).rejects.toThrow(/does not use milestone key results/);
  });

  it("clears done when a milestone becomes a metric", async () => {
    const goalId = await objective("Launch the partner programme");
    const { id } = await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "The partner programme is open",
      kind: "milestone",
      indicatorType: "lagging",
    });
    await call("goals.updateKeyResult", { id, done: true });
    await call("goals.updateKeyResult", {
      id,
      kind: "metric",
      direction: "increase",
      baselineValue: 0,
      targetValue: 20,
    });
    const keyResult = await keyResultOf(goalId, id);
    expect(keyResult?.kind).toBe("metric");
    expect(keyResult?.doneAt).toBeNull();
  });
});

describe("the roll-up from aligned goals (METHOD.md §3.1)", () => {
  async function parentAndChild() {
    const parentId = await objective("Grow the business on the teams we keep", {
      level: "company",
    });
    await call("goals.addKeyResult", {
      goalId: parentId,
      title: "Net revenue retention from 100% to 110%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 100,
      targetValue: 110,
    });
    const childId = await objective("Make onboarding the reason teams stay", {
      parentGoalId: parentId,
    });
    const child = await call<{ id: string }>("goals.addKeyResult", {
      goalId: childId,
      title: "Activation from 30% to 40%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 30,
      targetValue: 40,
    });
    await call("goals.recordValue", { id: child.id, value: 40 });
    return { parentId, childId };
  }

  it("leaves an objective's progress to its own key results by default", async () => {
    const { parentId, childId } = await parentAndChild();
    expect((await read(childId)).progressPct).toBe(100);
    expect((await read(parentId)).progressPct).toBe(0);
  });

  it("counts the aligned goals where the workspace turns the roll-up on", async () => {
    await call("practice.update", { overrides: { "progress.rollUp": "on" } });
    const { parentId } = await parentAndChild();
    expect((await read(parentId)).progressPct).toBe(50);
  });
});
