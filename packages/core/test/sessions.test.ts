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
    expect(typeof elapsed["confidence"]).toBe("number");
    expect(elapsed["confidence"]).toBeGreaterThanOrEqual(0);
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
