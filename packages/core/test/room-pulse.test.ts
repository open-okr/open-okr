/**
 * The room pulse (METHOD.md §8.2, p4-t00-session-design.md §4.2, P4-T10a-b).
 *
 * The task's test plan:
 * - the read comes from `sessions.roomPulseBands` and not from a literal
 * - a participant sees their own pulse and never the room's read
 *
 * The acceptance criterion: given every participant has given a pulse, when the
 * facilitator opens the read, then the average and §8.2's sentence for its band
 * are shown.
 *
 * **The read is the facilitator's, and that is a practice decision rather than
 * a permission one.** §8.2 shows the average "to the facilitator with
 * interpretation". A room that can see its own average before scoring has been
 * handed an anchor, which is the exact failure §8.3's hidden objective score
 * exists to prevent. So the action refuses it to anybody else, and a test drives
 * that.
 */
import { roomPulseRead } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "pulse-facilitator";
const MEMBER = "pulse-member";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let facilitatorMemberId: string;
let memberMemberId: string;
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

const roomRead = async (userId = FACILITATOR) =>
  (await call("sessions.roomPulse", { sessionId }, userId)) as {
    average: number | null;
    band: string | null;
    read: string | null;
    given: number;
    expected: number;
    mine: { pulse: number | null; word: string | null };
  };

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)`,
    [
      FACILITATOR,
      "Facilitator",
      "pulse-facilitator@example.com",
      MEMBER,
      "Member",
      "pulse-member@example.com",
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

describe("sessions.givePulse", () => {
  it("records a pulse and one word", async () => {
    await call("sessions.givePulse", {
      sessionId,
      pulse: 4,
      word: "relieved",
    });

    const read = await roomRead();
    expect(read.given).toBe(1);
    expect(read.mine.pulse).toBe(4);
    expect(read.mine.word).toBe("relieved");
  });

  it("corrects rather than adding a second voice", async () => {
    await call("sessions.givePulse", { sessionId, pulse: 2, word: "tired" });
    await call("sessions.givePulse", { sessionId, pulse: 4, word: "steadier" });

    const read = await roomRead();
    // One person, one voice. Two rows would weight whoever changed their mind.
    expect(read.given).toBe(1);
    expect(read.average).toBe(4);
  });

  it("refuses a pulse outside one to five", async () => {
    await expect(
      call("sessions.givePulse", { sessionId, pulse: 6, word: "wrong" }),
    ).rejects.toThrow();
    await expect(
      call("sessions.givePulse", { sessionId, pulse: 0, word: "wrong" }),
    ).rejects.toThrow();
  });

  it("refuses more than one word", async () => {
    // §8.2 asks for one word. A sentence here turns the read of the room into
    // a paragraph nobody scans.
    await expect(
      call("sessions.givePulse", {
        sessionId,
        pulse: 4,
        word: "cautiously optimistic",
      }),
    ).rejects.toThrow(/one word/i);
  });

  it("is refused on a session that holds no pulse", async () => {
    const weekly = (await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      facilitatorId: facilitatorMemberId,
    })) as { id: string };

    await expect(
      call("sessions.givePulse", {
        sessionId: weekly.id,
        pulse: 4,
        word: "fine",
      }),
    ).rejects.toThrow(/quarterly/i);
  });
});

describe("the acceptance criterion", () => {
  it("shows the average and §8.2's sentence for its band", async () => {
    await call("sessions.givePulse", { sessionId, pulse: 4, word: "ready" });
    await call(
      "sessions.givePulse",
      { sessionId, pulse: 5, word: "proud" },
      MEMBER,
    );

    const read = await roomRead();
    expect(read.given).toBe(2);
    expect(read.expected).toBe(2);
    expect(read.average).toBe(4.5);
    expect(read.band).toBe("energetic");
    // The sentence, not a label. And the same sentence the pure function gives,
    // so there is one source for it.
    expect(read.read).toBe(
      roomPulseRead([4, 5], {
        "sessions.roomPulseBands": { high: 4, low: 3 },
      } as never)?.read,
    );
    expect(read.read).toContain("The room has energy");
  });

  it("reads a costly cycle when the room says so", async () => {
    await call("sessions.givePulse", { sessionId, pulse: 2, word: "drained" });
    await call(
      "sessions.givePulse",
      { sessionId, pulse: 1, word: "exhausted" },
      MEMBER,
    );

    const read = await roomRead();
    expect(read.band).toBe("costly");
    expect(read.read).toContain("The cycle cost something");
  });
});

describe("the read comes from the registry", () => {
  it("changes band when the workspace moves the boundary", async () => {
    await call("sessions.givePulse", { sessionId, pulse: 4, word: "ready" });
    expect((await roomRead()).band).toBe("energetic");

    // §11's own parameter, not a literal in the action. A workspace that
    // decided four is not energetic is read by its own number.
    //
    // The field is `overrides`. Written as `thresholds` first, which Zod
    // stripped without complaint, so the update did nothing and this test
    // passed the band it started with. Worth the comment: an input schema that
    // silently drops a misspelled key makes a test look like it exercised a
    // path it never touched.
    await call("rhythm.update", {
      overrides: { "sessions.roomPulseBands": { high: 4.5, low: 3.5 } },
    });

    const stricter = await roomRead();
    expect(stricter.band).toBe("steady");
    expect(stricter.read).toContain("Steady, not euphoric");
  });
});

/**
 * The words come back counted, not listed in row order.
 *
 * A privacy decision as much as a display one: a list in row order can be lined
 * up against the member list, and §8.2 asks for the room's mood rather than who
 * felt what.
 */
describe("the words the room gave", () => {
  it("count repeats, fold case and sort by frequency", async () => {
    await call("sessions.givePulse", { sessionId, pulse: 2, word: "Tired" });
    await call(
      "sessions.givePulse",
      { sessionId, pulse: 2, word: "tired" },
      MEMBER,
    );

    const read = (await call("sessions.roomPulse", { sessionId })) as {
      words: { word: string; count: number }[];
    };
    // Case-folded, because "Tired" and "tired" are one mood.
    //
    // Two people, not three calls: a third `givePulse` as the facilitator
    // replaced their own word rather than adding one, which is the
    // one-person-one-voice rule doing its job and my first version of this
    // assertion getting it wrong.
    expect(read.words).toEqual([{ word: "tired", count: 2 }]);
  });

  it("are withheld from a participant along with the read", async () => {
    await call("sessions.givePulse", { sessionId, pulse: 4, word: "ready" });
    const theirs = (await call(
      "sessions.roomPulse",
      { sessionId },
      MEMBER,
    )) as { words: unknown[] };
    expect(theirs.words).toEqual([]);
  });
});

describe("access", () => {
  it("gives the room's read to the facilitator and not to a participant", async () => {
    await call("sessions.givePulse", { sessionId, pulse: 4, word: "ready" });
    await call(
      "sessions.givePulse",
      { sessionId, pulse: 2, word: "tired" },
      MEMBER,
    );

    const theirs = await roomRead(MEMBER);
    // Their own pulse, always. §8.2 shows the average to the facilitator, and a
    // room that sees its own average before scoring has been handed an anchor.
    expect(theirs.mine.pulse).toBe(2);
    expect(theirs.mine.word).toBe("tired");
    expect(theirs.average).toBeNull();
    expect(theirs.band).toBeNull();
    expect(theirs.read).toBeNull();
    // How many have spoken is not the read: a facilitator says "two of four,
    // wait for the rest" out loud anyway.
    expect(theirs.given).toBe(2);
  });

  it("gives the facilitator nothing to read before anybody speaks", async () => {
    const read = await roomRead();
    // An empty room is not a costly one. A sentence about the cycle costing
    // something before anybody has spoken would be the product inventing a
    // mood.
    expect(read.given).toBe(0);
    expect(read.average).toBeNull();
    expect(read.read).toBeNull();
  });

  it("refuses everything to a suspended member", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberMemberId],
    );

    await expect(
      call("sessions.givePulse", { sessionId, pulse: 4, word: "no" }, MEMBER),
    ).rejects.toThrow();
    await expect(roomRead(MEMBER)).rejects.toThrow();
  });
});
