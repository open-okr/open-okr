import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { boardReaders } from "../src/tasks/scope.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * A board per space, per initiative and per key result, and who may see each
 * (REQUIREMENTS §4 Pillar C, TECHNICAL-PLAN §4.9, completeness review M-02).
 *
 * `tasks.test.ts` proves the three filters reach one card. What is proved here
 * is what M-02 found missing around them:
 *
 * - a scope the reader cannot see is not-found, not an empty board, because
 *   the board's live stream took a successful read as its access check;
 * - a key result's board is its linked work under M-26's rule, so it draws
 *   the same cards the rail's linked-work chip counts;
 * - the heading names what the board is of;
 * - presence names only the members who can read the board.
 */

const OWNER = "scope-owner";
const OTHER = "scope-other";

let workspaceId: string;
let ownerMemberId: string;
let otherMemberId: string;
let spaceId: string;
let otherSpaceId: string;
let goalId: string;
let keyResultId: string;

const as = async (userId: string) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId },
  };
};

const call = async (name: string, input: unknown, userId = OWNER) =>
  callAction(await as(userId), name as never, input as never);

interface Board {
  scope: {
    kind: string;
    id: string;
    title: string;
    parentTitle: string | null;
    spaceId: string | null;
    goalId: string | null;
  };
  columns: { status: string; cards: { id: string }[] }[];
  rail: { keyResultId: string; linkedWork: { done: number; total: number } }[];
}

const board = async (input: Record<string, string>, userId = OWNER) =>
  (await call("tasks.board", input, userId)) as Board;

const cardIds = (read: Board) =>
  read.columns.flatMap((column) => column.cards.map((card) => card.id)).sort();

const createTask = async (title: string, extra: Record<string, unknown> = {}) =>
  (
    (await call("tasks.create", { spaceId, title, ...extra })) as {
      id: string;
    }
  ).id;

const createInitiative = async (title: string) =>
  (
    (await call("initiatives.create", {
      spaceId,
      title,
      ownerId: ownerMemberId,
    })) as { id: string }
  ).id;

/** A guest of one space, through the invitation a guest actually receives. */
async function guestOf(userId: string, space: string): Promise<string> {
  const wb = await workerDb();
  const email = `${userId}@partner.example`;
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [userId, `Guest ${userId}`, email],
  );
  const link = (await call("invitations.createPersonalLink", {
    email,
    guestSpaceId: space,
  })) as { token: string };
  const accepted = (await call(
    "invitations.acceptLink",
    { token: link.token },
    userId,
  )) as { memberId: string };
  return accepted.memberId;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Ada', $2), ($3, 'Bo', $4)`,
    [OWNER, "scope-owner@example.com", OTHER, "scope-other@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  spaceId = (
    (await call("spaces.create", { name: "Growth" })) as { id: string }
  ).id;
  otherSpaceId = (
    (await call("spaces.create", { name: "Finance" })) as { id: string }
  ).id;

  const cycle = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  goalId = (
    (await call("goals.create", {
      title: "Make activation the reason teams stay",
      cycleId: cycle.id,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string }
  ).id;
  keyResultId = (
    (await call("goals.addKeyResult", {
      goalId,
      title: "Weekly activation reaches sixty per cent",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 41,
      targetValue: 60,
      weight: 1,
    })) as { id: string }
  ).id;

  const member = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Bo', 'active') returning id`,
    [workspaceId, OTHER],
  );
  otherMemberId = member.rows[0]?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("what a board is of", () => {
  it("names the space a space's board is of", async () => {
    const read = await board({ spaceId });
    expect(read.scope).toEqual({
      kind: "space",
      id: spaceId,
      title: "Growth",
      parentTitle: null,
      spaceId,
      goalId: null,
    });
  });

  it("holds an initiative's own cards and names the initiative and its space", async () => {
    const initiativeId = await createInitiative("Rebuild the activation flow");
    const inside = await createTask("Rewrite the first-run screen", {
      initiativeId,
    });
    await createTask("Tidy the backlog");

    const read = await board({ initiativeId });
    expect(cardIds(read)).toEqual([inside]);
    expect(read.scope).toMatchObject({
      kind: "initiative",
      title: "Rebuild the activation flow",
      parentTitle: "Growth",
      spaceId,
    });
  });

  it("holds a key result's linked work: its own cards and its initiatives' cards", async () => {
    const serving = await createInitiative("Rebuild the activation flow");
    await call("initiatives.linkKeyResult", { id: serving, keyResultId });
    const throughInitiative = await createTask("Rewrite the first-run screen", {
      initiativeId: serving,
    });
    const named = await createTask("Email the dormant teams", { keyResultId });
    // Work that serves nothing on this board, and work in an initiative the
    // team decided not to do.
    await createTask("Tidy the backlog");
    const dropped = await createInitiative("A plan nobody is doing");
    await call("initiatives.linkKeyResult", { id: dropped, keyResultId });
    await createTask("Open work in a dropped plan", { initiativeId: dropped });
    await call("initiatives.update", { id: dropped, status: "dropped" });

    const read = await board({ keyResultId });
    expect(cardIds(read)).toEqual([throughInitiative, named].sort());
    expect(read.scope).toMatchObject({
      kind: "key_result",
      title: "Weekly activation reaches sixty per cent",
      parentTitle: "Make activation the reason teams stay",
      spaceId,
      goalId,
    });

    // The same set the rail counts, so the chip and the columns agree.
    const entry = read.rail.find((one) => one.keyResultId === keyResultId);
    expect(entry?.linkedWork.total).toBe(cardIds(read).length);
  });

  it("puts the most specific scope in the heading when several are named", async () => {
    await createTask("Email the dormant teams", { keyResultId });
    const read = await board({ spaceId, keyResultId });
    expect(read.scope.kind).toBe("key_result");
    expect(cardIds(read)).toHaveLength(1);
  });
});

describe("who may open one", () => {
  it("lets a guest open their own space's board and no other", async () => {
    await guestOf("scope-guest", spaceId);

    const own = await board({ spaceId }, "scope-guest");
    expect(own.scope.title).toBe("Growth");

    await expect(
      board({ spaceId: otherSpaceId }, "scope-guest"),
    ).rejects.toThrow(/No such space/);
  });

  it("refuses a guest an initiative's board and a key result's", async () => {
    await guestOf("scope-guest", spaceId);
    const initiativeId = await createInitiative("Rebuild the activation flow");

    await expect(board({ initiativeId }, "scope-guest")).rejects.toThrow(
      /No such initiative/,
    );
    await expect(board({ keyResultId }, "scope-guest")).rejects.toThrow(
      /No such key result/,
    );
  });

  it("answers a key result nobody can see exactly as one that does not exist", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `update access_bindings b set deleted_at = now()
         from access_contexts c, access_groups g
        where b.context_id = c.id
          and b.group_id = g.id
          and c.workspace_id = $1
          and c.resource_type = 'goal'
          and c.resource_id = $2
          and g.kind = 'workspace_standard'`,
      [workspaceId, goalId],
    );

    const hidden = board({ keyResultId }, OTHER).catch(
      (error: Error) => error.message,
    );
    const missing = board(
      { keyResultId: "00000000-0000-4000-8000-000000000000" },
      OTHER,
    ).catch((error: Error) => error.message);
    expect(await hidden).toBe(await missing);
    expect(await hidden).toMatch(/No such key result/);

    // The owner still sees it through their own binding.
    expect((await board({ keyResultId })).scope.kind).toBe("key_result");
  });

  it("checks every scope named, not only the one in the heading", async () => {
    await guestOf("scope-guest", spaceId);
    // The guest may see the space. Naming a key result beside it must not
    // tell them which of the space's cards serve a measure they cannot see.
    await expect(
      board({ spaceId, keyResultId }, "scope-guest"),
    ).rejects.toThrow(/No such key result/);
  });
});

describe("whose names presence may show", () => {
  const readers = async (
    scope: { kind: "space" | "initiative" | "key_result"; id: string },
    memberIds: string[],
    userId = OWNER,
  ) => {
    const wb = await workerDb();
    return boardReaders(wb.appPool, { workspaceId, userId, scope, memberIds });
  };

  it("names everybody who can read the board, in the order asked", async () => {
    const guest = await guestOf("scope-guest", spaceId);
    const shown = await readers({ kind: "space", id: spaceId }, [
      guest,
      otherMemberId,
      ownerMemberId,
    ]);
    expect(shown).toEqual([
      { id: guest, name: "Guest scope-guest" },
      { id: otherMemberId, name: "Bo" },
      { id: ownerMemberId, name: "Ada" },
    ]);
  });

  it("leaves out a guest who cannot read this board", async () => {
    const guest = await guestOf("scope-guest", otherSpaceId);
    const onSpace = await readers({ kind: "space", id: spaceId }, [
      guest,
      otherMemberId,
    ]);
    expect(onSpace.map((one) => one.id)).toEqual([otherMemberId]);

    const onKeyResult = await readers({ kind: "key_result", id: keyResultId }, [
      guest,
      otherMemberId,
    ]);
    expect(onKeyResult.map((one) => one.id)).toEqual([otherMemberId]);
  });

  it("leaves out a suspended member at once, whatever their tab still says", async () => {
    await call("people.suspend", { memberId: otherMemberId });
    const shown = await readers({ kind: "space", id: spaceId }, [
      otherMemberId,
      ownerMemberId,
    ]);
    expect(shown.map((one) => one.id)).toEqual([ownerMemberId]);
  });

  it("leaves out an identifier that is nobody in this workspace", async () => {
    const shown = await readers({ kind: "space", id: spaceId }, [
      "00000000-0000-4000-8000-000000000000",
    ]);
    expect(shown).toEqual([]);
  });

  it("answers a guest viewer with the same rule", async () => {
    const guest = await guestOf("scope-guest", spaceId);
    const outsider = await guestOf("scope-outsider", otherSpaceId);
    const shown = await readers(
      { kind: "space", id: spaceId },
      [ownerMemberId, outsider],
      "scope-guest",
    );
    // The guest shares this board with its owner, and is never told about a
    // guest of a space they cannot see.
    expect(shown.map((one) => one.id)).toEqual([ownerMemberId]);
    expect(guest).not.toBe(outsider);
  });
});
