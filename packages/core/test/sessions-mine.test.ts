import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * `sessions.mine`, the read behind the session list (P5-T01c).
 *
 * The one that matters is the access boundary: this list crosses spaces, so a
 * bug here shows one team's ritual to another team. Nothing on the screen is
 * allowed to be what hides it.
 */

const OWNER = "mine-owner";
const OUTSIDER = "mine-outsider";

let workspaceId: string;
let ownerMemberId: string;
let outsiderMemberId: string;
let spaceId: string;

const asOwner = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

const asOutsider = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OUTSIDER },
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Owner",
      "mine-owner@example.com",
      OUTSIDER,
      "Outsider",
      "mine-outsider@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;

  const members = await wb.admin.query(
    "select id from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, OWNER],
  );
  ownerMemberId = members.rows[0].id as string;

  const outsider = await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Outsider', 'active') returning id`,
    [workspaceId, OUTSIDER],
  );
  outsiderMemberId = outsider.rows[0].id as string;

  const space = await callAction(
    { pool: wb.appPool, ...asOwner() },
    "spaces.create",
    { name: "Platform" },
  );
  spaceId = space.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const createSession = async (
  over: { title?: string; scheduledFor?: string } = {},
) => {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...asOwner() }, "sessions.create", {
    spaceId,
    kind: "weekly",
    title: over.title ?? "Weekly check-in",
    scheduledFor: over.scheduledFor ?? "2026-09-01T09:00:00.000Z",
    facilitatorId: ownerMemberId,
  });
};

describe("what a member can see", () => {
  it("lists a session in a space they belong to", async () => {
    const wb = await workerDb();
    const created = await createSession();

    const rows = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "sessions.mine",
      {},
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(created.id);
    expect(rows[0]?.spaceName).toBe("Platform");
    expect(rows[0]?.isFacilitator).toBe(true);
  });

  it("hides a session in a space they are not a member of", async () => {
    const wb = await workerDb();
    await createSession();

    // The outsider is a workspace member and can *see* that this space exists:
    // every space is readable at view so that somebody can find one to join.
    // A session is stricter, because it is a room you are in, and
    // `sessions.read` refuses a caller who is not in the space. The list has
    // to agree with that or it would offer rows that refuse to open. Nothing
    // on the screen filters this; the membership join in the read does.
    const rows = await callAction(
      { pool: wb.appPool, ...asOutsider() },
      "sessions.mine",
      {},
    );
    expect(rows).toEqual([]);
  });

  it("shows it once they join the space", async () => {
    const wb = await workerDb();
    await createSession();
    await callAction({ pool: wb.appPool, ...asOwner() }, "spaces.addMember", {
      spaceId,
      memberId: outsiderMemberId,
      role: "member",
    });

    const rows = await callAction(
      { pool: wb.appPool, ...asOutsider() },
      "sessions.mine",
      {},
    );
    expect(rows).toHaveLength(1);
    // They can see the room without being the one who runs it.
    expect(rows[0]?.isFacilitator).toBe(false);
  });
});

describe("what the list is ordered by", () => {
  it("puts a running session above one scheduled sooner", async () => {
    const wb = await workerDb();
    // The later one, opened, so it is running.
    const later = await createSession({
      title: "Later but live",
      scheduledFor: "2026-09-08T09:00:00.000Z",
    });
    await createSession({
      title: "Sooner but not started",
      scheduledFor: "2026-09-01T09:00:00.000Z",
    });
    await callAction({ pool: wb.appPool, ...asOwner() }, "sessions.open", {
      id: later.id,
    });

    const rows = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "sessions.mine",
      {},
    );
    // A session somebody is already waiting in comes first, whatever the
    // calendar says.
    expect(rows[0]?.title).toBe("Later but live");
    expect(rows[0]?.state).toBe("running");
    expect(rows[0]?.stageKey).not.toBeNull();
    expect(rows[1]?.title).toBe("Sooner but not started");
  });

  it("orders the rest by when somebody has to turn up", async () => {
    const wb = await workerDb();
    await createSession({
      title: "Second",
      scheduledFor: "2026-09-08T09:00:00.000Z",
    });
    await createSession({
      title: "First",
      scheduledFor: "2026-09-01T09:00:00.000Z",
    });

    const rows = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "sessions.mine",
      {},
    );
    expect(rows.map((row) => row.title)).toEqual(["First", "Second"]);
  });
});

describe("what is finished", () => {
  it("leaves closed sessions off by default, because the door is about what is next", async () => {
    const wb = await workerDb();
    const created = await createSession();
    await callAction({ pool: wb.appPool, ...asOwner() }, "sessions.skip", {
      id: created.id,
    });

    expect(
      await callAction({ pool: wb.appPool, ...asOwner() }, "sessions.mine", {}),
    ).toEqual([]);
  });

  it("includes them when asked", async () => {
    const wb = await workerDb();
    const created = await createSession();
    await callAction({ pool: wb.appPool, ...asOwner() }, "sessions.skip", {
      id: created.id,
    });

    const rows = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "sessions.mine",
      { includeFinished: true },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("skipped");
  });
});

describe("nothing to show", () => {
  it("returns an empty list rather than refusing, for a member with no sessions", async () => {
    const wb = await workerDb();
    expect(
      await callAction(
        { pool: wb.appPool, ...asOutsider() },
        "sessions.mine",
        {},
      ),
    ).toEqual([]);
  });
});
