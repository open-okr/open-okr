/**
 * The two retros (METHOD.md §8.1 stages 5 and 6, §8.7,
 * p4-t00-session-design.md §4.6 and §4.7, P4-T11a).
 *
 * The task's test plan:
 * - a dot vote cannot be spent twice by one member
 * - the two retros are visible to different audiences
 *
 * The acceptance criterion: given a team retro with three notes, when members
 * vote, the top-voted note is identifiable and each member's votes are capped.
 *
 * **Two caps, not one.** A member gets one dot per note, held by a unique index,
 * and `sessions.retroDotsPerMember` dots in total, held by the action because it
 * counts across rows no index can see. Spending two on one note is how a member
 * turns three dots into one loud opinion; spending four in total is simply more
 * than the room agreed to give anybody.
 */
import { resolveThresholds } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "retro-facilitator";
const MANAGER = "retro-manager";
const MEMBER = "retro-member";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let facilitatorMemberId: string;
let managerMemberId: string;
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

const retro = async (userId = FACILITATOR) =>
  (await call("sessions.retro", { sessionId }, userId)) as {
    columns: {
      columnKey: string;
      notes: {
        id: string;
        text: string;
        votes: number;
        mine: boolean;
        authorName: string | null;
      }[];
    }[];
    dotsPerMember: number;
    dotsSpent: number;
    dotsLeft: number;
  };

const management = async (userId = FACILITATOR) =>
  (await call("sessions.managementRetro", { sessionId }, userId)) as {
    questions: {
      questionKey: number;
      question: string;
      body: string | null;
      answeredByName: string | null;
    }[];
    answered: number;
    complete: boolean;
  };

const addNote = async (
  columnKey: string,
  text: string,
  userId = FACILITATOR,
  anonymous = false,
) =>
  (await call(
    "sessions.addRetroNote",
    { sessionId, columnKey, text, anonymous },
    userId,
  )) as { id: string };

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email)
     values ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)`,
    [
      FACILITATOR,
      "Facilitator",
      "retro-facilitator@example.com",
      MANAGER,
      "Manager",
      "retro-manager@example.com",
      MEMBER,
      "Member",
      "retro-member@example.com",
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

  for (const [userId, name, role] of [
    [MANAGER, "Manager", "manager"],
    [MEMBER, "Member", "member"],
  ] as const) {
    const row = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, user_id, name, status)
       values (gen_random_uuid(), $1, $2, $3, 'active') returning id`,
      [workspaceId, userId, name],
    );
    const memberId = row.rows[0]?.id as string;
    if (role === "manager") {
      managerMemberId = memberId;
    }
    await call("spaces.addMember", { spaceId, memberId, role });
  }

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

describe("the team retro board", () => {
  it("keeps §8.1's two columns and refuses a third", async () => {
    await addNote("worked", "The weekly check-in actually happened.");
    await addNote("didnt", "We found the dependency in week nine.");

    const board = await retro();
    expect(board.columns.map((entry) => entry.columnKey)).toEqual([
      "worked",
      "didnt",
    ]);
    expect(board.columns[0]?.notes).toHaveLength(1);
    expect(board.columns[1]?.notes).toHaveLength(1);

    // The two columns are canon structure, not a preference.
    await expect(addNote("puzzled", "Somewhere in between.")).rejects.toThrow();
  });

  it("writes anonymously when asked, and names the author otherwise", async () => {
    // §8.1 asks for silent writing, and a name on a note changes what people
    // write. Anonymity is per note rather than per session, because one thing is
    // usually harder to say than the rest.
    await addNote(
      "didnt",
      "Leadership changed the target in week six.",
      MEMBER,
      true,
    );
    await addNote("worked", "Blockers got cleared fast.", MEMBER, false);

    const board = await retro();
    const anonymous = board.columns
      .flatMap((entry) => entry.notes)
      .find((note) => note.text.startsWith("Leadership"));
    const signed = board.columns
      .flatMap((entry) => entry.notes)
      .find((note) => note.text.startsWith("Blockers"));
    expect(anonymous?.authorName).toBeNull();
    expect(signed?.authorName).toBe("Member");
  });

  it("refuses an empty note", async () => {
    await expect(addNote("worked", "   ")).rejects.toThrow();
  });

  it("lets an author remove their own note, and refuses somebody else's", async () => {
    const note = await addNote("worked", "Mine to take back.", MEMBER);

    await expect(
      call("sessions.removeRetroNote", { sessionId, noteId: note.id }, MANAGER),
    ).rejects.toThrow();

    await call(
      "sessions.removeRetroNote",
      { sessionId, noteId: note.id },
      MEMBER,
    );
    expect(
      (await retro()).columns.flatMap((entry) => entry.notes),
    ).toHaveLength(0);
  });

  it("lets the facilitator remove a note the room cannot", async () => {
    // An anonymous note has no author to take it back, so somebody has to be
    // able to clear a mistake. The facilitator is running the room.
    const note = await addNote(
      "didnt",
      "Posted to the wrong review.",
      MEMBER,
      true,
    );
    await call("sessions.removeRetroNote", { sessionId, noteId: note.id });
    expect(
      (await retro()).columns.flatMap((entry) => entry.notes),
    ).toHaveLength(0);
  });
});

describe("dot voting", () => {
  it("is capped per member at the §11 parameter, and the cap is not a literal", async () => {
    // Read from the registry, not written down here. A literal 3 in a test is
    // a second copy of a §11 parameter, and the one thing that must not drift.
    const cap = resolveThresholds()["sessions.retroDotsPerMember"];
    expect(cap).toBe(3);

    const notes = [];
    for (let index = 0; index < cap + 1; index += 1) {
      notes.push(await addNote("worked", `Something that worked ${index}.`));
    }

    for (let index = 0; index < cap; index += 1) {
      await call("sessions.castRetroVote", {
        sessionId,
        noteId: notes[index]?.id,
      });
    }
    expect((await retro()).dotsLeft).toBe(0);

    // The cap counts across notes, which no unique index can see, so the action
    // is what holds it.
    await expect(
      call("sessions.castRetroVote", { sessionId, noteId: notes[cap]?.id }),
    ).rejects.toThrow(/dot/i);
  });

  it("cannot be spent twice on one note by one member", async () => {
    const note = await addNote("worked", "The one thing everybody agrees on.");

    await call("sessions.castRetroVote", { sessionId, noteId: note.id });
    // The second cast withdraws it rather than stacking. Spending two on one
    // note is how three dots become one loud opinion, and §8.1's vote is about
    // spread.
    await call("sessions.castRetroVote", { sessionId, noteId: note.id });

    const board = await retro();
    expect(board.columns[0]?.notes[0]?.votes).toBe(0);
    expect(board.columns[0]?.notes[0]?.mine).toBe(false);
    expect(board.dotsSpent).toBe(0);
  });

  it("identifies the top-voted note, which is the acceptance criterion", async () => {
    const first = await addNote("worked", "Check-ins happened every week.");
    const second = await addNote("worked", "Blockers were named early.");
    const third = await addNote("didnt", "The dependency surfaced too late.");

    // Three members, three notes, and the second note is the one the room lands
    // on.
    for (const voter of [FACILITATOR, MANAGER, MEMBER]) {
      await call(
        "sessions.castRetroVote",
        { sessionId, noteId: second.id },
        voter,
      );
    }
    await call("sessions.castRetroVote", { sessionId, noteId: first.id });
    await call(
      "sessions.castRetroVote",
      { sessionId, noteId: third.id },
      MEMBER,
    );

    const board = await retro();
    const all = board.columns.flatMap((entry) => entry.notes);
    const top = all.reduce((best, note) =>
      note.votes > best.votes ? note : best,
    );
    expect(top.id).toBe(second.id);
    expect(top.votes).toBe(3);

    // Each member is still capped: the facilitator spent two of three.
    expect(board.dotsSpent).toBe(2);
    expect(board.dotsLeft).toBe(1);
  });

  it("keeps the stored count equal to the rows behind it", async () => {
    const note = await addNote("worked", "Counted twice would be a bug.");
    await call("sessions.castRetroVote", { sessionId, noteId: note.id });
    await call(
      "sessions.castRetroVote",
      { sessionId, noteId: note.id },
      MEMBER,
    );
    await call(
      "sessions.castRetroVote",
      { sessionId, noteId: note.id },
      MEMBER,
    );

    // The denormalised column is written in the same transaction as every vote.
    // A count that drifts from its rows is the reason a cached total is usually
    // the wrong idea, so it is asserted rather than assumed.
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ votes: number; actual: string }>(
      `select n.votes,
              (select count(*) from retro_votes v
                where v.note_id = n.id and v.deleted_at is null) as actual
         from retro_notes n where n.id = $1`,
      [note.id],
    );
    expect(String(rows[0]?.votes)).toBe(rows[0]?.actual);
    expect(rows[0]?.votes).toBe(1);
  });

  it("frees a dot when the note it was spent on is removed", async () => {
    const note = await addNote("worked", "Voted for, then withdrawn.", MEMBER);
    await call("sessions.castRetroVote", { sessionId, noteId: note.id });
    expect((await retro()).dotsLeft).toBe(2);

    await call("sessions.removeRetroNote", { sessionId, noteId: note.id });
    // A dot spent on something that no longer exists is a dot the member cannot
    // get back, which would silently shrink the cap for the rest of the stage.
    expect((await retro()).dotsLeft).toBe(3);
  });
});

describe("the management retro", () => {
  it("carries §8.7's four questions from the method package", async () => {
    const status = await management(MANAGER);
    expect(status.questions).toHaveLength(4);
    expect(status.questions[0]?.question).toContain("right priorities");
    expect(status.questions.map((entry) => entry.questionKey)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(status.answered).toBe(0);
    expect(status.complete).toBe(false);
  });

  it("records an answer and reports who gave it", async () => {
    await call(
      "sessions.setManagementAnswer",
      {
        sessionId,
        questionKey: 4,
        body: "Between the platform space and support. Nobody owned the handover.",
      },
      MANAGER,
    );

    const status = await management(MANAGER);
    const fourth = status.questions.find((entry) => entry.questionKey === 4);
    expect(fourth?.body).toContain("Nobody owned the handover");
    expect(fourth?.answeredByName).toBe("Manager");
    expect(status.answered).toBe(1);
  });

  it("rewrites rather than storing two answers to one question", async () => {
    for (const body of ["First pass.", "Second, after the argument."]) {
      await call(
        "sessions.setManagementAnswer",
        { sessionId, questionKey: 1, body },
        MANAGER,
      );
    }

    const status = await management(MANAGER);
    expect(status.questions[0]?.body).toBe("Second, after the argument.");
    expect(status.answered).toBe(1);
  });

  it("refuses a question outside the four", async () => {
    await expect(
      call(
        "sessions.setManagementAnswer",
        { sessionId, questionKey: 5, body: "There is no fifth question." },
        MANAGER,
      ),
    ).rejects.toThrow();
  });

  it("is complete only when all four are answered", async () => {
    for (const questionKey of [1, 2, 3]) {
      await call(
        "sessions.setManagementAnswer",
        { sessionId, questionKey, body: `Answer ${questionKey}.` },
        MANAGER,
      );
    }
    expect((await management(MANAGER)).complete).toBe(false);

    await call(
      "sessions.setManagementAnswer",
      { sessionId, questionKey: 4, body: "Answer 4." },
      MANAGER,
    );
    expect((await management(MANAGER)).complete).toBe(true);
  });
});

describe("the two retros are visible to different audiences", () => {
  it("shows the team retro to everybody in the room", async () => {
    await addNote("worked", "Everybody can see this.");
    for (const viewer of [FACILITATOR, MANAGER, MEMBER]) {
      expect(
        (await retro(viewer)).columns.flatMap((entry) => entry.notes),
      ).toHaveLength(1);
    }
  });

  it("hides the management retro from an ordinary member", async () => {
    // Agung's decision of 26 August 2026. §8.7 has leadership answering out
    // loud, and the leadership roles this product has are a space's managers and
    // its coordinator. The write-access floor is `edit` for every active member
    // (P3-T16), so `edit` alone would show it to the whole room.
    await expect(management(MEMBER)).rejects.toThrow();
    await expect(
      call(
        "sessions.setManagementAnswer",
        { sessionId, questionKey: 1, body: "Not mine to answer." },
        MEMBER,
      ),
    ).rejects.toThrow();
  });

  it("shows it to a manager and to the space coordinator", async () => {
    // The facilitator here is the workspace's founding member and the space's
    // coordinator, which is why they read it. Being the facilitator is not what
    // grants it: the role is.
    expect((await management(MANAGER)).questions).toHaveLength(4);
    expect((await management(FACILITATOR)).questions).toHaveLength(4);
  });
});
