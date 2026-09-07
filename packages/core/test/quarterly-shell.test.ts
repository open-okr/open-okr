/**
 * The quarterly review's shell (METHOD.md §8.1, p4-t00-session-design.md §4,
 * P4-T10a-a).
 *
 * The task's test plan:
 * - stage changes reach every connected client inside the budget, tested here
 *   as: advancing returns the realtime channel and event, and `sessions.read`
 *   always answers with the current stage
 * - facilitator notes are never visible to a participant
 *
 * The acceptance criterion, that every participant's rail moves and the timer
 * restarts, is one write: `stage_key` and `stage_started_at` move together, so
 * a client that re-reads sees both. The browser half is the end-to-end spec.
 */

import { REVIEW_STAGE_KEYS } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "quarterly-facilitator";
const PARTICIPANT = "quarterly-participant";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let facilitatorMemberId: string;
let participantMemberId: string;
let sessionId: string;

const context = (userId = FACILITATOR) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const call = async (name: string, input: unknown, userId = FACILITATOR) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...context(userId) },
    name as never,
    input as never,
  );
};

const read = async (userId = FACILITATOR) =>
  (await call("sessions.read", { id: sessionId }, userId)) as {
    state: string;
    stageKey: string | null;
    stageStartedAt: string | null;
    elapsed: Record<string, number>;
    notes: Record<string, unknown>;
    addedMinutes: Record<string, number>;
  };

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)`,
    [
      FACILITATOR,
      "Facilitator",
      "quarterly-facilitator@example.com",
      PARTICIPANT,
      "Participant",
      "quarterly-participant@example.com",
    ],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: FACILITATOR,
    name: "Facilitator",
  });
  workspaceId = provisioned.workspaceId;
  facilitatorMemberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const current = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  cycleId = current.id;

  const participant = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Participant', 'active') returning id`,
    [workspaceId, PARTICIPANT],
  );
  participantMemberId = participant.rows[0]?.id as string;
  await call("spaces.addMember", {
    spaceId,
    memberId: participantMemberId,
    role: "member",
  });

  const session = (await call("sessions.create", {
    spaceId,
    cycleId,
    kind: "quarterly",
    title: "Q1 review",
    scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    facilitatorId: facilitatorMemberId,
  })) as { id: string };
  sessionId = session.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the eleven-stage machine", () => {
  it("opens at stage one", async () => {
    await call("sessions.open", { id: sessionId });
    const after = await read();
    expect(after.state).toBe("running");
    // §8.1 stage 1 is Open and check-in. A quarterly session that opened with
    // no stage would render the rail with nothing current.
    expect(after.stageKey).toBe(REVIEW_STAGE_KEYS[0]);
    expect(after.stageStartedAt).not.toBeNull();
  });

  it("walks every stage in §8.1's order and refuses past the last", async () => {
    await call("sessions.open", { id: sessionId });

    for (let index = 1; index < REVIEW_STAGE_KEYS.length; index += 1) {
      await call("sessions.advanceStage", { id: sessionId });
      expect((await read()).stageKey).toBe(REVIEW_STAGE_KEYS[index]);
    }

    // Eleven is the end. Closing is the move, and saying so is better than
    // silently staying put.
    await expect(
      call("sessions.advanceStage", { id: sessionId }),
    ).rejects.toThrow(/last stage/i);
  });

  it("records the seconds spent on the stage it leaves", async () => {
    await call("sessions.open", { id: sessionId });
    await call("sessions.advanceStage", { id: sessionId });

    const after = await read();
    // The pacing cue needs a number to pace against, and the minutes come from
    // §11 while the seconds come from here.
    expect(Object.keys(after.elapsed)).toContain(REVIEW_STAGE_KEYS[0]);
  });

  it("returns the realtime channel so every client can be told", async () => {
    await call("sessions.open", { id: sessionId });
    const result = (await call("sessions.advanceStage", {
      id: sessionId,
    })) as { realtimeChannel: string };
    expect(result.realtimeChannel).toContain(sessionId);
  });
});

describe("sessions.addMinute", () => {
  it("extends the current stage and nothing else", async () => {
    await call("sessions.open", { id: sessionId });
    await call("sessions.addMinute", { id: sessionId });
    await call("sessions.addMinute", { id: sessionId });

    const after = await read();
    expect(after.addedMinutes[REVIEW_STAGE_KEYS[0] as string]).toBe(2);
    // §8.1: "Going over is normal and visible." Adding a minute to stage one
    // must not quietly move the whole agenda.
    expect(after.addedMinutes[REVIEW_STAGE_KEYS[1] as string]).toBeUndefined();
  });

  it("is the facilitator's control, not the room's", async () => {
    await call("sessions.open", { id: sessionId });
    await expect(
      call("sessions.addMinute", { id: sessionId }, PARTICIPANT),
    ).rejects.toThrow(/facilitator/i);
  });

  it("is refused when no stage is running", async () => {
    await expect(
      call("sessions.addMinute", { id: sessionId }),
    ).rejects.toThrow();
  });
});

describe("private facilitator notes", () => {
  it("are written and read back by the facilitator", async () => {
    await call("sessions.open", { id: sessionId });
    await call("sessions.setStageNote", {
      id: sessionId,
      note: "Ask Dita about the activation number before stage two.",
    });

    const mine = await read();
    expect(mine.notes[REVIEW_STAGE_KEYS[0] as string]).toBe(
      "Ask Dita about the activation number before stage two.",
    );
  });

  it("are never visible to a participant", async () => {
    // The task's second test-plan line, and it was a real leak: `sessions.read`
    // returned the whole `notes` map to every caller from P4-T07a onward.
    // Nothing wrote notes yet, so nothing had leaked, and the shape was still
    // wrong.
    await call("sessions.open", { id: sessionId });
    await call("sessions.setStageNote", {
      id: sessionId,
      note: "Watch for polite scoring. The pulse was 2.6.",
    });

    const theirs = await read(PARTICIPANT);
    expect(theirs.notes).toEqual({});
    // They still see the stage: the note is private, the ritual is not.
    expect(theirs.stageKey).toBe(REVIEW_STAGE_KEYS[0]);
  });

  it("are the facilitator's to write, not the room's", async () => {
    await call("sessions.open", { id: sessionId });
    await expect(
      call(
        "sessions.setStageNote",
        { id: sessionId, note: "Anybody could write this." },
        PARTICIPANT,
      ),
    ).rejects.toThrow(/facilitator/i);
  });

  it("keeps one note per stage rather than one per session", async () => {
    await call("sessions.open", { id: sessionId });
    await call("sessions.setStageNote", { id: sessionId, note: "Stage one." });
    await call("sessions.advanceStage", { id: sessionId });
    await call("sessions.setStageNote", { id: sessionId, note: "Stage two." });

    const after = await read();
    expect(after.notes[REVIEW_STAGE_KEYS[0] as string]).toBe("Stage one.");
    expect(after.notes[REVIEW_STAGE_KEYS[1] as string]).toBe("Stage two.");
  });
});

describe("the weekly session is untouched", () => {
  it("still opens at its own first stage", async () => {
    // The stage machine is now two lists behind one action, and the weekly one
    // is what P4-T07a's suite asserts. This is the cheap guard that the
    // quarterly branch did not reach into it.
    const weekly = (await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      facilitatorId: facilitatorMemberId,
    })) as { id: string };
    await call("sessions.open", { id: weekly.id });

    const after = (await call("sessions.read", { id: weekly.id })) as {
      stageKey: string;
    };
    expect(after.stageKey).toBe("confidence");
  });
});
