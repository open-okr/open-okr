import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The annual review (METHOD.md §8, P9-T20b-b, NW-Q4-06).
 *
 * "An annual cycle closes with the same review over its annual OKRs, held
 * before any of the next year's drafting." Where it lands is proved in
 * `packages/method`; this is an annual cycle booked through the action, with
 * nothing but its review, and that review scoring the annual key results.
 * 2030, so every date the booking picks is still ahead.
 */

const FACILITATOR = "annual-facilitator";

let workspaceId: string;
let spaceId: string;
let facilitatorId: string;
let cycleId: string;

const call = async <T>(name: string, input: unknown): Promise<T> => {
  const wb = await workerDb();
  return (await callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human", userId: FACILITATOR },
    },
    name as never,
    input as never,
  )) as T;
};

async function booked() {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    kind: string;
    title: string;
    on: string;
  }>(
    `select id, kind, title, (scheduled_for at time zone 'UTC')::date::text as on
       from okr_sessions
      where workspace_id = $1 and cycle_id = $2 and deleted_at is null
      order by scheduled_for`,
    [workspaceId, cycleId],
  );
  return rows;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [FACILITATOR, "Priya", "annual-facilitator@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: FACILITATOR,
    name: "Priya",
  });
  workspaceId = provisioned.workspaceId;
  facilitatorId = provisioned.memberId;
  spaceId = (await call<{ id: string }[]>("spaces.list", {}))[0]?.id as string;
  cycleId = (
    await call<{ id: string; startsOn: string; endsOn: string }>(
      "cycles.create",
      { on: "2030-06-30", mode: "annual" },
    )
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("booking a year (acceptance)", () => {
  it("books its closing review before the next year's drafting, and no weekly check-in", async () => {
    const result = await call<{ missing: string[] }>("sessions.bookCycle", {
      spaceId,
      cycleId,
      weekday: 3,
      time: "10:00",
      facilitatorId,
    });
    expect(result.missing).toEqual([]);

    const rows = await booked();
    expect(rows.map((row) => row.kind)).toEqual(["quarterly"]);
    expect(rows[0]?.title).toBe("Annual review");
    // 2031's drafting opens three weeks before 1 January: 11 December.
    const on = rows[0]?.on ?? "";
    expect(on >= "2030-12-04").toBe(true);
    expect(on < "2030-12-11").toBe(true);
  });
});

describe("the review scores the annual key results", () => {
  it("grades an annual key result and asks its root cause", async () => {
    const goalId = (
      await call<{ id: string }>("goals.create", {
        title: "Grow profitably from the customers we keep",
        cycleId,
        spaceId,
        level: "team",
        ownerKind: "space",
        championId: facilitatorId,
        weight: 1,
      })
    ).id;
    const keyResultId = (
      await call<{ id: string }>("goals.addKeyResult", {
        goalId,
        title: "Net revenue retention from 98% to 110%",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 98,
        targetValue: 110,
        unit: "%",
        weight: 1,
      })
    ).id;

    await call("sessions.bookCycle", {
      spaceId,
      cycleId,
      weekday: 3,
      time: "10:00",
      facilitatorId,
    });
    const [review] = await booked();
    await call("sessions.open", { id: review?.id });
    await call("sessions.advanceStage", { id: review?.id });
    await call("sessions.scoreKeyResult", {
      sessionId: review?.id,
      keyResultId,
      score: 0.5,
      reason: "104%, two quarters of price pressure.",
    });

    const causes = await call<{ keyResults: { keyResultId: string }[] }>(
      "sessions.rootCauses",
      { sessionId: review?.id },
    );
    expect(causes.keyResults.map((entry) => entry.keyResultId)).toEqual([
      keyResultId,
    ]);
  });
});
