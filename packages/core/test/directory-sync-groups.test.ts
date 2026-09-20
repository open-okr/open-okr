import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import {
  directoryGroupById,
  listDirectoryGroups,
  syncDirectoryGroup,
  unmapDirectoryGroup,
} from "../src/directory-sync/groups.ts";
import { provisionDirectoryUser } from "../src/directory-sync/users.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Directory groups mapped to spaces (P8-T08b).
 *
 * The half of the P8-T08 deliverable that had no code: "directory
 * synchronisation of users and groups mapped to members and space
 * membership".
 *
 * What matters here is that membership goes through the space actions rather
 * than into the table, because those actions grant and take back the access
 * that comes with a space. A member listed in a space they cannot open is the
 * failure this shape prevents.
 */

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";

type Auth = ReturnType<typeof createAuth>;

let auth: Auth;
let workspaceId: string;
let ada = "";
let grace = "";

beforeAll(async () => {
  const wb = await workerDb();

  await wb.admin.query(
    `insert into users (id, name, email, email_verified, created_at, updated_at)
     values ('groups-owner', 'Owner', 'owner@groups.test', true, now(), now())
     on conflict (id) do nothing`,
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: "groups-owner",
      name: "Groups Workspace",
    })
  ).workspaceId;

  auth = createAuth({
    pool: wb.appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    rateLimit: { enabled: false },
  });

  const deps = { pool: wb.appPool, auth };
  ada = (
    await provisionDirectoryUser(deps, {
      workspaceId,
      email: "ada@groups.test",
      name: "Ada",
    })
  ).member.memberId;
  grace = (
    await provisionDirectoryUser(deps, {
      workspaceId,
      email: "grace@groups.test",
      name: "Grace",
    })
  ).member.memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a group the directory sent", () => {
  it("becomes a space with that membership", async () => {
    const wb = await workerDb();

    const group = await syncDirectoryGroup(wb.appPool, {
      workspaceId,
      externalId: "okta-group-1",
      displayName: "Engineering",
      memberIds: [ada],
    });

    expect(group.displayName).toBe("Engineering");
    expect(group.memberIds).toEqual([ada]);

    const spaces = await wb.admin.query(
      "select id, name from spaces where workspace_id = $1 and name = 'Engineering'",
      [workspaceId],
    );
    expect(spaces.rows).toHaveLength(1);
    expect(spaces.rows[0]?.id).toBe(group.spaceId);
  });

  it("grants the access the space role carries, not just a row", async () => {
    const wb = await workerDb();
    const group = (await listDirectoryGroups(wb.appPool, workspaceId))[0];

    // `spaces.addMember` binds the member to the space's access context. A
    // direct insert would leave them listed and unable to open it.
    const { rows } = await wb.admin.query(
      `select count(*)::int as bindings
         from access_bindings b
         join access_contexts c on c.id = b.context_id
        where c.workspace_id = $1
          and c.resource_type = 'space'
          and c.resource_id = $2`,
      [workspaceId, group?.spaceId],
    );
    expect(rows[0]?.bindings).toBeGreaterThan(0);
  });

  it("is safe to replay, which is what a directory does", async () => {
    const wb = await workerDb();

    const again = await syncDirectoryGroup(wb.appPool, {
      workspaceId,
      externalId: "okta-group-1",
      displayName: "Engineering",
      memberIds: [ada],
    });

    expect(again.memberIds).toEqual([ada]);
    const spaces = await wb.admin.query(
      "select id from spaces where workspace_id = $1 and name = 'Engineering'",
      [workspaceId],
    );
    expect(spaces.rows).toHaveLength(1);
  });

  it("follows a rename rather than making a second space", async () => {
    const wb = await workerDb();

    const renamed = await syncDirectoryGroup(wb.appPool, {
      workspaceId,
      externalId: "okta-group-1",
      displayName: "Platform",
    });

    expect(renamed.displayName).toBe("Platform");
    const spaces = await wb.admin.query(
      "select name from spaces where id = $1",
      [renamed.spaceId],
    );
    expect(spaces.rows[0]?.name).toBe("Platform");

    const all = await listDirectoryGroups(wb.appPool, workspaceId);
    expect(all).toHaveLength(1);
  });

  it("adds and removes only what changed", async () => {
    const wb = await workerDb();

    const both = await syncDirectoryGroup(wb.appPool, {
      workspaceId,
      externalId: "okta-group-1",
      displayName: "Platform",
      memberIds: [ada, grace],
    });
    expect([...both.memberIds].sort()).toEqual([ada, grace].sort());

    const onlyGrace = await syncDirectoryGroup(wb.appPool, {
      workspaceId,
      externalId: "okta-group-1",
      displayName: "Platform",
      memberIds: [grace],
    });
    expect(onlyGrace.memberIds).toEqual([grace]);
  });

  it("leaves the workspace membership alone when somebody leaves a group", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      `select status from workspace_members where id = $1`,
      [ada],
    );
    // Out of the space, still in the workspace. Losing a team is not leaving
    // the company.
    expect(rows[0]?.status).toBe("active");
  });

  it("omitting members says nothing about them, and empty empties", async () => {
    const wb = await workerDb();

    const silent = await syncDirectoryGroup(wb.appPool, {
      workspaceId,
      externalId: "okta-group-1",
      displayName: "Platform",
    });
    expect(silent.memberIds).toEqual([grace]);

    const emptied = await syncDirectoryGroup(wb.appPool, {
      workspaceId,
      externalId: "okta-group-1",
      displayName: "Platform",
      memberIds: [],
    });
    expect(emptied.memberIds).toEqual([]);
  });
});

describe("a group the directory deleted", () => {
  it("empties its space and leaves the space standing", async () => {
    const wb = await workerDb();

    const group = await syncDirectoryGroup(wb.appPool, {
      workspaceId,
      externalId: "okta-group-2",
      displayName: "Design",
      memberIds: [ada, grace],
    });

    expect(
      await unmapDirectoryGroup(wb.appPool, workspaceId, group.groupId),
    ).toBe(true);

    expect(
      await directoryGroupById(wb.appPool, workspaceId, group.groupId),
    ).toBeNull();

    const space = await wb.admin.query(
      "select deleted_at from spaces where id = $1",
      [group.spaceId],
    );
    expect(space.rows[0]?.deleted_at).toBeNull();

    const members = await wb.admin.query(
      "select member_id from space_members where space_id = $1 and deleted_at is null",
      [group.spaceId],
    );
    expect(members.rows).toHaveLength(0);
  });

  it("answers false for a group nobody mapped", async () => {
    const wb = await workerDb();
    expect(
      await unmapDirectoryGroup(
        wb.appPool,
        workspaceId,
        "00000000-0000-4000-8000-000000000000",
      ),
    ).toBe(false);
  });
});
