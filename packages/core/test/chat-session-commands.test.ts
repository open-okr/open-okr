import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { routeCommand } from "../src/channels/router.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The session-bound chat commands (design §7, P5-T06c).
 *
 * The acceptance criterion is the last test: a blocker raised from chat appears
 * on the session's own board with the channel on its audit row.
 *
 * The piece the design left open is the lookup, and most of these tests are
 * about it: a sender names a key result or nothing, and the product has to find
 * a *running* session in a space they are in, refuse when there is none, and
 * refuse rather than guess when there are two.
 */

const MEMBER = "session-cmd-member";
const NOW = new Date("2026-08-27T09:00:00.000Z");

let workspaceId: string;
let memberId: string;
let spaceId: string;
let goalId: string;
let keyResultId: string;

const asMember = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: MEMBER },
});

const say = async (text: string) => {
  const wb = await workerDb();
  return routeCommand({
    pool: wb.appPool,
    workspaceId,
    provider: "telegram",
    memberId,
    userId: MEMBER,
    text,
    now: NOW,
  });
};

const openSession = async (space: string) => {
  const wb = await workerDb();
  const created = await callAction(
    { pool: wb.appPool, ...asMember() },
    "sessions.create",
    {
      spaceId: space,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: NOW.toISOString(),
      facilitatorId: memberId,
    },
  );
  await callAction({ pool: wb.appPool, ...asMember() }, "sessions.open", {
    id: created.id,
  });
  return created.id;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [MEMBER, "Member", "session-cmd@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: MEMBER,
    name: "Member",
  });
  workspaceId = provisioned.workspaceId;

  const member = await wb.admin.query(
    "select id from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, MEMBER],
  );
  memberId = member.rows[0].id as string;

  const space = await callAction(
    { pool: wb.appPool, ...asMember() },
    "spaces.create",
    { name: "Platform" },
  );
  spaceId = space.id;

  const cycle = await callAction(
    { pool: wb.appPool, ...asMember() },
    "cycles.current",
    { mode: "quarterly" },
  );
  const goal = (await callAction(
    { pool: wb.appPool, ...asMember() },
    "goals.create",
    {
      cycleId: cycle?.id as string,
      level: "team",
      spaceId,
      ownerKind: "space",
      title: "Ship the platform migration",
      championId: memberId,
      reviewerId: memberId,
      weight: 1,
    },
  )) as { id: string };
  goalId = goal.id;

  const kr = (await callAction(
    { pool: wb.appPool, ...asMember() },
    "goals.addKeyResult",
    {
      goalId,
      title: "Move 40 services onto the new runtime",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 0,
      targetValue: 40,
      weight: 1,
    },
  )) as { id: string };
  keyResultId = kr.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("finding the session", () => {
  it("refuses when nothing is running, and says which reason it is", async () => {
    const reply = await say(
      `blocker ${keyResultId} dependency Chase the vendor`,
    );
    expect(reply.text).toMatch(/No session is running in that key result/);
  });

  it("refuses a scheduled session, because nobody is in the room for it", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...asMember() }, "sessions.create", {
      spaceId,
      kind: "weekly",
      title: "Later",
      scheduledFor: NOW.toISOString(),
      facilitatorId: memberId,
    });

    const reply = await say(`blocker ${keyResultId} clarity Ask the sponsor`);
    expect(reply.text).toMatch(/No session is running/);
  });

  it("refuses a key result in a space the sender is not in", async () => {
    const wb = await workerDb();
    await openSession(spaceId);
    // Out of the space, still in the workspace. The key result is discoverable
    // and its session is not the sender's to add to.
    await wb.admin.query(
      "update space_members set deleted_at = now() where workspace_id = $1 and member_id = $2",
      [workspaceId, memberId],
    );

    const reply = await say(`blocker ${keyResultId} external Waiting on legal`);
    expect(reply.text).toMatch(/not in a space you are in|not in a space/);
  });

  it("refuses rather than guessing when two sessions are running", async () => {
    const wb = await workerDb();
    await openSession(spaceId);
    const second = await callAction(
      { pool: wb.appPool, ...asMember() },
      "spaces.create",
      { name: "Growth" },
    );
    await openSession(second.id);

    // `commit` names nothing, so the lookup has two candidates. Choosing would
    // put somebody's commitment on the wrong team's board.
    const reply = await say("commit Finish the migration plan");
    expect(reply.text).toMatch(/More than one session is running/);
    expect(reply.text).toMatch(/Name a key result/);
  });

  it("finds the one running session when a key result names its space", async () => {
    await openSession(spaceId);
    const reply = await say(
      `blocker ${keyResultId} dependency Chase the vendor`,
    );
    expect(reply.kind).toBe("done");
  });
});

describe("the commands", () => {
  it("adds one commitment, owned by whoever sent it", async () => {
    const wb = await workerDb();
    const sessionId = await openSession(spaceId);

    const reply = await say("commit Finish the migration plan");
    expect(reply.kind).toBe("done");

    const rows = await wb.admin.query(
      "select text, owner_id, session_id from commitments where workspace_id = $1",
      [workspaceId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].text).toBe("Finish the migration plan");
    // A commitment somebody makes is theirs.
    expect(rows.rows[0].owner_id).toBe(memberId);
    expect(rows.rows[0].session_id).toBe(sessionId);
  });

  it("appends rather than replacing, so a second one does not wipe the first", async () => {
    const wb = await workerDb();
    await openSession(spaceId);
    await say("commit Finish the migration plan");
    await say("commit Book the vendor call");

    const rows = await wb.admin.query(
      "select count(*)::int as count from commitments where workspace_id = $1",
      [workspaceId],
    );
    expect(rows.rows[0].count).toBe(2);
  });

  it("refuses a blocker type that is not in the taxonomy", async () => {
    await openSession(spaceId);
    const reply = await say(`blocker ${keyResultId} annoying Chase somebody`);
    // The action's own schema refuses it, so the sentence is the one the
    // browser would show rather than one this router invented.
    expect(reply.kind).toBe("reply");
    expect(reply.text).not.toMatch(/^Done/);
  });

  it("takes the next action as the rest of the line, spaces and all", async () => {
    const wb = await workerDb();
    await openSession(spaceId);
    await say(
      `blocker ${keyResultId} resource Hire a second platform engineer this quarter`,
    );

    const rows = await wb.admin.query(
      "select next_action from blockers where workspace_id = $1",
      [workspaceId],
    );
    expect(rows.rows[0].next_action).toBe(
      "Hire a second platform engineer this quarter",
    );
  });

  it("says which arguments are missing rather than failing silently", async () => {
    await openSession(spaceId);
    const reply = await say(`blocker ${keyResultId}`);
    expect(reply.text).toMatch(/blocker needs/);
    expect(reply.text).toMatch(/resource|type/);
  });

  it("lists both commands in the help, from the catalogue", async () => {
    const reply = await say("help");
    expect(reply.text).toContain("blocker");
    expect(reply.text).toContain("commit");
  });
});

describe("the whole thing", () => {
  /**
   * The acceptance criterion, in the words the task states it.
   */
  it("puts the blocker on the session's own board, with the channel audited (acceptance)", async () => {
    const wb = await workerDb();
    const sessionId = await openSession(spaceId);

    const reply = await say(
      `blocker ${keyResultId} dependency Chase the vendor for a date`,
    );
    expect(reply.kind).toBe("done");

    // The same row the session screen writes: on this session, on this key
    // result, owned by the sender.
    const rows = await wb.admin.query(
      "select session_id, key_result_id, type, owner_id, next_action, resolved_at from blockers where workspace_id = $1",
      [workspaceId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].session_id).toBe(sessionId);
    expect(rows.rows[0].key_result_id).toBe(keyResultId);
    expect(rows.rows[0].type).toBe("dependency");
    expect(rows.rows[0].owner_id).toBe(memberId);
    expect(rows.rows[0].resolved_at).toBeNull();

    // And it reads back through the board the space page shows.
    const board = await callAction(
      { pool: wb.appPool, ...asMember() },
      "blockers.board",
      { spaceId },
    );
    expect(board.blockers).toHaveLength(1);
    expect(board.blockers[0]?.nextAction).toBe("Chase the vendor for a date");

    const audited = await wb.admin.query(
      "select payload from audit_events where workspace_id = $1 and action = 'sessions.createBlocker'",
      [workspaceId],
    );
    expect(audited.rows).toHaveLength(1);
    expect((audited.rows[0].payload as Record<string, unknown>).channel).toBe(
      "telegram",
    );
  });
});
