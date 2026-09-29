import { type WorkspaceTx, withWorkspace } from "@openokr/db";
import { canonThresholds } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  dueCycleQualityNudges,
  dueObjectiveQualityNudges,
  dueProcessHealthNudges,
} from "../src/nudges/quality-triggers.ts";
import {
  dueCommitmentNudges,
  dueCriticalConfidenceNudges,
  duePhaseBlockedNudges,
  dueStreakNudges,
  dueWeeklyDigestNudges,
} from "../src/nudges/rhythm-triggers.ts";
import type { DueNudge } from "../src/nudges/service.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The twelve §6.4 triggers that had a catalogue row and no emitter
 * (completeness review H-11). One test each: the condition is met, the reader
 * names the rule and the recipient §6.4 gives it, and it says nothing when
 * the condition is not met.
 */

const OWNER = "silent-owner";
const SECOND = "silent-second";
const thresholds = canonThresholds();

let workspaceId: string;
let ownerMemberId: string;
let secondMemberId: string;
let spaceId: string;
let planningCycleId: string;

const call = async (
  name: Parameters<typeof callAction>[1],
  input: unknown,
): Promise<unknown> => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    name,
    // Several actions through one helper; each input is the action's own.
    input as never,
  );
};

const read = async <T>(fn: (tx: WorkspaceTx) => Promise<T>): Promise<T> => {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, fn);
};

const said = (nudges: readonly DueNudge[], ruleKey: string) =>
  nudges
    .filter((nudge) => nudge.ruleKey === ruleKey)
    .map((nudge) => nudge.recipientMemberId)
    .sort();

const goal = async (input: {
  cycleId: string;
  title?: string;
  level?: string;
  inSpace?: boolean;
}) =>
  (
    (await call("goals.create", {
      title: input.title ?? "Make onboarding the reason new customers stay",
      cycleId: input.cycleId,
      level: input.level ?? (input.inSpace ? "team" : "company"),
      ownerKind: input.inSpace ? "space" : "workspace",
      ...(input.inSpace ? { spaceId } : {}),
      championId: secondMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string }
  ).id;

const keyResult = async (
  goalId: string,
  title = "Raise activation from 41% to 60%",
) =>
  (
    (await call("goals.addKeyResult", {
      goalId,
      title,
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 41,
      targetValue: 60,
      weight: 1,
    })) as { id: string }
  ).id;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2), ($3, $3, $4)",
    [OWNER, "silent-owner@example.com", SECOND, "silent-second@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Silent Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  secondMemberId = (
    await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, status)
       values (gen_random_uuid(), $1, $2, 'Silent Second', 'active') returning id`,
      [workspaceId, SECOND],
    )
  ).rows[0]?.id as string;
  spaceId = ((await call("spaces.list", {})) as { id: string }[])[0]
    ?.id as string;
  // A quarter in the future, so every planning trigger has a cycle to read.
  planningCycleId = (
    (await call("cycles.create", { on: "2030-02-15" })) as {
      id: string;
    }
  ).id;
  await call("cycles.update", {
    id: planningCycleId,
    sponsorId: ownerMemberId,
    facilitatorId: ownerMemberId,
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the Champion's five", () => {
  it("confidence.critical goes to the space's coordinator the day it is scored", async () => {
    const wb = await workerDb();
    const goalId = await goal({ cycleId: planningCycleId, inSpace: true });
    const krId = await keyResult(goalId);
    const session = (await call("sessions.create", {
      spaceId,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: new Date().toISOString(),
      facilitatorId: ownerMemberId,
    })) as { id: string };
    await wb.admin.query(
      `insert into session_confidences
         (id, workspace_id, session_id, key_result_id, confirmed_confidence, what_changed, confirmed_by_id)
       values (gen_random_uuid(), $1, $2, $3, 0.2, 'The contractor left', $4)`,
      [workspaceId, session.id, krId, ownerMemberId],
    );
    const now = new Date();
    const nudges = await read((tx) =>
      dueCriticalConfidenceNudges(tx, { workspaceId, now, thresholds }),
    );
    // The provisioned space's manager covers for its coordinator.
    expect(said(nudges, "confidence.critical")).toEqual([ownerMemberId]);
    expect(nudges[0]?.urgent).toBe(true);

    // A day later it is not news.
    const later = await read((tx) =>
      dueCriticalConfidenceNudges(tx, {
        workspaceId,
        now: new Date(now.getTime() + 30 * 3_600_000),
        thresholds,
      }),
    );
    expect(later).toEqual([]);
  });

  it("digest.weekly goes to the space and the sponsor once the session closes", async () => {
    const wb = await workerDb();
    const session = (await call("sessions.create", {
      spaceId,
      cycleId: planningCycleId,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: new Date().toISOString(),
      facilitatorId: ownerMemberId,
    })) as { id: string };
    await wb.admin.query(
      "insert into space_members (id, workspace_id, space_id, member_id, role) values (gen_random_uuid(), $1, $2, $3, 'member')",
      [workspaceId, spaceId, secondMemberId],
    );
    const before = await read((tx) =>
      dueWeeklyDigestNudges(tx, { workspaceId, now: new Date(), thresholds }),
    );
    expect(before).toEqual([]);
    await wb.admin.query(
      "update okr_sessions set state = 'closed', ended_at = now() where id = $1",
      [session.id],
    );
    const after = await read((tx) =>
      dueWeeklyDigestNudges(tx, { workspaceId, now: new Date(), thresholds }),
    );
    expect(said(after, "digest.weekly")).toEqual(
      [ownerMemberId, secondMemberId].sort(),
    );
  });

  it("commitment.due reaches the owner on the Friday of an open commitment's week", async () => {
    const wb = await workerDb();
    const session = (await call("sessions.create", {
      spaceId,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: "2030-01-07T09:00:00Z",
      facilitatorId: ownerMemberId,
    })) as { id: string };
    await wb.admin.query(
      `insert into commitments (id, workspace_id, session_id, space_id, week_start, text, owner_id)
       values (gen_random_uuid(), $1, $2, $3, '2030-01-07', 'Ship the pricing page', $4)`,
      [workspaceId, session.id, spaceId, secondMemberId],
    );
    const friday = await read((tx) =>
      dueCommitmentNudges(tx, {
        workspaceId,
        now: new Date("2030-01-11T10:00:00Z"),
        timeZone: "UTC",
      }),
    );
    expect(said(friday, "commitment.due")).toEqual([secondMemberId]);
    const thursday = await read((tx) =>
      dueCommitmentNudges(tx, {
        workspaceId,
        now: new Date("2030-01-10T10:00:00Z"),
        timeZone: "UTC",
      }),
    );
    expect(thursday).toEqual([]);
  });

  it("streak.at_risk tells the coordinator on the Friday of a week with no session", async () => {
    const wb = await workerDb();
    const session = (await call("sessions.create", {
      spaceId,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: "2030-01-02T09:00:00Z",
      facilitatorId: ownerMemberId,
    })) as { id: string };
    await wb.admin.query(
      "update okr_sessions set state = 'closed', ended_at = '2030-01-02T10:00:00Z' where id = $1",
      [session.id],
    );
    await wb.admin.query(
      `insert into streaks (id, workspace_id, space_id, current_weeks, longest_weeks, last_session_week)
       values (gen_random_uuid(), $1, $2, 3, 3, '2030-01-02')`,
      [workspaceId, spaceId],
    );
    const nudges = await read((tx) =>
      dueStreakNudges(tx, {
        workspaceId,
        now: new Date("2030-01-11T10:00:00Z"),
        timeZone: "UTC",
      }),
    );
    expect(said(nudges, "streak.at_risk")).toEqual([ownerMemberId]);
    expect(nudges[0]?.subjectId).toBe(session.id);
  });

  it("cycle.phase_blocked tells the facilitator when a window closes on an unfinished phase", async () => {
    // Q1 2030 starts on 1 January; phases 1 and 2 are due two weeks before.
    const closing = await read((tx) =>
      duePhaseBlockedNudges(tx, {
        workspaceId,
        now: new Date("2029-12-18T10:00:00Z"),
        timeZone: "UTC",
        thresholds,
      }),
    );
    expect(said(closing, "cycle.phase_blocked")).toEqual([ownerMemberId]);
    const otherDay = await read((tx) =>
      duePhaseBlockedNudges(tx, {
        workspaceId,
        now: new Date("2029-12-16T10:00:00Z"),
        timeZone: "UTC",
        thresholds,
      }),
    );
    expect(otherDay).toEqual([]);
  });
});

describe("the Coach's seven", () => {
  it("quality.sandbagging_draft goes to the champion and the facilitator", async () => {
    const wb = await workerDb();
    const goalId = await goal({ cycleId: planningCycleId });
    await keyResult(goalId);
    await keyResult(goalId, "Grow mobile revenue from 1.2m to 2m");
    await wb.admin.query(
      "update key_results set confidence = 0.95 where goal_id = $1",
      [goalId],
    );
    const nudges = await read((tx) =>
      dueObjectiveQualityNudges(tx, { workspaceId, thresholds }),
    );
    expect(said(nudges, "quality.sandbagging_draft")).toEqual(
      [ownerMemberId, secondMemberId].sort(),
    );
  });

  it("quality.trending_off reads the stored forecast and tells the champion", async () => {
    const wb = await workerDb();
    const goalId = await goal({ cycleId: planningCycleId });
    const krId = await keyResult(goalId);
    const quiet = await read((tx) =>
      dueObjectiveQualityNudges(tx, { workspaceId, thresholds }),
    );
    expect(said(quiet, "quality.trending_off")).toEqual([]);
    await wb.admin.query(
      `update key_results set forecast = '{"projected": 48, "trendingOffTrack": true}' where id = $1`,
      [krId],
    );
    const nudges = await read((tx) =>
      dueObjectiveQualityNudges(tx, { workspaceId, thresholds }),
    );
    expect(said(nudges, "quality.trending_off")).toEqual([secondMemberId]);
  });

  it("quality.too_many_objectives tells the facilitator when the company level is over its cap", async () => {
    for (let index = 0; index < 6; index += 1) {
      await goal({
        cycleId: planningCycleId,
        title: `Company objective number ${index + 1} for the quarter`,
      });
    }
    const nudges = await read((tx) =>
      dueCycleQualityNudges(tx, {
        workspaceId,
        now: new Date("2029-12-10T10:00:00Z"),
        timeZone: "UTC",
        thresholds,
      }),
    );
    expect(said(nudges, "quality.too_many_objectives")).toEqual([
      ownerMemberId,
    ]);
  });

  it("quality.no_not_doing fires once phase 3 is done with no not-doing list", async () => {
    const cycleRead = () =>
      read((tx) =>
        dueCycleQualityNudges(tx, {
          workspaceId,
          now: new Date("2029-12-10T10:00:00Z"),
          timeZone: "UTC",
          thresholds,
        }),
      );
    expect(said(await cycleRead(), "quality.no_not_doing")).toEqual([]);
    await call("workflow.setRevalidation", {
      cycleId: planningCycleId,
      holds: true,
      changed: false,
      focusNote: "Mobile activation",
    });
    // Sponsor and facilitator are the same person here, so one message.
    expect(said(await cycleRead(), "quality.no_not_doing")).toEqual([
      ownerMemberId,
    ]);
  });

  it("quality.no_cuts fires when capacity has verdicts and nothing is cut", async () => {
    const goalId = await goal({ cycleId: planningCycleId });
    const krId = await keyResult(goalId);
    await call("goals.updateKeyResult", { id: krId, capacity: "tight" });
    const nudges = await read((tx) =>
      dueCycleQualityNudges(tx, {
        workspaceId,
        now: new Date("2029-12-10T10:00:00Z"),
        timeZone: "UTC",
        thresholds,
      }),
    );
    expect(said(nudges, "quality.no_cuts")).toEqual([ownerMemberId]);
  });

  it("quality.sandbagging_close tells the sponsor when an ended cycle's scores cluster high", async () => {
    const wb = await workerDb();
    const goalId = await goal({ cycleId: planningCycleId });
    const krs = [
      await keyResult(goalId),
      await keyResult(goalId, "Grow mobile revenue from 1.2m to 2m"),
    ];
    await wb.admin.query(
      "update key_results set score = 0.95 where id = any($1::uuid[])",
      [krs],
    );
    const during = await read((tx) =>
      dueCycleQualityNudges(tx, {
        workspaceId,
        now: new Date("2030-03-15T10:00:00Z"),
        timeZone: "UTC",
        thresholds,
      }),
    );
    expect(said(during, "quality.sandbagging_close")).toEqual([]);
    const after = await read((tx) =>
      dueCycleQualityNudges(tx, {
        workspaceId,
        now: new Date("2030-04-03T10:00:00Z"),
        timeZone: "UTC",
        thresholds,
      }),
    );
    expect(said(after, "quality.sandbagging_close")).toEqual([ownerMemberId]);
  });

  it("quality.process_health_low goes to the sponsor the night after the review closes", async () => {
    const wb = await workerDb();
    const review = (await call("sessions.create", {
      spaceId,
      cycleId: planningCycleId,
      kind: "quarterly",
      title: "Quarterly review",
      scheduledFor: new Date().toISOString(),
      facilitatorId: ownerMemberId,
    })) as { id: string };
    await wb.admin.query(
      `insert into process_health_responses (id, workspace_id, session_id, statement_key, score, respondent_hash)
       values (gen_random_uuid(), $1, $2, 3, 1, 'a')`,
      [workspaceId, review.id],
    );
    await wb.admin.query(
      "update okr_sessions set state = 'closed', ended_at = now() where id = $1",
      [review.id],
    );
    const nudges = await read((tx) =>
      dueProcessHealthNudges(tx, { workspaceId, now: new Date() }),
    );
    expect(said(nudges, "quality.process_health_low")).toEqual([ownerMemberId]);
  });
});
