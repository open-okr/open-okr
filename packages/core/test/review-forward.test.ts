/**
 * Learnings, next-cycle drafts, decisions and actions (METHOD.md §8.9 and §8.1
 * stage 11, p4-t00-session-design.md §4.10, P4-T11c-b).
 *
 * The task's test plan:
 * - a top-voted retro theme promotes into a learning
 * - an action with no owner is refused
 *
 * **The third line moved to P4-T12.** "The lowest process-health statement
 * becomes an issue in the next cycle" is §8.9's feed-forward, which writes
 * `cycle_issues` rows into the *next* cycle. P4-T12 is titled "Minutes, exports
 * and review feed-forward" and owns that mapping; this row builds the tables it
 * will read. Recorded in IMPLEMENTATION-PLAN rather than left as a silent gap.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "forward-facilitator";
const MEMBER = "forward-member";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let facilitatorMemberId: string;
let memberMemberId: string;
let sessionId: string;
let goalId: string;

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

const forward = async (userId = FACILITATOR) =>
  (await call("sessions.forward", { sessionId }, userId)) as {
    learnings: {
      id: string;
      text: string;
      carryForward: boolean;
      source: string;
      authorName: string | null;
    }[];
    promotable: { noteId: string; text: string; votes: number }[];
    drafts: { id: string; title: string; why: string; promoted: boolean }[];
    actions: {
      id: string;
      what: string;
      ownerName: string;
      dueOn: string;
      done: boolean;
    }[];
    owners: { memberId: string; name: string }[];
    carried: number;
  };

const tomorrow = () => {
  const date = new Date(Date.now() + 86_400_000);
  return date.toISOString().slice(0, 10);
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Facilitator', $2), ($3, 'Member', $4)`,
    [
      FACILITATOR,
      "forward-facilitator@example.com",
      MEMBER,
      "forward-member@example.com",
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

  const goal = (await call("goals.create", {
    title: "Become the platform mid-market teams reach for first",
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: facilitatorMemberId,
    reviewerId: facilitatorMemberId,
    weight: 1,
  })) as { id: string };
  goalId = goal.id;

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

describe("learnings", () => {
  it("records one, not carried by default", async () => {
    await call("sessions.captureLearning", {
      sessionId,
      text: "We learned that a dependency nobody owns is a dependency nobody clears.",
    });

    const status = await forward();
    expect(status.learnings).toHaveLength(1);
    expect(status.learnings[0]?.source).toBe("manual");
    // §8.9's own rule: carried work re-enters as an issue and has to survive
    // prioritisation on its merits. A default of true is the free pass it
    // refuses.
    expect(status.learnings[0]?.carryForward).toBe(false);
    expect(status.carried).toBe(0);
  });

  it("marks the ones to carry forward", async () => {
    await call("sessions.captureLearning", {
      sessionId,
      text: "We learned that the onboarding funnel was never the constraint.",
      carryForward: true,
    });
    expect((await forward()).carried).toBe(1);
  });

  it("refuses an empty learning", async () => {
    await expect(
      call("sessions.captureLearning", { sessionId, text: "   " }),
    ).rejects.toThrow();
  });
});

describe("promoting a retro theme", () => {
  /** Adds a retro note and spends the given number of dots on it. */
  const notedAndVoted = async (text: string, voters: readonly string[]) => {
    const note = (await call("sessions.addRetroNote", {
      sessionId,
      columnKey: "didnt",
      text,
      anonymous: false,
    })) as { id: string };
    for (const voter of voters) {
      await call(
        "sessions.castRetroVote",
        { sessionId, noteId: note.id },
        voter,
      );
    }
    return note;
  };

  it("offers the board most-voted first, which is what §8.9 promotes", async () => {
    const quiet = await notedAndVoted("Something nobody voted for.", []);
    const loud = await notedAndVoted("The dependency surfaced in week nine.", [
      FACILITATOR,
      MEMBER,
    ]);

    const status = await forward();
    // §8.9 promotes the top dot-voted themes, so the stage needs the board's
    // verdict in front of it rather than asking the room to remember it.
    expect(status.promotable[0]?.noteId).toBe(loud.id);
    expect(status.promotable[0]?.votes).toBe(2);
    expect(status.promotable[1]?.noteId).toBe(quiet.id);
  });

  it("promotes a theme into a learning that names the note it came from", async () => {
    const note = await notedAndVoted("Leadership changed the target twice.", [
      FACILITATOR,
    ]);

    await call("sessions.captureLearning", {
      sessionId,
      text: "We learned that a target changed mid-cycle costs more than the change is worth.",
      carryForward: true,
      retroNoteId: note.id,
    });

    const status = await forward();
    expect(status.learnings[0]?.source).toBe("retro_theme");
    // Promoted notes leave the list, because the learning they became is above
    // it rather than because they are unavailable.
    expect(status.promotable).toHaveLength(0);
  });

  it("refuses promoting the same theme twice", async () => {
    const note = await notedAndVoted("One theme.", [FACILITATOR]);
    await call("sessions.captureLearning", {
      sessionId,
      text: "We learned that once.",
      retroNoteId: note.id,
    });

    // Promoting twice would double a theme's weight in the next cycle, which is
    // the opposite of what dot voting was for.
    await expect(
      call("sessions.captureLearning", {
        sessionId,
        text: "We learned that twice.",
        retroNoteId: note.id,
      }),
    ).rejects.toThrow(/already/i);
  });

  it("refuses a note from another review", async () => {
    const other = (await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "quarterly",
      title: "Q2 review",
      scheduledFor: new Date(Date.now() + 7_200_000).toISOString(),
      facilitatorId: facilitatorMemberId,
    })) as { id: string };
    await call("sessions.open", { id: other.id });
    const note = (await call("sessions.addRetroNote", {
      sessionId: other.id,
      columnKey: "worked",
      text: "Another review's note.",
      anonymous: false,
    })) as { id: string };

    await expect(
      call("sessions.captureLearning", {
        sessionId,
        text: "We learned that from somewhere else.",
        retroNoteId: note.id,
      }),
    ).rejects.toThrow();
  });
});

describe("next-cycle drafts", () => {
  it("records a title with its why", async () => {
    await call("sessions.draftNextCycle", {
      sessionId,
      title: "Make the platform something a team can adopt without us",
      why: "Three of five losses last quarter were onboarding, not features.",
    });

    const status = await forward();
    expect(status.drafts).toHaveLength(1);
    // A draft is a candidate, not a commitment: §8.9 has carried work
    // re-entering as an issue and earning its place.
    expect(status.drafts[0]?.promoted).toBe(false);
  });

  it("refuses a draft with no why", async () => {
    await expect(
      call("sessions.draftNextCycle", {
        sessionId,
        title: "Something we liked the sound of",
        why: "  ",
      }),
    ).rejects.toThrow();
  });
});

describe("actions", () => {
  it("takes an owner and a date, and reports both back", async () => {
    await call("sessions.addAction", {
      sessionId,
      what: "Write the dependency contract with the platform space",
      ownerId: memberMemberId,
      dueOn: tomorrow(),
    });

    const status = await forward();
    expect(status.actions).toHaveLength(1);
    expect(status.actions[0]?.ownerName).toBe("Member");
    expect(status.actions[0]?.dueOn).toBe(tomorrow());
    expect(status.actions[0]?.done).toBe(false);
  });

  it("refuses an action with no owner", async () => {
    // §8.1 stage 11: "Every action has a name and a date, or it is a wish."
    // Optional columns would let the product store the exact thing the stage
    // exists to prevent, which is why they are not null.
    await expect(
      call("sessions.addAction", {
        sessionId,
        what: "Somebody should look at this",
        dueOn: tomorrow(),
      }),
    ).rejects.toThrow();
  });

  it("refuses an action with no date", async () => {
    await expect(
      call("sessions.addAction", {
        sessionId,
        what: "We will get to it",
        ownerId: memberMemberId,
      }),
    ).rejects.toThrow();
  });

  it("refuses a suspended owner", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberMemberId],
    );
    // An action owned by a suspended member is an action with nobody on it,
    // which is the wish §8.1 refuses.
    await expect(
      call("sessions.addAction", {
        sessionId,
        what: "Owned by nobody",
        ownerId: memberMemberId,
        dueOn: tomorrow(),
      }),
    ).rejects.toThrow();
  });

  it("lists actions soonest first, so it reads as a schedule", async () => {
    const later = new Date(Date.now() + 10 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await call("sessions.addAction", {
      sessionId,
      what: "The later one, typed first",
      ownerId: facilitatorMemberId,
      dueOn: later,
    });
    await call("sessions.addAction", {
      sessionId,
      what: "The sooner one, typed second",
      ownerId: facilitatorMemberId,
      dueOn: tomorrow(),
    });

    const status = await forward();
    expect(status.actions[0]?.what).toContain("sooner");
  });

  it("can be ticked and unticked, because a mistake in a running room is normal", async () => {
    const action = (await call("sessions.addAction", {
      sessionId,
      what: "Ticked by accident",
      ownerId: facilitatorMemberId,
      dueOn: tomorrow(),
    })) as { id: string };

    await call("sessions.completeAction", {
      sessionId,
      actionId: action.id,
      done: true,
    });
    expect((await forward()).actions[0]?.done).toBe(true);

    await call("sessions.completeAction", {
      sessionId,
      actionId: action.id,
      done: false,
    });
    expect((await forward()).actions[0]?.done).toBe(false);
  });

  it("offers only active humans as owners", async () => {
    // The seeded Coach and Champion are members of every workspace. An action
    // owned by a scheduler is an action with nobody on it.
    const names = (await forward()).owners.map((entry) => entry.name);
    expect(names).toContain("Facilitator");
    expect(names).toContain("Member");
    expect(names).not.toContain("OKR Coach");
    expect(names).not.toContain("OKR Champion");
  });
});

describe("what the close screen reads back", () => {
  it("hands the review's decision to the goal that was decided", async () => {
    await call("sessions.decideObjective", {
      sessionId,
      goalId,
      decision: "modify",
      why: "The target moved when the market did.",
    });

    // **This is what "written back to the goal on close" means**, settled by
    // Agung on 26 August 2026: the decision stays in `review_decisions` and the
    // close screen reads it as its default, because a close needs a
    // retrospective the review never collects.
    const read = (await call("goals.reviewDecision", { id: goalId })) as {
      decision: string | null;
      why: string | null;
      sessionTitle: string | null;
    };
    expect(read.decision).toBe("modify");
    expect(read.why).toContain("market did");
    expect(read.sessionTitle).toBe("Q1 review");
  });

  it("hands back nothing for a goal no review decided", async () => {
    const read = (await call("goals.reviewDecision", { id: goalId })) as {
      decision: string | null;
    };
    expect(read.decision).toBeNull();
  });

  it("gives the later review's answer when a goal was reviewed twice", async () => {
    await call("sessions.decideObjective", {
      sessionId,
      goalId,
      decision: "keep",
      why: "First conversation.",
    });

    const second = (await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "quarterly",
      title: "Q2 review",
      scheduledFor: new Date(Date.now() + 7_200_000).toISOString(),
      facilitatorId: facilitatorMemberId,
    })) as { id: string };
    await call("sessions.open", { id: second.id });
    await call("sessions.decideObjective", {
      sessionId: second.id,
      goalId,
      decision: "abandon",
      why: "Second conversation, and it settled it.",
    });

    // A goal reviewed twice was discussed twice, and the later conversation is
    // the one that stands.
    const read = (await call("goals.reviewDecision", { id: goalId })) as {
      decision: string | null;
      sessionTitle: string | null;
    };
    expect(read.decision).toBe("abandon");
    expect(read.sessionTitle).toBe("Q2 review");
  });
});
