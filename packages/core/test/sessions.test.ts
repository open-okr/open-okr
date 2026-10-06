/**
 * Session actions against a real database (P4-T07a, METHOD.md §7.2,
 * p4-t00-session-design.md).
 *
 * Test plan from the task:
 * - a stage change reaches every connected client inside the budget (tested as:
 *   advanceStage returns the realtime channel name and event)
 * - a reconnecting client lands on the current stage (tested as: sessions.read
 *   always returns the current stage_key)
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "session-facilitator";
const MEMBER = "session-member";
const OUTSIDER = "session-outsider";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let facilitatorMemberId: string;
let memberMemberId: string;
let goalId: string;
let keyResultId: string;

const context = (userId = FACILITATOR) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

async function createSession(overrides: Record<string, unknown> = {}) {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context() }, "sessions.create", {
    spaceId,
    cycleId,
    kind: "weekly",
    title: "Weekly check-in",
    scheduledFor: new Date(Date.now() + 3600_000).toISOString(),
    facilitatorId: facilitatorMemberId,
    ...overrides,
  });
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email) values
       ($1, $2, $3),
       ($4, $5, $6),
       ($7, $8, $9)`,
    [
      FACILITATOR,
      "Facilitator",
      "facilitator@example.com",
      MEMBER,
      "Member",
      "member@example.com",
      OUTSIDER,
      "Outsider",
      "outsider@example.com",
    ],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: FACILITATOR,
    name: "Facilitator",
  });
  workspaceId = provisioned.workspaceId;
  facilitatorMemberId = provisioned.memberId;

  // Get the default space that provisioning created.
  const spaces = await callAction(
    { pool: wb.appPool, ...context() },
    "spaces.list",
    {},
  );
  spaceId = (spaces as Array<{ id: string }>)[0]?.id as string;

  const current = await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  );
  cycleId = (current as { id: string })?.id;

  // A second member inside the space.
  const secondRow = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Member', 'active') returning id`,
    [workspaceId, MEMBER],
  );
  memberMemberId = secondRow.rows[0]?.id as string;
  await callAction({ pool: wb.appPool, ...context() }, "spaces.addMember", {
    spaceId,
    memberId: memberMemberId,
    role: "member",
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("sessions.create", () => {
  it("creates a session in scheduled state", async () => {
    const wb = await workerDb();
    const session = await createSession();

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.read",
      { id: (session as { id: string }).id },
    );
    expect((read as { state: string }).state).toBe("scheduled");
    expect((read as { stageKey: unknown }).stageKey).toBeNull();
  });
});

describe("sessions.open", () => {
  it("transitions to running and sets the first stage", async () => {
    const wb = await workerDb();
    const session = await createSession();
    const sessionId = (session as { id: string }).id;

    await callAction({ pool: wb.appPool, ...context() }, "sessions.open", {
      id: sessionId,
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.read",
      { id: sessionId },
    );
    expect((read as { state: string }).state).toBe("running");
    expect((read as { stageKey: string }).stageKey).toBe("confidence");
    expect((read as { startedAt: unknown }).startedAt).not.toBeNull();
  });

  it("is refused when the session is already running", async () => {
    const wb = await workerDb();
    const session = await createSession();
    const sessionId = (session as { id: string }).id;
    await callAction({ pool: wb.appPool, ...context() }, "sessions.open", {
      id: sessionId,
    });

    await expect(
      callAction({ pool: wb.appPool, ...context() }, "sessions.open", {
        id: sessionId,
      }),
    ).rejects.toThrow();
  });
});

describe("sessions.advanceStage", () => {
  it("moves to the next stage", async () => {
    const wb = await workerDb();
    const session = await createSession();
    const sessionId = (session as { id: string }).id;
    await callAction({ pool: wb.appPool, ...context() }, "sessions.open", {
      id: sessionId,
    });

    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.advanceStage",
      { id: sessionId },
    );

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.read",
      { id: sessionId },
    );
    expect((read as { stageKey: string }).stageKey).toBe("diagnose");
  });

  it("records elapsed time for the completed stage", async () => {
    const wb = await workerDb();
    const session = await createSession();
    const sessionId = (session as { id: string }).id;
    await callAction({ pool: wb.appPool, ...context() }, "sessions.open", {
      id: sessionId,
    });
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.advanceStage",
      { id: sessionId },
    );

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.read",
      { id: sessionId },
    );
    const elapsed = (read as { elapsed: Record<string, number> }).elapsed;
    expect(typeof elapsed.confidence).toBe("number");
    expect(elapsed.confidence).toBeGreaterThanOrEqual(0);
  });

  it("is refused when already on the last stage", async () => {
    const wb = await workerDb();
    const session = await createSession();
    const sessionId = (session as { id: string }).id;
    await callAction({ pool: wb.appPool, ...context() }, "sessions.open", {
      id: sessionId,
    });
    // Advance through all 4 stages (starts at confidence, need 3 more advances)
    for (let i = 0; i < 3; i++) {
      await callAction(
        { pool: wb.appPool, ...context() },
        "sessions.advanceStage",
        { id: sessionId },
      );
    }

    await expect(
      callAction({ pool: wb.appPool, ...context() }, "sessions.advanceStage", {
        id: sessionId,
      }),
    ).rejects.toThrow();
  });

  it("returns the realtime channel for the caller to publish", async () => {
    const wb = await workerDb();
    const session = await createSession();
    const sessionId = (session as { id: string }).id;
    await callAction({ pool: wb.appPool, ...context() }, "sessions.open", {
      id: sessionId,
    });

    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.advanceStage",
      { id: sessionId },
    );

    // The action returns a realtimeChannel so the route handler can publish.
    const r = result as { id: string; realtimeChannel: string };
    expect(r.realtimeChannel).toContain(workspaceId);
    expect(r.realtimeChannel).toContain(sessionId);
  });
});

describe("sessions.skip", () => {
  it("marks the session as skipped", async () => {
    const wb = await workerDb();
    const session = await createSession();
    const sessionId = (session as { id: string }).id;

    await callAction({ pool: wb.appPool, ...context() }, "sessions.skip", {
      id: sessionId,
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.read",
      { id: sessionId },
    );
    expect((read as { state: string }).state).toBe("skipped");
  });

  it("is refused when the session is already running", async () => {
    const wb = await workerDb();
    const session = await createSession();
    const sessionId = (session as { id: string }).id;
    await callAction({ pool: wb.appPool, ...context() }, "sessions.open", {
      id: sessionId,
    });

    await expect(
      callAction({ pool: wb.appPool, ...context() }, "sessions.skip", {
        id: sessionId,
      }),
    ).rejects.toThrow();
  });
});

describe("sessions.close", () => {
  it("closes a running session and stamps ended_at", async () => {
    const wb = await workerDb();
    const session = await createSession();
    const sessionId = (session as { id: string }).id;
    await callAction({ pool: wb.appPool, ...context() }, "sessions.open", {
      id: sessionId,
    });

    await callAction({ pool: wb.appPool, ...context() }, "sessions.close", {
      id: sessionId,
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.read",
      { id: sessionId },
    );
    expect((read as { state: string }).state).toBe("closed");
    expect((read as { endedAt: unknown }).endedAt).not.toBeNull();
  });

  it("is refused when the session is not running", async () => {
    const wb = await workerDb();
    const session = await createSession();
    const sessionId = (session as { id: string }).id;

    await expect(
      callAction({ pool: wb.appPool, ...context() }, "sessions.close", {
        id: sessionId,
      }),
    ).rejects.toThrow();
  });
});

describe("sessions.read", () => {
  it("returns not-found for a non-member of the space", async () => {
    const wb = await workerDb();
    const session = await createSession();
    const sessionId = (session as { id: string }).id;

    // OUTSIDER has no workspace membership at all.
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human" as const, userId: OUTSIDER },
        },
        "sessions.read",
        { id: sessionId },
      ),
    ).rejects.toThrow();
  });

  it("a reconnecting client reads the current stage", async () => {
    const wb = await workerDb();
    const session = await createSession();
    const sessionId = (session as { id: string }).id;
    await callAction({ pool: wb.appPool, ...context() }, "sessions.open", {
      id: sessionId,
    });
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.advanceStage",
      { id: sessionId },
    );

    // Reading fresh always returns the actual current stage — no client cache.
    const read = await callAction(
      { pool: wb.appPool, ...context(MEMBER) },
      "sessions.read",
      { id: sessionId },
    );
    expect((read as { stageKey: string }).stageKey).toBe("diagnose");
  });
});

describe("sessions.participants", () => {
  it("returns all active space members", async () => {
    const wb = await workerDb();
    const session = await createSession();

    const participants = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.participants",
      { id: (session as { id: string }).id },
    );

    const list = participants as Array<{ memberId: string }>;
    expect(list.some((p) => p.memberId === facilitatorMemberId)).toBe(true);
    expect(list.some((p) => p.memberId === memberMemberId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P4-T07b: The confidence round
// ---------------------------------------------------------------------------

/** Helper: create a goal with one KR for confidence round testing. */
async function createGoalWithKr(): Promise<void> {
  const wb = await workerDb();
  const goal = await callAction(
    { pool: wb.appPool, ...context() },
    "goals.create",
    {
      title: "Grow monthly active users by 20 percent",
      cycleId,
      spaceId,
      level: "company",
      ownerKind: "space",
      championId: facilitatorMemberId,
      reviewerId: memberMemberId,
      weight: 1,
    },
  );
  goalId = (goal as { id: string }).id;

  const kr = await callAction(
    { pool: wb.appPool, ...context() },
    "goals.addKeyResult",
    {
      goalId,
      title: "Monthly active users from 50k to 60k",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 50000,
      targetValue: 60000,
      weight: 1,
    },
  );
  keyResultId = (kr as { id: string }).id;
}

/** Helper: create a session and open it at stage 1 (confidence). */
async function openSessionAtConfidence(): Promise<string> {
  const wb = await workerDb();
  const session = await createSession();
  const sessionId = (session as { id: string }).id;
  await callAction({ pool: wb.appPool, ...context() }, "sessions.open", {
    id: sessionId,
  });
  return sessionId;
}

describe("sessions.castVote (P4-T07b)", () => {
  it("stores a vote tied to the session", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();

    const vote = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.castVote",
      { sessionId, keyResultId, confidence: 0.6 },
    );

    expect((vote as { id: string }).id).toBeTruthy();
  });

  it("upserts: a second vote on the same KR replaces the first", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();

    await callAction({ pool: wb.appPool, ...context() }, "sessions.castVote", {
      sessionId,
      keyResultId,
      confidence: 0.4,
    });
    await callAction({ pool: wb.appPool, ...context() }, "sessions.castVote", {
      sessionId,
      keyResultId,
      confidence: 0.7,
    });

    const votes = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.votes",
      { sessionId, keyResultId },
    );
    const list = votes as Array<{ confidence: number }>;
    expect(list).toHaveLength(1);
    expect(Number(list[0]?.confidence)).toBe(0.7);
  });
});

describe("sessions.revealVotes (P4-T07b)", () => {
  it("reveals all votes for a KR atomically", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();

    await callAction({ pool: wb.appPool, ...context() }, "sessions.castVote", {
      sessionId,
      keyResultId,
      confidence: 0.5,
    });
    await callAction(
      { pool: wb.appPool, ...context(MEMBER) },
      "sessions.castVote",
      { sessionId, keyResultId, confidence: 0.3 },
    );

    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.revealVotes",
      { sessionId, keyResultId },
    );

    expect((result as { revealed: number }).revealed).toBe(2);
  });
});

describe("sessions.confirmConfidence (P4-T07b)", () => {
  it("stores confirmed confidence and the what-changed note", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();

    // Vote and reveal first.
    await callAction({ pool: wb.appPool, ...context() }, "sessions.castVote", {
      sessionId,
      keyResultId,
      confidence: 0.5,
    });
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.revealVotes",
      { sessionId, keyResultId },
    );

    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.confirmConfidence",
      {
        sessionId,
        keyResultId,
        confidence: 0.6,
        whatChanged: "Pipeline grew by 15 percent this week",
      },
    );

    expect((result as { id: string }).id).toBeTruthy();
  });
});

describe("sessions.advanceStage — confidence completion gate (P4-T07b)", () => {
  it("is refused when a KR has no confirmed confidence (acceptance criterion)", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();

    // No confidence confirmed. Advancing should fail naming the KR.
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "sessions.advanceStage", {
        id: sessionId,
      }),
    ).rejects.toThrow(/Monthly active users/);
  });

  it("succeeds when all KRs are confirmed", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();

    await callAction({ pool: wb.appPool, ...context() }, "sessions.castVote", {
      sessionId,
      keyResultId,
      confidence: 0.5,
    });
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.revealVotes",
      { sessionId, keyResultId },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.confirmConfidence",
      {
        sessionId,
        keyResultId,
        confidence: 0.6,
        whatChanged: "Pipeline grew by 15 percent this week",
      },
    );

    // Now advancing should succeed.
    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.advanceStage",
      { id: sessionId },
    );

    expect((result as { id: string }).id).toBe(sessionId);
  });
});

describe("sessions.votes — privacy (P4-T07b)", () => {
  it("returns own vote only before reveal", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();

    // Facilitator votes.
    await callAction({ pool: wb.appPool, ...context() }, "sessions.castVote", {
      sessionId,
      keyResultId,
      confidence: 0.5,
    });
    // Member votes.
    await callAction(
      { pool: wb.appPool, ...context(MEMBER) },
      "sessions.castVote",
      { sessionId, keyResultId, confidence: 0.3 },
    );

    // Member reads: should see only their own vote.
    const memberVotes = (await callAction(
      { pool: wb.appPool, ...context(MEMBER) },
      "sessions.votes",
      { sessionId, keyResultId },
    )) as Array<{ confidence: number }>;

    expect(memberVotes).toHaveLength(1);
    expect(Number(memberVotes[0]?.confidence)).toBe(0.3);
  });

  it("returns all votes after reveal", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();

    await callAction({ pool: wb.appPool, ...context() }, "sessions.castVote", {
      sessionId,
      keyResultId,
      confidence: 0.5,
    });
    await callAction(
      { pool: wb.appPool, ...context(MEMBER) },
      "sessions.castVote",
      { sessionId, keyResultId, confidence: 0.3 },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.revealVotes",
      { sessionId, keyResultId },
    );

    // Member reads: should now see both votes.
    const memberVotes = (await callAction(
      { pool: wb.appPool, ...context(MEMBER) },
      "sessions.votes",
      { sessionId, keyResultId },
    )) as Array<{ confidence: number }>;

    expect(memberVotes).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// P4-T07c: Blockers, the board and aging
// ---------------------------------------------------------------------------

/** Helper: advance a session through confidence (vote, reveal, confirm for
 * the KR at the given confidence), then into the diagnose stage. */
async function advanceToDiagnose(
  sessionId: string,
  confidence: number,
): Promise<void> {
  const wb = await workerDb();
  await callAction({ pool: wb.appPool, ...context() }, "sessions.castVote", {
    sessionId,
    keyResultId,
    confidence,
  });
  await callAction({ pool: wb.appPool, ...context() }, "sessions.revealVotes", {
    sessionId,
    keyResultId,
  });
  await callAction(
    { pool: wb.appPool, ...context() },
    "sessions.confirmConfidence",
    {
      sessionId,
      keyResultId,
      confidence,
      whatChanged: "Test note",
    },
  );
  await callAction(
    { pool: wb.appPool, ...context() },
    "sessions.advanceStage",
    { id: sessionId },
  );
}

describe("sessions.createBlocker (P4-T07c)", () => {
  it("stores a blocker due by its goal's next check-in (P9-T19a-a)", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();
    await advanceToDiagnose(sessionId, 0.3);

    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.createBlocker",
      {
        sessionId,
        keyResultId,
        type: "approach_not_working",
        ownerId: facilitatorMemberId,
        nextAction: "Try the guided setup with two pilot customers",
      },
    );

    expect((result as { id: string }).id).toBeTruthy();

    // Due at the end of the goal's next check-in day, the first one after
    // today, and never the same day: it was twenty-four hours from opening.
    const status = (await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.blockerStatus",
      { sessionId },
    )) as Array<{
      type: string;
      dueAt: string;
      dueOn: string;
      openedAt: string;
    }>;
    expect(status.length).toBe(1);
    const blocker = status[0] as (typeof status)[number];
    expect(blocker.type).toBe("approach_not_working");
    const { rows } = await wb.admin.query<{ next_check_in_at: Date }>(
      `select g.next_check_in_at from goals g
         join key_results k on k.goal_id = g.id where k.id = $1`,
      [keyResultId],
    );
    const nextCheckIn = rows[0]?.next_check_in_at as Date;
    expect(new Date(blocker.dueAt).getTime()).toBe(nextCheckIn.getTime());
    expect(blocker.dueOn > blocker.openedAt.slice(0, 10)).toBe(true);
  });
});

describe("sessions.resolveBlocker (P4-T07c)", () => {
  it("sets resolved_at", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();
    await advanceToDiagnose(sessionId, 0.3);

    const created = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.createBlocker",
      {
        sessionId,
        keyResultId,
        type: "dependency",
        ownerId: facilitatorMemberId,
        nextAction: "Follow up with platform team",
      },
    );

    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.resolveBlocker",
      { id: (created as { id: string }).id },
    );

    const status = (await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.blockerStatus",
      { sessionId },
    )) as Array<{ resolvedAt: string | null }>;

    expect(status[0]?.resolvedAt).not.toBeNull();
  });
});

describe("sessions.advanceStage — diagnose completion gate (P4-T07c)", () => {
  it("is refused when a low-confidence KR has no blocker (acceptance criterion)", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();

    // Confirm at 0.3 (below low threshold of 0.4) and advance to diagnose.
    await advanceToDiagnose(sessionId, 0.3);

    // No blocker created. Advancing from diagnose should fail.
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "sessions.advanceStage", {
        id: sessionId,
      }),
    ).rejects.toThrow(/below.*0\.4.*no blocker/i);
  });

  it("succeeds after a blocker is created for the low-confidence KR", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();
    await advanceToDiagnose(sessionId, 0.3);

    // Create the blocker.
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.createBlocker",
      {
        sessionId,
        keyResultId,
        type: "clarity",
        ownerId: facilitatorMemberId,
        nextAction: "Define acceptance criteria with the team",
      },
    );

    // Now advancing should succeed.
    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.advanceStage",
      { id: sessionId },
    );

    expect((result as { id: string }).id).toBe(sessionId);
  });

  it("does not require a blocker when confidence is above the low threshold", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();

    // Confirm at 0.5 (above low threshold) and advance to diagnose.
    await advanceToDiagnose(sessionId, 0.5);

    // No blocker needed. Advancing should succeed.
    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.advanceStage",
      { id: sessionId },
    );

    expect((result as { id: string }).id).toBe(sessionId);
  });
});

// ---------------------------------------------------------------------------
// P4-T08: Commitments, digest, streaks
// ---------------------------------------------------------------------------

/** Helper: advance a session through confidence and diagnose to commitments. */
async function advanceToCommitments(
  sessionId: string,
  confidence: number,
): Promise<void> {
  await advanceToDiagnose(sessionId, confidence);

  if (confidence < 0.4) {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.createBlocker",
      {
        sessionId,
        keyResultId,
        type: "resource",
        ownerId: facilitatorMemberId,
        nextAction: "Hire contractor",
      },
    );
  }

  const wb = await workerDb();
  await callAction(
    { pool: wb.appPool, ...context() },
    "sessions.advanceStage",
    { id: sessionId },
  );
}

describe("sessions.setCommitments (P4-T08)", () => {
  it("creates commitments for the session", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();
    await advanceToCommitments(sessionId, 0.5);

    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.setCommitments",
      {
        sessionId,
        items: [
          { text: "Ship the onboarding flow", ownerId: facilitatorMemberId },
          { text: "Review the Q3 pipeline", ownerId: memberMemberId },
        ],
      },
    );

    expect((result as { count: number }).count).toBe(2);
  });
});

describe("sessions.advanceStage commitments gate (P4-T08)", () => {
  it("is refused from commitments to digest with fewer than 2 commitments", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();
    await advanceToCommitments(sessionId, 0.5);

    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.setCommitments",
      {
        sessionId,
        items: [{ text: "Just one thing", ownerId: facilitatorMemberId }],
      },
    );

    await expect(
      callAction({ pool: wb.appPool, ...context() }, "sessions.advanceStage", {
        id: sessionId,
      }),
    ).rejects.toThrow(/at least 2 commitments/i);
  });

  it("succeeds with 2 commitments", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();
    await advanceToCommitments(sessionId, 0.5);

    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.setCommitments",
      {
        sessionId,
        items: [
          { text: "Ship the onboarding flow", ownerId: facilitatorMemberId },
          { text: "Review the Q3 pipeline", ownerId: memberMemberId },
        ],
      },
    );

    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.advanceStage",
      { id: sessionId },
    );
    expect((result as { id: string }).id).toBe(sessionId);
  });
});

describe("sessions.close digest and streak (P4-T08)", () => {
  it("generates a digest on session close", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();
    await advanceToCommitments(sessionId, 0.7);

    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.setCommitments",
      {
        sessionId,
        items: [
          { text: "Ship it", ownerId: facilitatorMemberId },
          { text: "Review it", ownerId: memberMemberId },
        ],
      },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.advanceStage",
      { id: sessionId },
    );

    await callAction({ pool: wb.appPool, ...context() }, "sessions.close", {
      id: sessionId,
    });

    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.read",
      { id: sessionId },
    );
    expect((read as { digestId: string | null }).digestId).not.toBeNull();
  });

  it("increments the streak on session close", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();
    await advanceToCommitments(sessionId, 0.7);

    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.setCommitments",
      {
        sessionId,
        items: [
          { text: "Ship it", ownerId: facilitatorMemberId },
          { text: "Review it", ownerId: memberMemberId },
        ],
      },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.advanceStage",
      { id: sessionId },
    );
    await callAction({ pool: wb.appPool, ...context() }, "sessions.close", {
      id: sessionId,
    });

    const streak = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.readStreak",
      { spaceId },
    );
    expect((streak as { currentWeeks: number }).currentWeeks).toBe(1);
  });

  it("resets the streak on session skip", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const s1 = await openSessionAtConfidence();
    await advanceToCommitments(s1, 0.7);
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.setCommitments",
      {
        sessionId: s1,
        items: [
          { text: "A", ownerId: facilitatorMemberId },
          { text: "B", ownerId: memberMemberId },
        ],
      },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.advanceStage",
      { id: s1 },
    );
    await callAction({ pool: wb.appPool, ...context() }, "sessions.close", {
      id: s1,
    });

    const s2 = await createSession();
    const s2Id = (s2 as { id: string }).id;
    await callAction({ pool: wb.appPool, ...context() }, "sessions.skip", {
      id: s2Id,
    });

    const streak = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.readStreak",
      { spaceId },
    );
    expect((streak as { currentWeeks: number }).currentWeeks).toBe(0);
  });
});

describe("the streak counts weeks of check-ins (completeness review M-04)", () => {
  async function holdWeeklyCheckIn(): Promise<void> {
    const wb = await workerDb();
    const sessionId = await openSessionAtConfidence();
    await advanceToCommitments(sessionId, 0.7);
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.setCommitments",
      {
        sessionId,
        items: [
          { text: "A", ownerId: facilitatorMemberId },
          { text: "B", ownerId: memberMemberId },
        ],
      },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.advanceStage",
      { id: sessionId },
    );
    await callAction({ pool: wb.appPool, ...context() }, "sessions.close", {
      id: sessionId,
    });
  }

  const readStreak = async () => {
    const wb = await workerDb();
    return (await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.readStreak",
      { spaceId },
    )) as { currentWeeks: number; longestWeeks: number };
  };

  const trend = async () => {
    const wb = await workerDb();
    return callAction(
      { pool: wb.appPool, ...context() },
      "sessions.confidenceTrend",
      { spaceId, weeks: 12 },
    );
  };

  it("counts two check-ins in one week as one week and one trend point", async () => {
    await createGoalWithKr();
    await holdWeeklyCheckIn();
    await holdWeeklyCheckIn();
    expect((await readStreak()).currentWeeks).toBe(1);
    expect(await trend()).toHaveLength(1);
  });

  it("adds neither a week nor a trend point for a monthly review", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    await holdWeeklyCheckIn();
    const monthly = (await createSession({
      kind: "monthly",
      title: "Monthly review",
    })) as { id: string };
    await callAction({ pool: wb.appPool, ...context() }, "sessions.open", {
      id: monthly.id,
    });
    await callAction({ pool: wb.appPool, ...context() }, "sessions.close", {
      id: monthly.id,
    });
    expect((await readStreak()).currentWeeks).toBe(1);
    // The monthly close used to add a point at 0.0, a collapse nobody saw.
    const points = await trend();
    expect(points).toHaveLength(1);
    expect(points[0]?.average).toBe(0.7);
  });

  it("reads as broken once a whole week passes with nothing held", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    await holdWeeklyCheckIn();
    expect((await readStreak()).currentWeeks).toBe(1);
    // As if the last check-in were three weeks ago and nobody pressed skip.
    await wb.admin.query(
      "update streaks set last_session_week = (current_date - 21) where space_id = $1",
      [spaceId],
    );
    const streak = await readStreak();
    expect(streak.currentWeeks).toBe(0);
    expect(streak.longestWeeks).toBe(1);
  });
});

describe("the commitment gate reads §11, not a copy of it (P6-G19a)", () => {
  it("names this workspace's own lower bound when it is refused", async () => {
    const wb = await workerDb();
    await createGoalWithKr();

    // A workspace that wants three a week. The gate held `const
    // MIN_COMMITMENTS = 2` under a comment naming this very registry entry,
    // so a workspace that moved the bound was still gated on the canon
    // default and told the wrong number.
    await callAction({ pool: wb.appPool, ...context() }, "rhythm.update", {
      overrides: { "sessions.weeklyCommitmentBounds": { low: 3, high: 4 } },
    });

    const sessionId = await openSessionAtConfidence();
    await advanceToCommitments(sessionId, 0.5);
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.setCommitments",
      {
        sessionId,
        items: [
          { text: "One", ownerId: facilitatorMemberId },
          { text: "Two", ownerId: memberMemberId },
        ],
      },
    );

    // Two would have passed the canon default. This workspace asked for three.
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "sessions.advanceStage", {
        id: sessionId,
      }),
    ).rejects.toThrow(/at least 3 commitments/i);
  });
});

describe("sessions.carriedCommitments (P6-G19a)", () => {
  it("lists an earlier session's open commitments and not this session's own", async () => {
    const wb = await workerDb();
    await createGoalWithKr();

    const lastWeek = await openSessionAtConfidence();
    await advanceToCommitments(lastWeek, 0.5);
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.setCommitments",
      {
        sessionId: lastWeek,
        items: [
          { text: "Carried across", ownerId: facilitatorMemberId },
          { text: "Also carried", ownerId: memberMemberId },
        ],
      },
    );

    const thisWeek = await openSessionAtConfidence();
    await advanceToCommitments(thisWeek, 0.5);
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.setCommitments",
      {
        sessionId: thisWeek,
        items: [{ text: "Set here, not carried", ownerId: memberMemberId }],
      },
    );

    const carried = (await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.carriedCommitments",
      { sessionId: thisWeek },
    )) as Array<{ id: string; text: string }>;

    expect(carried.map((one) => one.text).sort()).toEqual([
      "Also carried",
      "Carried across",
    ]);
  });

  it("drops one once it is closed, whichever verdict it was given", async () => {
    const wb = await workerDb();
    await createGoalWithKr();

    const lastWeek = await openSessionAtConfidence();
    await advanceToCommitments(lastWeek, 0.5);
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.setCommitments",
      {
        sessionId: lastWeek,
        items: [
          { text: "Delivered one", ownerId: facilitatorMemberId },
          { text: "Missed one", ownerId: memberMemberId },
        ],
      },
    );

    const thisWeek = await openSessionAtConfidence();
    const before = (await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.carriedCommitments",
      { sessionId: thisWeek },
    )) as Array<{ id: string; text: string }>;
    expect(before).toHaveLength(2);

    // Not delivered is still closed. §7.2 asks the room to say whether it
    // landed, not to keep asking until it does.
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.closeCommitments",
      {
        items: before.map((one) => ({ id: one.id, delivered: false })),
      },
    );

    const after = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.carriedCommitments",
      { sessionId: thisWeek },
    );
    expect(after).toEqual([]);
  });

  it("refuses a session id it cannot see, rather than answering empty", async () => {
    const wb = await workerDb();
    // An empty list would read as "that session had nothing carried in",
    // which is a different answer from "there is no such session".
    await expect(
      callAction(
        { pool: wb.appPool, ...context() },
        "sessions.carriedCommitments",
        { sessionId: "00000000-0000-4000-8000-000000000000" },
      ),
    ).rejects.toThrow(/no such session/i);
  });
});

/** Runs a whole weekly session and closes it, which writes the digest. */
async function holdAWeek(confidence: number): Promise<string> {
  const wb = await workerDb();
  const sessionId = await openSessionAtConfidence();
  await advanceToCommitments(sessionId, confidence);
  await callAction(
    { pool: wb.appPool, ...context() },
    "sessions.setCommitments",
    {
      sessionId,
      items: [
        { text: "One", ownerId: facilitatorMemberId },
        { text: "Two", ownerId: memberMemberId },
      ],
    },
  );
  await callAction(
    { pool: wb.appPool, ...context() },
    "sessions.advanceStage",
    { id: sessionId },
  );
  await callAction({ pool: wb.appPool, ...context() }, "sessions.close", {
    id: sessionId,
  });
  return sessionId;
}

describe("sessions.confidenceTrend (P6-G19b)", () => {
  it("answers nothing before a week has closed", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    await openSessionAtConfidence();

    const trend = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.confidenceTrend",
      { spaceId, weeks: 12 },
    );
    // Not a row of zeroes. A space that has never closed a week has no trend,
    // and drawing twelve empty columns would say something untrue about it.
    expect(trend).toEqual([]);
  });

  it("takes the figure from the digest the room read, not a second sum", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    await holdAWeek(0.6);

    const trend = (await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.confidenceTrend",
      { spaceId, weeks: 12 },
    )) as Array<{ weekStart: string; average: number }>;

    expect(trend).toHaveLength(1);
    expect(trend[0]?.average).toBeCloseTo(0.6, 5);
  });
});

describe("sessions.digest carries the coordinator's note (P6-G19b)", () => {
  it("returns what setCoordinatorNote wrote", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    // **After the close.** The note is written onto the digest row and
    // `sessions.close` is what creates it, so a note added on step 4 is
    // refused with "No digest exists for this session yet". That is why the
    // form sits after the close on the screen rather than on the stage §7.2
    // names, and this test is where that was found.
    const sessionId = await holdAWeek(0.6);

    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.setCoordinatorNote",
      { sessionId, note: "Hiring is the constraint, not the roadmap." },
    );

    const digest = (await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.digest",
      { sessionId },
    )) as { note: string | null } | null;

    // The digest builder has rendered this line since P4-T15b and the read did
    // not return it, so a surface could show the note it had just written only
    // by reloading somebody else's page.
    expect(digest?.note).toBe("Hiring is the constraint, not the roadmap.");
  });
});

/**
 * Session writes are authorised through what they belong to (completeness
 * review H-05), and a blocker records its goal (H-10).
 *
 * The three writes below used to check the workspace level and then act on a
 * bare id. A member with edit rights anywhere in the workspace could close or
 * take a blocker, or close a commitment, in a space they cannot see. The space
 * here is made private the way a space is: the workspace-wide group loses its
 * binding on the space's own context, and the space's members keep theirs.
 */
describe("session writes in a space the caller cannot see (H-05)", () => {
  const makeSpacePrivate = async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `update access_bindings b set deleted_at = now()
         from access_contexts c, access_groups g
        where b.context_id = c.id
          and b.group_id = g.id
          and c.workspace_id = $1
          and c.resource_type = 'space'
          and c.resource_id = $2
          and g.kind = 'workspace_standard'`,
      [workspaceId, spaceId],
    );
  };

  /** A workspace member with edit rights, who is not in the space. */
  const addOutsider = async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into workspace_members (id, workspace_id, user_id, name, status)
       values (gen_random_uuid(), $1, $2, 'Outsider', 'active')`,
      [workspaceId, OUTSIDER],
    );
  };

  const openBlocker = async (): Promise<string> => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();
    await advanceToDiagnose(sessionId, 0.3);
    const created = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.createBlocker",
      {
        sessionId,
        keyResultId,
        type: "resource",
        ownerId: facilitatorMemberId,
        nextAction: "Hire a contractor by Friday",
      },
    );
    return (created as { id: string }).id;
  };

  it("refuses to resolve a blocker in that space, as not found", async () => {
    const wb = await workerDb();
    const blockerId = await openBlocker();
    await addOutsider();
    await makeSpacePrivate();

    await expect(
      callAction(
        { pool: wb.appPool, ...context(OUTSIDER) },
        "sessions.resolveBlocker",
        { id: blockerId },
      ),
    ).rejects.toMatchObject({ code: "not_found" });

    const row = await wb.admin.query(
      "select resolved_at from blockers where id = $1",
      [blockerId],
    );
    expect(row.rows[0]?.resolved_at).toBeNull();
  });

  it("refuses to hand that blocker to anybody", async () => {
    const wb = await workerDb();
    const blockerId = await openBlocker();
    await addOutsider();
    await makeSpacePrivate();

    await expect(
      callAction(
        { pool: wb.appPool, ...context(OUTSIDER) },
        "sessions.reassignBlocker",
        { id: blockerId, ownerId: memberMemberId },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses to close a commitment in that space", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();
    await wb.admin.query(
      `insert into commitments (id, workspace_id, session_id, space_id,
                                week_start, text, owner_id)
       values (gen_random_uuid(), $1, $2, $3, current_date, 'Ship it', $4)`,
      [workspaceId, sessionId, spaceId, facilitatorMemberId],
    );
    const { rows } = await wb.admin.query<{ id: string }>(
      "select id from commitments where session_id = $1",
      [sessionId],
    );
    const commitmentId = rows[0]?.id as string;
    await addOutsider();
    await makeSpacePrivate();

    await expect(
      callAction(
        { pool: wb.appPool, ...context(OUTSIDER) },
        "sessions.closeCommitments",
        { items: [{ id: commitmentId, delivered: true }] },
      ),
    ).rejects.toMatchObject({ code: "not_found" });

    const after = await wb.admin.query(
      "select closed_at from commitments where id = $1",
      [commitmentId],
    );
    expect(after.rows[0]?.closed_at).toBeNull();
  });

  it("still lets a member of the space resolve it", async () => {
    const wb = await workerDb();
    const blockerId = await openBlocker();
    await makeSpacePrivate();

    await callAction(
      { pool: wb.appPool, ...context(MEMBER) },
      "sessions.resolveBlocker",
      { id: blockerId },
    );
    const row = await wb.admin.query(
      "select resolved_at from blockers where id = $1",
      [blockerId],
    );
    expect(row.rows[0]?.resolved_at).not.toBeNull();
  });

  it("refuses to close a commitment that does not exist, rather than counting it", async () => {
    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, ...context() },
        "sessions.closeCommitments",
        {
          items: [
            { id: "00000000-0000-4000-8000-000000000000", delivered: true },
          ],
        },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("a blocker raised in a session reaches its owner (H-10)", () => {
  it("records the key result's goal", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();
    await advanceToDiagnose(sessionId, 0.3);
    const created = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.createBlocker",
      {
        sessionId,
        keyResultId,
        type: "clarity",
        ownerId: memberMemberId,
        nextAction: "Agree the definition",
      },
    );
    const row = await wb.admin.query(
      "select goal_id from blockers where id = $1",
      [(created as { id: string }).id],
    );
    expect(row.rows[0]?.goal_id).toBe(goalId);
  });

  it("appears in the owner's review inbox", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();
    await advanceToDiagnose(sessionId, 0.3);
    const created = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.createBlocker",
      {
        sessionId,
        keyResultId,
        type: "clarity",
        ownerId: memberMemberId,
        nextAction: "Agree the definition",
      },
    );
    const inbox = await callAction(
      { pool: wb.appPool, ...context(MEMBER) },
      "review.inbox",
      {},
    );
    expect(inbox.obligations.map((obligation) => obligation.id)).toContain(
      `blocker:${(created as { id: string }).id}`,
    );
  });

  it("refuses a key result that is not in the workspace", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();
    await advanceToDiagnose(sessionId, 0.3);
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "sessions.createBlocker", {
        sessionId,
        keyResultId: "00000000-0000-4000-8000-000000000000",
        type: "clarity",
        ownerId: memberMemberId,
        nextAction: "Agree the definition",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("the confidence round the panel draws (completeness review M-03)", () => {
  const status = async (userId: string, sessionId: string) => {
    const wb = await workerDb();
    const rows = (await callAction(
      { pool: wb.appPool, ...context(userId) },
      "sessions.confidenceStatus",
      { sessionId },
    )) as Array<{
      keyResultId: string;
      teamVoting: boolean;
      votesCast: number;
      revealed: boolean;
      votes: { memberId: string; confidence: number }[];
      average: number | null;
      myVote: number | null;
    }>;
    return rows.find((row) => row.keyResultId === keyResultId);
  };

  it("shows a count and your own vote before reveal, and every vote and the average after", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    const sessionId = await openSessionAtConfidence();
    await callAction({ pool: wb.appPool, ...context() }, "sessions.castVote", {
      sessionId,
      keyResultId,
      confidence: 0.6,
    });
    await callAction(
      { pool: wb.appPool, ...context(MEMBER) },
      "sessions.castVote",
      { sessionId, keyResultId, confidence: 0.4 },
    );

    const before = await status(MEMBER, sessionId);
    expect(before).toMatchObject({
      teamVoting: true,
      votesCast: 2,
      revealed: false,
      votes: [],
      average: null,
      myVote: 0.4,
    });

    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.revealVotes",
      { sessionId, keyResultId },
    );
    const after = await status(MEMBER, sessionId);
    expect(after?.revealed).toBe(true);
    expect(after?.votes).toHaveLength(2);
    expect(after?.average).toBe(0.5);
  });

  it("says when voting is off, and the facilitator confirms without a vote", async () => {
    const wb = await workerDb();
    await createGoalWithKr();
    await callAction(
      { pool: wb.appPool, ...context() },
      "spaces.updateSettings",
      { id: spaceId, teamVoting: false },
    );
    const sessionId = await openSessionAtConfidence();
    expect((await status(FACILITATOR, sessionId))?.teamVoting).toBe(false);

    // Step 1 used to be impossible here: the panel waited for a vote the
    // server refuses.
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.confirmConfidence",
      {
        sessionId,
        keyResultId,
        confidence: 0.7,
        whatChanged: "Two deals closed",
      },
    );
    const rows = (await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.confidenceStatus",
      { sessionId },
    )) as Array<{ keyResultId: string; confirmed: boolean }>;
    expect(rows.find((row) => row.keyResultId === keyResultId)?.confirmed).toBe(
      true,
    );
  });
});
