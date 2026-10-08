import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ACTIONS, callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Targets that move under one rule (METHOD.md §2.9, §7.6, P9-T13-c-b).
 *
 * A target may be changed at any time. Making it harder needs no reason;
 * easing it needs one, and the original stays on record so the close can see
 * both. The once-a-cycle calibration is retired.
 */

const OWNER = "targets-owner";

let workspaceId: string;
let ownerMemberId: string;
let cycleId: string;
let spaceId: string;

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

interface ScoredKeyResult {
  keyResultId: string;
  target: number | null;
  originalTarget: number | null;
  easedBecause: string | null;
}

async function atTheClose(keyResultId: string): Promise<ScoredKeyResult> {
  const session = await call<{ id: string }>("sessions.create", {
    spaceId,
    cycleId,
    kind: "quarterly",
    title: "Q2 review",
    scheduledFor: new Date().toISOString(),
    facilitatorId: ownerMemberId,
  });
  const status = await call<{
    objectives: { keyResults: ScoredKeyResult[] }[];
  }>("sessions.scoringStatus", { sessionId: session.id });
  const found = status.objectives
    .flatMap((objective) => objective.keyResults)
    .find((entry) => entry.keyResultId === keyResultId);
  if (!found) {
    throw new Error("The key result is not at the close.");
  }
  return found;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Daniel Owner", `${OWNER}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Daniel Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  cycleId = (
    await call<{ id: string }>("cycles.current", { mode: "quarterly" })
  ).id;
  spaceId = (await call<{ id: string }[]>("spaces.list", {}))[0]?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

/** A5's key result: from 40 to a target of 100. */
async function winRate() {
  const goalId = (
    await call<{ id: string }>("goals.create", {
      title: "Win the mid-market deals we are in",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
    })
  ).id;
  return (
    await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "Win rate from 40% to 100%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 40,
      targetValue: 100,
      dueOn: "2026-12-31",
      ownerId: ownerMemberId,
    })
  ).id;
}

describe("A5: one rule for a target, all cycle", () => {
  it("refuses an easing without a reason, keeps one with it, raises freely, and the close sees the original", async () => {
    const keyResultId = await winRate();
    await expect(
      call("goals.changeTarget", { id: keyResultId, targetValue: 80 }),
    ).rejects.toThrow(/Easing a target needs a written reason/);

    await call("goals.changeTarget", {
      id: keyResultId,
      targetValue: 80,
      reason: "Brightline entered the segment on 10 May",
    });
    expect(await atTheClose(keyResultId)).toMatchObject({
      target: 80,
      originalTarget: 100,
      easedBecause: "Brightline entered the segment on 10 May",
    });

    // Harder needs nothing, and the easing's reason stays on record.
    await call("goals.changeTarget", { id: keyResultId, targetValue: 110 });
    expect(await atTheClose(keyResultId)).toMatchObject({
      target: 110,
      originalTarget: 100,
      easedBecause: "Brightline entered the segment on 10 May",
    });
  });

  it("shows no original for a target raised while the plan was still a draft", async () => {
    // The cycle here is unpublished: raising the target is the plan being
    // written, not a promise moved, so the close has no "original" to show.
    const keyResultId = await winRate();
    await call("goals.changeTarget", { id: keyResultId, targetValue: 120 });
    expect(await atTheClose(keyResultId)).toMatchObject({
      target: 120,
      originalTarget: null,
      easedBecause: null,
    });
  });

  it("shows no original for a target that never moved", async () => {
    const keyResultId = await winRate();
    expect(await atTheClose(keyResultId)).toMatchObject({
      target: 100,
      originalTarget: null,
      easedBecause: null,
    });
  });

  it("has no limit on how many times by default", async () => {
    const keyResultId = await winRate();
    for (const targetValue of [110, 120, 130, 140]) {
      await call("goals.changeTarget", { id: keyResultId, targetValue });
    }
    expect((await atTheClose(keyResultId)).target).toBe(140);
  });
});

describe("§7.6's calibration, retired", () => {
  it("is no longer an action anybody can call", () => {
    expect(ACTIONS.map((action) => action.name)).not.toContain(
      "workflow.calibrate",
    );
  });
});
