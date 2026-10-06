import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The review and the retrospective apart (METHOD.md §8, §12, P9-T20b-a,
 * NW-Q2-18 to NW-Q2-21).
 *
 * "A workspace may split it into a review session and a separate
 * retrospective. When split, the review session holds the Open and Review
 * acts (stages 1 to 4) and the retrospective holds the Retro and Reset acts
 * (stages 5 to 11)." Where the two are booked is proved in
 * `packages/method`; this is the two sessions as written, each walking its
 * own half, and the retrospective reading the scores its review recorded.
 */

const FACILITATOR = "split-facilitator";

let workspaceId: string;
let spaceId: string;
let cycleId: string;
let facilitatorId: string;
let missedKeyResultId: string;

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

interface Booked {
  id: string;
  title: string;
  stage_key: string | null;
  review_part: string | null;
  review_session_id: string | null;
}

async function reviews(): Promise<Booked[]> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<Booked>(
    `select id, title, stage_key, review_part, review_session_id
       from okr_sessions
      where workspace_id = $1 and kind = 'quarterly' and deleted_at is null
      order by scheduled_for`,
    [workspaceId],
  );
  return rows;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [FACILITATOR, "Priya", "split-facilitator@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: FACILITATOR,
    name: "Priya",
  });
  workspaceId = provisioned.workspaceId;
  facilitatorId = provisioned.memberId;
  spaceId = (await call<{ id: string }[]>("spaces.list", {}))[0]?.id as string;
  cycleId = (
    await call<{ id: string }>("cycles.current", { mode: "quarterly" })
  ).id;

  const goalId = (
    await call<{ id: string }>("goals.create", {
      title: "Win the mid-market deals we should win",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: facilitatorId,
      weight: 1,
    })
  ).id;
  missedKeyResultId = (
    await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "Raise win rate against Meridian from 22% to 35%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 22,
      targetValue: 35,
      unit: "%",
      weight: 1,
    })
  ).id;

  await call("practice.update", { overrides: { "review.format": "split" } });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("booking a quarter held apart (acceptance)", () => {
  it("books a review and a retrospective that names it", async () => {
    const booked = await call<{ missing: string[] }>("sessions.bookCycle", {
      spaceId,
      cycleId,
      weekday: 1,
      time: "10:00",
      facilitatorId,
    });
    // The quarter began before today, so its first week is a gap of its
    // own; neither half of the review is.
    expect(
      booked.missing.filter((line) => /review|retrospective/.test(line)),
    ).toEqual([]);

    const [review, retrospective, ...rest] = await reviews();
    expect(rest).toEqual([]);
    expect(review).toMatchObject({
      title: "Quarterly review",
      review_part: "review",
      review_session_id: null,
    });
    expect(retrospective).toMatchObject({
      title: "Quarterly retrospective",
      review_part: "retrospective",
      review_session_id: review?.id,
    });
  });

  it("books one whole review where the workspace keeps one session", async () => {
    await call("practice.update", { overrides: { "review.format": null } });
    await call("sessions.bookCycle", {
      spaceId,
      cycleId,
      weekday: 1,
      time: "10:00",
      facilitatorId,
    });
    const booked = await reviews();
    expect(booked).toHaveLength(1);
    expect(booked[0]?.review_part).toBeNull();
  });
});

describe("each half walks its own stages", () => {
  it("runs the review from the opening to recognition, and no further", async () => {
    await call("sessions.bookCycle", {
      spaceId,
      cycleId,
      weekday: 1,
      time: "10:00",
      facilitatorId,
    });
    const [review] = await reviews();
    await call("sessions.open", { id: review?.id });
    expect((await reviews())[0]?.stage_key).toBe("open");
    for (const expected of ["score", "narratives", "recognition"]) {
      await call("sessions.advanceStage", { id: review?.id });
      expect((await reviews())[0]?.stage_key).toBe(expected);
    }
    await expect(
      call("sessions.advanceStage", { id: review?.id }),
    ).rejects.toThrow(/last stage/);
  });

  it("opens the retrospective on the team retro", async () => {
    await call("sessions.bookCycle", {
      spaceId,
      cycleId,
      weekday: 1,
      time: "10:00",
      facilitatorId,
    });
    const [, retrospective] = await reviews();
    await call("sessions.open", { id: retrospective?.id });
    expect((await reviews())[1]?.stage_key).toBe("team_retro");
  });
});

describe("the retrospective reads its review's scores", () => {
  it("asks a root cause of what the review scored below the threshold, and its minutes carry the score", async () => {
    await call("sessions.bookCycle", {
      spaceId,
      cycleId,
      weekday: 1,
      time: "10:00",
      facilitatorId,
    });
    const [review, retrospective] = await reviews();
    await call("sessions.open", { id: review?.id });
    await call("sessions.advanceStage", { id: review?.id });
    await call("sessions.scoreKeyResult", {
      sessionId: review?.id,
      keyResultId: missedKeyResultId,
      score: 0.31,
      reason: "Win rate 26% against Meridian.",
    });

    await call("sessions.open", { id: retrospective?.id });
    const causes = await call<{ keyResults: { keyResultId: string }[] }>(
      "sessions.rootCauses",
      { sessionId: retrospective?.id },
    );
    expect(causes.keyResults.map((entry) => entry.keyResultId)).toEqual([
      missedKeyResultId,
    ]);

    const minutes = await call<{
      scores: { keyResultTitle: string; score: number }[];
    }>("sessions.minutes", { sessionId: retrospective?.id });
    expect(minutes.scores).toEqual([
      expect.objectContaining({
        keyResultTitle: "Raise win rate against Meridian from 22% to 35%",
        score: 0.31,
      }),
    ]);
  });
});
