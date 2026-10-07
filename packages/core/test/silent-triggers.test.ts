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
  dueCommittedFloorNudges,
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
  kind?: "committed" | "aspirational";
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
      ...(input.kind ? { kind: input.kind } : {}),
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
  /** A session in the space, with confirmed confidences written into it. */
  const confirmIn = async (
    entries: readonly { krId: string; confidence: number; daysAgo?: number }[],
  ) => {
    const wb = await workerDb();
    const session = (await call("sessions.create", {
      spaceId,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: new Date().toISOString(),
      facilitatorId: ownerMemberId,
    })) as { id: string };
    for (const entry of entries) {
      await wb.admin.query(
        `insert into session_confidences
           (id, workspace_id, session_id, key_result_id, confirmed_confidence,
            what_changed, confirmed_by_id, created_at)
         values (gen_random_uuid(), $1, $2, $3, $4, 'Scored', $5,
                 now() - make_interval(days => $6))`,
        [
          workspaceId,
          session.id,
          entry.krId,
          entry.confidence,
          ownerMemberId,
          entry.daysAgo ?? 0,
        ],
      );
    }
  };

  it("confidence.critical goes to the space's coordinator the day a confidence falls into the low band", async () => {
    const goalId = await goal({ cycleId: planningCycleId, inSpace: true });
    const krId = await keyResult(goalId);
    await confirmIn([{ krId, confidence: 0.6, daysAgo: 7 }]);
    await confirmIn([{ krId, confidence: 0.35 }]);
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

  it("says nothing for a key result drafted low that stays there (§3.2, P9-T19a-c-a)", async () => {
    // A moonshot: first scored at 0.2, and 0.2 again. Nothing fell.
    const goalId = await goal({ cycleId: planningCycleId, inSpace: true });
    const krId = await keyResult(goalId);
    await confirmIn([{ krId, confidence: 0.2, daysAgo: 7 }]);
    await confirmIn([{ krId, confidence: 0.2 }]);
    const nudges = await read((tx) =>
      dueCriticalConfidenceNudges(tx, {
        workspaceId,
        now: new Date(),
        thresholds,
      }),
    );
    expect(nudges).toEqual([]);
  });

  /**
   * P9-T19a-c-a's acceptance criterion: "Given a company objective whose
   * confidence drops into the low band, when the Champion runs, then the
   * company space's coordinator is told and the sponsor is not, unless the
   * workspace turned critical escalation on and the confidence is 0.3 or
   * below."
   */
  it("acceptance: a company objective's fall reaches the company space's coordinator, and the sponsor only with critical escalation on", async () => {
    const wb = await workerDb();
    await wb.admin.query("update cycles set sponsor_id = $2 where id = $1", [
      planningCycleId,
      secondMemberId,
    ]);
    // Held by the workspace, as a company objective is: no space of its own.
    const goalId = await goal({ cycleId: planningCycleId, level: "company" });
    const krId = await keyResult(goalId);
    await confirmIn([{ krId, confidence: 0.7, daysAgo: 7 }]);
    await confirmIn([{ krId, confidence: 0.3 }]);

    const off = await read((tx) =>
      dueCriticalConfidenceNudges(tx, {
        workspaceId,
        now: new Date(),
        thresholds,
      }),
    );
    // The company space is the workspace's own first space, whose manager
    // covers for its coordinator. Not the sponsor.
    expect(said(off, "confidence.critical")).toEqual([ownerMemberId]);

    await call("practice.update", {
      overrides: { "escalation.criticalConfidence": "on" },
    });
    const on = await read((tx) =>
      dueCriticalConfidenceNudges(tx, {
        workspaceId,
        now: new Date(),
        thresholds,
      }),
    );
    expect(said(on, "confidence.critical")).toEqual(
      [ownerMemberId, secondMemberId].sort(),
    );
    const toSponsor = on.find(
      (nudge) => nudge.recipientMemberId === secondMemberId,
    );
    // A step above the coordinator's, so the two are not deduplicated away.
    expect(toSponsor?.escalationStep).toBe(2);
  });

  it("tells the sponsor of a critical score with critical escalation on, though nothing fell", async () => {
    const wb = await workerDb();
    await wb.admin.query("update cycles set sponsor_id = $2 where id = $1", [
      planningCycleId,
      secondMemberId,
    ]);
    await call("practice.update", {
      overrides: { "escalation.criticalConfidence": "on" },
    });
    const goalId = await goal({ cycleId: planningCycleId, inSpace: true });
    const krId = await keyResult(goalId);
    await confirmIn([{ krId, confidence: 0.3 }]);
    const nudges = await read((tx) =>
      dueCriticalConfidenceNudges(tx, {
        workspaceId,
        now: new Date(),
        thresholds,
      }),
    );
    // NW-Q2-09: checked in at 0.3 with critical escalation on, the sponsor
    // hears the same day. No earlier score, so the coordinator does not.
    expect(said(nudges, "confidence.critical")).toEqual([secondMemberId]);
  });

  it("reads a fall from a check-in's snapshot", async () => {
    const goalId = await goal({ cycleId: planningCycleId, inSpace: true });
    const krId = await keyResult(goalId);
    const narrative = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph" as const,
          content: [
            { type: "text" as const, text: "Import slipped two weeks." },
          ],
        },
      ],
    };
    // Two check-ins as the champion writes them: 0.7, then 0.3.
    const publish = async (confidence: number) => {
      const wb = await workerDb();
      const actor = {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human" as const, userId: SECOND },
      };
      const draft = (await callAction(actor, "goals.startCheckIn", {
        goalId,
      })) as { id: string };
      await callAction(actor, "goals.publishCheckIn", {
        id: draft.id,
        status: "caution",
        confidence,
        narrative,
        values: [{ keyResultId: krId, confidence }],
      });
    };
    await publish(0.7);
    const quiet = await read((tx) =>
      dueCriticalConfidenceNudges(tx, {
        workspaceId,
        now: new Date(),
        thresholds,
      }),
    );
    expect(quiet).toEqual([]);

    await publish(0.3);
    const nudges = await read((tx) =>
      dueCriticalConfidenceNudges(tx, {
        workspaceId,
        now: new Date(),
        thresholds,
      }),
    );
    expect(said(nudges, "confidence.critical")).toEqual([ownerMemberId]);
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

  it("quality.sandbagging_draft says nothing of a committed objective drafted near certain", async () => {
    // METHOD.md §3.2 (P9-T11b-b): high confidence is right for a commitment.
    const wb = await workerDb();
    const goalId = await goal({ cycleId: planningCycleId, kind: "committed" });
    await keyResult(goalId);
    await keyResult(goalId, "Grow mobile revenue from 1.2m to 2m");
    await wb.admin.query(
      "update key_results set confidence = 0.95 where goal_id = $1",
      [goalId],
    );
    const nudges = await read((tx) =>
      dueObjectiveQualityNudges(tx, { workspaceId, thresholds }),
    );
    expect(said(nudges, "quality.sandbagging_draft")).toEqual([]);
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

  it("quality.sandbagging_close tells the sponsor when an ended cycle's aspirational scores are mostly 1.0", async () => {
    const wb = await workerDb();
    const goalId = await goal({ cycleId: planningCycleId });
    const krs = [
      await keyResult(goalId),
      await keyResult(goalId, "Grow mobile revenue from 1.2m to 2m"),
    ];
    // METHOD.md §3.3's pattern: three quarters or more of the aspirational
    // key results at 1.0. A new objective is aspirational by default.
    await wb.admin.query(
      "update key_results set score = 1 where id = any($1::uuid[])",
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

  it("quality.sandbagging_close says nothing of committed key results met in full", async () => {
    // METHOD.md §3.3 (P9-T11b-b): a commitment met is a promise kept, so a
    // cycle of committed key results at 1.0 is not the too-safe pattern.
    const wb = await workerDb();
    const goalId = await goal({ cycleId: planningCycleId, kind: "committed" });
    const krs = [
      await keyResult(goalId),
      await keyResult(goalId, "Grow mobile revenue from 1.2m to 2m"),
    ];
    await wb.admin.query(
      "update key_results set score = 1 where id = any($1::uuid[])",
      [krs],
    );
    const after = await read((tx) =>
      dueCycleQualityNudges(tx, {
        workspaceId,
        now: new Date("2030-04-03T10:00:00Z"),
        timeZone: "UTC",
        thresholds,
      }),
    );
    expect(said(after, "quality.sandbagging_close")).toEqual([]);
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

describe("the committed floor (METHOD.md §3.2, P9-T11b-c)", () => {
  const narrative = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "The contractor left." }],
      },
    ],
  };

  it("quality.committed_floor tells the champion of a commitment drafted below the floor", async () => {
    const wb = await workerDb();
    const committed = await goal({
      cycleId: planningCycleId,
      kind: "committed",
    });
    const aspirational = await goal({
      cycleId: planningCycleId,
      title: "Make the first week the reason teams renew",
    });
    await keyResult(committed);
    await keyResult(aspirational);
    await wb.admin.query(
      "update key_results set confidence = 0.4 where goal_id = any($1::uuid[])",
      [[committed, aspirational]],
    );
    const nudges = await read((tx) =>
      dueObjectiveQualityNudges(tx, { workspaceId, thresholds }),
    );
    const floor = nudges.filter(
      (nudge) => nudge.ruleKey === "quality.committed_floor",
    );
    expect(floor.map((nudge) => nudge.subjectId)).toEqual([committed]);
    expect(floor.map((nudge) => nudge.recipientMemberId)).toEqual([
      secondMemberId,
    ]);
    // The Coach's, so it is a quality nudge, and it does not escalate.
    expect(floor[0]?.kind).toBe("quality");
    expect(floor[0]?.urgent).toBe(false);
  });

  it("quality.committed_floor tells the champion when a committed check-in lands below the floor, and says nothing of an aspirational one", async () => {
    const committed = await goal({
      cycleId: planningCycleId,
      kind: "committed",
    });
    const aspirational = await goal({
      cycleId: planningCycleId,
      title: "Make the first week the reason teams renew",
    });
    for (const goalId of [committed, aspirational]) {
      const keyResultId = await keyResult(goalId);
      await call("goals.publishDraftedCheckIn", {
        goalId,
        status: "caution",
        confidence: 0.4,
        narrative,
        values: [{ keyResultId, confidence: 0.4 }],
      });
    }
    const now = new Date();
    const nudges = await read((tx) =>
      dueCommittedFloorNudges(tx, { workspaceId, now, thresholds }),
    );
    expect(nudges.map((nudge) => nudge.subjectId)).toEqual([committed]);
    expect(said(nudges, "quality.committed_floor")).toEqual([secondMemberId]);

    // A day later it is not news; deduplication holds the window between.
    const later = await read((tx) =>
      dueCommittedFloorNudges(tx, {
        workspaceId,
        now: new Date(now.getTime() + 30 * 3_600_000),
        thresholds,
      }),
    );
    expect(later).toEqual([]);
  });

  it("says nothing of a commitment checked in at the floor", async () => {
    const committed = await goal({
      cycleId: planningCycleId,
      kind: "committed",
    });
    const keyResultId = await keyResult(committed);
    await call("goals.publishDraftedCheckIn", {
      goalId: committed,
      status: "on_track",
      confidence: 0.7,
      narrative,
      values: [{ keyResultId, confidence: 0.7 }],
    });
    const nudges = await read((tx) =>
      dueCommittedFloorNudges(tx, { workspaceId, now: new Date(), thresholds }),
    );
    expect(nudges).toEqual([]);
  });
});
