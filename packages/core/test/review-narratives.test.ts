/**
 * Objective narratives and recognition (METHOD.md §8.1 stages 3 and 4,
 * p4-t00-session-design.md §4.4 and §4.5, P4-T10c).
 *
 * The task's test plan:
 * - the mic passes to exactly one participant at a time
 * - every client agrees who holds it
 *
 * The acceptance criterion: when the facilitator passes the mic, every
 * participant sees who is speaking.
 *
 * **Why the mic is a column and not a row per turn.** Exactly one objective
 * holds it, which is the property the stage exists to enforce, and a single
 * pointer is the only shape that cannot represent two holders. Every client
 * agrees because there is one write and they all read it, not because they
 * coordinate.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../src/rich-text/schema.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "narratives-facilitator";
const MEMBER = "narratives-member";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let facilitatorMemberId: string;
let memberMemberId: string;
let sessionId: string;
let firstGoalId: string;
let secondGoalId: string;

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

const narratives = async (userId = FACILITATOR) =>
  (await call("sessions.narratives", { sessionId }, userId)) as {
    micGoalId: string | null;
    objectives: {
      goalId: string;
      goalTitle: string;
      championName: string | null;
      hasMic: boolean;
      spokenAt: string | null;
      body: unknown;
      authorName: string | null;
    }[];
    spoken: number;
    total: number;
    complete: boolean;
  };

const recognition = async (userId = FACILITATOR) =>
  (await call("sessions.recognition", { sessionId }, userId)) as {
    entries: {
      id: string;
      fromName: string;
      toName: string;
      text: string;
      mine: boolean;
    }[];
    recipients: { memberId: string; name: string }[];
  };

/** A minimal valid editor document for the current rich text schema. */
const doc = (line: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: line }] }],
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)`,
    [
      FACILITATOR,
      "Facilitator",
      "narratives-facilitator@example.com",
      MEMBER,
      "Member",
      "narratives-member@example.com",
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

  const member = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Member', 'active') returning id`,
    [workspaceId, MEMBER],
  );
  memberMemberId = member.rows[0]?.id as string;
  await call("spaces.addMember", {
    spaceId,
    memberId: memberMemberId,
    role: "member",
  });

  // Two objectives, because a mic that only ever has one candidate cannot be
  // shown to hold exactly one.
  const first = (await call("goals.create", {
    title: "Become the platform mid-market teams reach for first",
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: facilitatorMemberId,
    reviewerId: facilitatorMemberId,
    weight: 1,
  })) as { id: string };
  firstGoalId = first.id;

  const second = (await call("goals.create", {
    title: "Make onboarding something a team finishes in one sitting",
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: memberMemberId,
    reviewerId: facilitatorMemberId,
    weight: 1,
  })) as { id: string };
  secondGoalId = second.id;

  const session = (await call("sessions.create", {
    spaceId,
    cycleId,
    kind: "quarterly",
    title: "Q1 review",
    scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    facilitatorId: facilitatorMemberId,
  })) as { id: string };
  sessionId = session.id;
  await call("sessions.open", { id: sessionId });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("sessions.passMic", () => {
  it("starts with nobody holding it", async () => {
    const status = await narratives();
    expect(status.micGoalId).toBeNull();
    expect(status.objectives.every((entry) => entry.hasMic === false)).toBe(
      true,
    );
    expect(status.spoken).toBe(0);
    expect(status.total).toBe(2);
    expect(status.complete).toBe(false);
  });

  it("gives it to exactly one objective, and every caller reads the same one", async () => {
    await call("sessions.passMic", { sessionId, goalId: firstGoalId });

    for (const viewer of [FACILITATOR, MEMBER]) {
      const status = await narratives(viewer);
      expect(status.micGoalId).toBe(firstGoalId);
      // The property the stage exists for, asserted as a count rather than as a
      // single lookup: two holders would pass a "the first one has it" check.
      expect(status.objectives.filter((entry) => entry.hasMic)).toHaveLength(1);
    }
  });

  it("moves it, and marks the objective it left as spoken", async () => {
    await call("sessions.passMic", { sessionId, goalId: firstGoalId });
    await call("sessions.passMic", { sessionId, goalId: secondGoalId });

    const status = await narratives();
    expect(status.micGoalId).toBe(secondGoalId);
    expect(status.objectives.filter((entry) => entry.hasMic)).toHaveLength(1);

    const first = status.objectives.find(
      (entry) => entry.goalId === firstGoalId,
    );
    // §4.4's "facilitator marks each as spoken", done by the pass itself: the
    // mic moving on is what says the last owner finished.
    expect(first?.spokenAt).not.toBeNull();
    // Spoken but never typed, which §8.1's nine minutes of talking makes the
    // ordinary case.
    expect(first?.body).toBeNull();
    expect(first?.authorName).toBeNull();
    expect(status.spoken).toBe(1);
    expect(status.complete).toBe(false);
  });

  it("puts the mic down, so the last owner is spoken for too", async () => {
    await call("sessions.passMic", { sessionId, goalId: firstGoalId });
    await call("sessions.passMic", { sessionId, goalId: secondGoalId });
    // Null is the stage ending. Without it the last objective would never be
    // marked, because nothing takes the mic after it.
    await call("sessions.passMic", { sessionId, goalId: null });

    const status = await narratives();
    expect(status.micGoalId).toBeNull();
    expect(status.spoken).toBe(2);
    expect(status.complete).toBe(true);
  });

  it("does not un-speak an objective the mic returns to", async () => {
    await call("sessions.passMic", { sessionId, goalId: firstGoalId });
    await call("sessions.passMic", { sessionId, goalId: secondGoalId });
    // A room goes back to an objective for a question. That is not the first
    // owner un-telling their story.
    await call("sessions.passMic", { sessionId, goalId: firstGoalId });

    const status = await narratives();
    expect(status.micGoalId).toBe(firstGoalId);
    expect(
      status.objectives.find((entry) => entry.goalId === firstGoalId)?.spokenAt,
    ).not.toBeNull();
  });

  it("refuses anybody but the facilitator", async () => {
    // §4.4 gives the pass-the-mic control to the facilitator. The write-access
    // floor here is `edit` for every active member (P3-T16), so `edit` alone
    // would let any participant take the mic off whoever is speaking.
    await expect(
      call("sessions.passMic", { sessionId, goalId: firstGoalId }, MEMBER),
    ).rejects.toThrow(/facilitator/i);
    expect((await narratives()).micGoalId).toBeNull();
  });

  it("refuses an objective outside the review's space and cycle", async () => {
    const otherSpace = (await call("spaces.create", {
      name: "Another space",
    })) as { id: string };
    const outside = (await call("goals.create", {
      title: "Something this review does not cover",
      cycleId,
      spaceId: otherSpace.id,
      level: "team",
      ownerKind: "space",
      championId: facilitatorMemberId,
      reviewerId: facilitatorMemberId,
      weight: 1,
    })) as { id: string };

    // The mic names a goal, and a goal from another space would put the stage
    // on an objective the room is not reviewing.
    await expect(
      call("sessions.passMic", { sessionId, goalId: outside.id }),
    ).rejects.toThrow();
  });

  it("is refused on a session that has no narratives stage", async () => {
    const weekly = (await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      facilitatorId: facilitatorMemberId,
    })) as { id: string };

    await expect(
      call("sessions.passMic", { sessionId: weekly.id, goalId: firstGoalId }),
    ).rejects.toThrow(/quarterly/i);
  });
});

describe("sessions.setNarrative", () => {
  it("stores what the number does not show, with its author", async () => {
    await call("sessions.setNarrative", {
      sessionId,
      goalId: firstGoalId,
      body: doc("We hit 210 of 300 and the funnel was never the problem."),
    });

    const status = await narratives();
    const first = status.objectives.find(
      (entry) => entry.goalId === firstGoalId,
    );
    expect(first?.body).not.toBeNull();
    expect(first?.authorName).toBe("Facilitator");
    // Writing is not speaking. The stage is not complete because somebody typed.
    expect(first?.spokenAt).toBeNull();
    expect(status.spoken).toBe(0);
  });

  it("lets the room write, not only the facilitator", async () => {
    // §8.1 stage 3 is owner by owner, and the second objective's champion is
    // not the facilitator. A narrative only the facilitator could write would be
    // the facilitator telling somebody else's story.
    await call(
      "sessions.setNarrative",
      {
        sessionId,
        goalId: secondGoalId,
        body: doc("Onboarding landed, but only for teams under ten."),
      },
      MEMBER,
    );

    const status = await narratives();
    expect(
      status.objectives.find((entry) => entry.goalId === secondGoalId)
        ?.authorName,
    ).toBe("Member");
  });

  it("rewrites rather than storing two narratives for one objective", async () => {
    await call("sessions.setNarrative", {
      sessionId,
      goalId: firstGoalId,
      body: doc("First pass at it."),
    });
    await call("sessions.setNarrative", {
      sessionId,
      goalId: firstGoalId,
      body: doc("Second pass, after the room pushed back."),
    });

    const status = await narratives();
    expect(status.objectives).toHaveLength(2);
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ count: string }>(
      `select count(*) from review_narratives
        where session_id = $1 and goal_id = $2 and deleted_at is null`,
      [sessionId, firstGoalId],
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("clears the body without losing that the objective was spoken for", async () => {
    await call("sessions.passMic", { sessionId, goalId: firstGoalId });
    await call("sessions.passMic", { sessionId, goalId: null });
    await call("sessions.setNarrative", {
      sessionId,
      goalId: firstGoalId,
      body: doc("Typed, then thought better of it."),
    });
    await call("sessions.setNarrative", {
      sessionId,
      goalId: firstGoalId,
      body: null,
    });

    const status = await narratives();
    const first = status.objectives.find(
      (entry) => entry.goalId === firstGoalId,
    );
    expect(first?.body).toBeNull();
    expect(first?.authorName).toBeNull();
    // Deleting the note is not un-telling the story.
    expect(first?.spokenAt).not.toBeNull();
  });

  it("refuses something that is not editor JSON", async () => {
    // Rich text is validated at the boundary, never stored as Markdown or as
    // whatever a caller sent.
    await expect(
      call("sessions.setNarrative", {
        sessionId,
        goalId: firstGoalId,
        body: "**not editor JSON**",
      }),
    ).rejects.toThrow();
    expect(RICH_TEXT_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});

describe("sessions.giveKudos", () => {
  it("offers everybody but the reader as a recipient", async () => {
    // Who may be named is the same decision the action enforces, so the read
    // answers it rather than leaving the screen to work it out. The reader is
    // absent for the reason the action refuses them.
    const mine = await recognition();
    expect(mine.recipients.map((person) => person.name)).toEqual(["Member"]);

    const theirs = await recognition(MEMBER);
    expect(theirs.recipients.map((person) => person.name)).toEqual([
      "Facilitator",
    ]);
  });

  it("does not offer the seeded agents as recipients", async () => {
    // The Coach and the Champion are members of every workspace (P4-T05a,
    // P4-T06a). Recognition names a person's effort, and an agent in that list
    // is the product inviting the room to thank a scheduler.
    const names = (await recognition()).recipients.map((person) => person.name);
    expect(names).not.toContain("OKR Coach");
    expect(names).not.toContain("OKR Champion");
  });

  it("records recognition with both names", async () => {
    await call("sessions.giveKudos", {
      sessionId,
      toMemberId: memberMemberId,
      text: "Rewrote the onboarding emails twice in a week and never mentioned it.",
    });

    const status = await recognition();
    expect(status.entries).toHaveLength(1);
    expect(status.entries[0]?.fromName).toBe("Facilitator");
    expect(status.entries[0]?.toName).toBe("Member");
    expect(status.entries[0]?.mine).toBe(true);
  });

  it("lets anybody in the room give it", async () => {
    await call(
      "sessions.giveKudos",
      {
        sessionId,
        toMemberId: facilitatorMemberId,
        text: "Kept the review on time without cutting anybody off.",
      },
      MEMBER,
    );

    // §8.1 asks the room to name what it saw, so recognition is not the
    // facilitator's to hand out alone.
    const status = await recognition(MEMBER);
    expect(status.entries[0]?.fromName).toBe("Member");
    expect(status.entries[0]?.mine).toBe(true);
    // Read by somebody else, the same row is not theirs.
    expect((await recognition()).entries[0]?.mine).toBe(false);
  });

  it("keeps two pieces of recognition for the same person", async () => {
    await call("sessions.giveKudos", {
      sessionId,
      toMemberId: memberMemberId,
      text: "The onboarding emails.",
    });
    await call("sessions.giveKudos", {
      sessionId,
      toMemberId: memberMemberId,
      text: "And the migration nobody asked them to write.",
    });

    // Specific beats generous, so the second thing must not overwrite the
    // first. Nothing here is unique on the pair.
    expect((await recognition()).entries).toHaveLength(2);
  });

  it("refuses recognising yourself", async () => {
    await expect(
      call("sessions.giveKudos", {
        sessionId,
        toMemberId: facilitatorMemberId,
        text: "I was great.",
      }),
    ).rejects.toThrow();
  });

  it("refuses empty recognition", async () => {
    await expect(
      call("sessions.giveKudos", {
        sessionId,
        toMemberId: memberMemberId,
        text: "   ",
      }),
    ).rejects.toThrow();
  });

  it("refuses somebody who is not in the room's workspace", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberMemberId],
    );

    // A suspended member is excluded from every access-scoped read, and
    // recognising one would name somebody the room cannot see.
    await expect(
      call("sessions.giveKudos", {
        sessionId,
        toMemberId: memberMemberId,
        text: "Still here in my head.",
      }),
    ).rejects.toThrow();
  });
});

describe("access", () => {
  it("hides both reads from a suspended member", async () => {
    // **Not "a member outside the space".** P3-T01's `workspace_standard`
    // binding gives every active member `edit` across the workspace, a recorded
    // and reversible decision on the P3-T16 row, so removing somebody from a
    // space removes nothing: a test asserting that refusal fails, and it did
    // here before this comment existed. The refusal that is real is suspension,
    // which every access-scoped read excludes.
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberMemberId],
    );

    await expect(narratives(MEMBER)).rejects.toThrow();
    await expect(recognition(MEMBER)).rejects.toThrow();
    expect(spaceId).toBeTruthy();
  });
});
