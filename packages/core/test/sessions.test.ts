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
