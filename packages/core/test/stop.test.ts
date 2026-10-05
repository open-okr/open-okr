import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Stopping an OKR (METHOD.md §2.9, P9-T13-c-a).
 *
 * "It no longer matters": closed as abandoned with a one-line reason. The
 * reason is required from every surface, it is the close's one account, and
 * a reopen undoes the stop as it undoes any close.
 */

const OWNER = "stop-owner";

let workspaceId: string;
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

/** NW-Q2-10's C4. */
async function expansion() {
  return (
    await call<{ id: string }>("goals.create", {
      title: "Expansion comes from accounts that reached value",
      cycleId,
      level: "company",
    })
  ).id;
}

async function row(goalId: string) {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    closed_at: Date | null;
    close_decision: string | null;
    close_reason: string | null;
    health: string;
    next_check_in_at: Date | null;
  }>(
    "select closed_at, close_decision, close_reason, health, next_check_in_at from goals where id = $1",
    [goalId],
  );
  return rows[0];
}

const REASON =
  "Capacity moves to the competitive response; expansion returns as a strategic issue for Q3";

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Priya Owner", `${OWNER}@example.com`],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "Priya Owner",
    })
  ).workspaceId;
  cycleId = (
    await call<{ id: string }>("cycles.current", { mode: "quarterly" })
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a stop", () => {
  it("closes the objective as abandoned, with its reason as the close's account, and owes no check-in", async () => {
    const goalId = await expansion();
    await call("goals.stop", { id: goalId, reason: REASON });
    expect(await row(goalId)).toMatchObject({
      close_decision: "abandon",
      close_reason: REASON,
      health: "missed",
      next_check_in_at: null,
    });
    expect((await row(goalId))?.closed_at).not.toBeNull();

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ payload: unknown }>(
      "select payload from activities where subject_id = $1 and kind = 'goal.stopped'",
      [goalId],
    );
    expect(rows[0]?.payload).toMatchObject({ reason: REASON });
  });

  it("needs its one-line reason, from every surface", async () => {
    const goalId = await expansion();
    await expect(
      call("goals.stop", { id: goalId, reason: "  " }),
    ).rejects.toThrow();
    expect((await row(goalId))?.closed_at).toBeNull();
  });

  it("cannot stop what is already closed", async () => {
    const goalId = await expansion();
    await call("goals.stop", { id: goalId, reason: REASON });
    await expect(
      call("goals.stop", { id: goalId, reason: REASON }),
    ).rejects.toThrow(/already closed/);
  });

  it("is undone by a reopen, which starts its rhythm again", async () => {
    const goalId = await expansion();
    await call("goals.stop", { id: goalId, reason: REASON });
    await call("goals.reopen", { id: goalId });
    const reopened = await row(goalId);
    expect(reopened?.closed_at).toBeNull();
    expect(reopened?.close_decision).toBeNull();
    expect(reopened?.next_check_in_at).not.toBeNull();
  });
});
