import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Adding OKRs mid-cycle (METHOD.md §2.9, P9-T13-a).
 *
 * A start after the team publication window closes, into a published set, is
 * marked with its moment; the plan, and anything an import or an unpublished
 * set holds, is not. Where the workspace asks why, the API refuses an
 * addition without a reason, citing the setting, and the reason is kept in
 * the activity. A marked OKR never faces the set-level publish gates.
 */

const OWNER = "midcycle-owner";

let workspaceId: string;
let ownerMemberId: string;
let cycleId: string;

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

/**
 * Places the cycle around today: started `daysAgo` days ago, a month left,
 * and published or not. Set directly, because the window is measured from
 * today and a test cannot wait for week three.
 */
async function cycleStarted(daysAgo: number, published: boolean) {
  const wb = await workerDb();
  await wb.admin.query(
    `update cycles
        set starts_on = current_date - $2::int,
            ends_on = current_date + 30,
            published_at = ${published ? "now()" : "null"}
      where id = $1`,
    [cycleId, daysAgo],
  );
}

async function objective(extra: Record<string, unknown> = {}) {
  return (
    await call<{ id: string }>("goals.create", {
      title: "Make the first week the reason teams renew",
      cycleId,
      level: "team",
      ownerKind: "workspace",
      championId: ownerMemberId,
      ...extra,
    })
  ).id;
}

async function markOf(goalId: string) {
  return (
    await call<{ addedMidCycleAt: string | null }>("goals.read", { id: goalId })
  ).addedMidCycleAt;
}

async function createdActivity(goalId: string) {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ payload: Record<string, unknown> }>(
    "select payload from activities where subject_id = $1 and kind = 'goal.created'",
    [goalId],
  );
  return rows[0]?.payload;
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
  cycleId = (
    await call<{ id: string }>("cycles.current", { mode: "quarterly" })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the mark", () => {
  it("lands on what starts after the window, into a published set, with its moment", async () => {
    await cycleStarted(35, true);
    const goalId = await objective();
    const at = await markOf(goalId);
    expect(at).not.toBeNull();
    expect(Date.now() - Date.parse(at as string)).toBeLessThan(60_000);
    expect(await createdActivity(goalId)).toMatchObject({
      addedMidCycle: true,
      reason: null,
    });

    const keyResult = await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "Teams renewing after the first week from 61% to 70%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 61,
      targetValue: 70,
    });
    const read = await call<{
      keyResults: { id: string; addedMidCycleAt: string | null }[];
    }>("goals.read", { id: goalId });
    expect(
      read.keyResults.find((entry) => entry.id === keyResult.id)
        ?.addedMidCycleAt,
    ).not.toBeNull();
  });

  it("does not land inside the window, which is still the plan", async () => {
    await cycleStarted(10, true);
    expect(await markOf(await objective())).toBeNull();
  });

  it("does not land on a set nobody has published, which is still the plan, late", async () => {
    await cycleStarted(35, false);
    expect(await markOf(await objective())).toBeNull();
  });

  it("is told to the screen before anything is written", async () => {
    await cycleStarted(35, true);
    const tree = await call<{ cycle: { midCycle: boolean } }>("goals.tree", {
      cycleId,
      scope: "all",
    });
    expect(tree.cycle.midCycle).toBe(true);
    await cycleStarted(10, true);
    expect(
      (
        await call<{ cycle: { midCycle: boolean } }>("goals.tree", {
          cycleId,
          scope: "all",
        })
      ).cycle.midCycle,
    ).toBe(false);
  });
});

describe('the reason, "Reason when adding mid-cycle"', () => {
  it("is refused when required and missing, citing the setting, and kept when given", async () => {
    await cycleStarted(35, true);
    await call("practice.update", {
      overrides: { "reasons.midCycleAddition": "required" },
    });
    await expect(objective()).rejects.toThrow(
      /asks why anything is added mid-cycle/,
    );
    const goalId = await objective({
      reason: "New Growth team formed 9 August",
    });
    expect(await createdActivity(goalId)).toMatchObject({
      addedMidCycle: true,
      reason: "New Growth team formed 9 August",
    });
    await expect(
      call("goals.addKeyResult", {
        goalId,
        title: "Trial-to-paid from 4.1% to 7%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 4.1,
        targetValue: 7,
      }),
    ).rejects.toThrow(/asks why anything is added mid-cycle/);
  });

  it("does not read as writing held back, because the screen asks for it", async () => {
    await cycleStarted(35, true);
    await call("practice.update", {
      overrides: { "reasons.midCycleAddition": "required" },
    });
    const policy = await call<{ allowed: boolean }>("goals.creationPolicy", {
      cycleId,
    });
    expect(policy.allowed).toBe(true);
  });

  it("is not asked of the plan, even where it is required", async () => {
    await cycleStarted(10, true);
    await call("practice.update", {
      overrides: { "reasons.midCycleAddition": "required" },
    });
    expect(await markOf(await objective())).toBeNull();
  });
});

describe("the gates", () => {
  it("leave an objective started mid-cycle to its own checks", async () => {
    await cycleStarted(35, true);
    // No key results and no contribution statement: gate 2 and gate 3 would
    // both fail it if it were the plan.
    await objective();
    const read = await call<{
      gates: { gateKey: number; missing: string[] }[];
    }>("workflow.read", { cycleId });
    const missing = read.gates.flatMap((gate) => gate.missing).join(" ");
    expect(missing).not.toContain("Make the first week the reason teams renew");
  });
});

describe("the reviews", () => {
  it("list what was started mid-cycle in the monthly review, with its date (NW-Q1-18)", async () => {
    await cycleStarted(35, true);
    const spaces = await call<{ id: string }[]>("spaces.list", {});
    const spaceId = spaces[0]?.id as string;
    const goalId = await objective({ ownerKind: "space", spaceId });
    const session = await call<{ id: string }>("sessions.create", {
      spaceId,
      cycleId,
      kind: "monthly",
      title: "February review",
      scheduledFor: new Date().toISOString(),
      facilitatorId: ownerMemberId,
    });
    const record = await call<{
      additions: {
        goalId: string;
        keyResultId: string | null;
        addedAt: string;
      }[];
    }>("sessions.monthlyRecord", { sessionId: session.id });
    expect(record.additions).toEqual([
      expect.objectContaining({ goalId, keyResultId: null }),
    ]);
  });
});
