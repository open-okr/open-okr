import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import {
  listDirectoryUsers,
  parseScimFilter,
  provisionDirectoryUser,
  setDirectoryUserActive,
} from "../src/directory-sync/users.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The SCIM Users resource (P8-T08a).
 *
 * P8-T08 wrote `workspace_members` and `users` with raw SQL from the route,
 * outside the Operation pipeline and around Better Auth, and had no path at
 * all for the acceptance criterion: a user removed from the directory is
 * suspended on the next synchronisation.
 *
 * The instance here is closed to registration from the moment the first
 * workspace exists, which is the state an enterprise instance is in. Every
 * provisioning below therefore also proves that a directory-sync token is an
 * authority the registration rule accepts.
 */

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";

type Auth = ReturnType<typeof createAuth>;

let auth: Auth;
let workspaceId: string;

const deps = async () => {
  const wb = await workerDb();
  return { pool: wb.appPool, auth };
};

beforeAll(async () => {
  const wb = await workerDb();

  await wb.admin.query(
    `insert into users (id, name, email, email_verified, created_at, updated_at)
     values ('scim-owner', 'Owner', 'owner@scim.test', true, now(), now()),
            ('scim-known', 'Known', 'known@scim.test', true, now(), now())
     on conflict (id) do nothing`,
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: "scim-owner",
      name: "SCIM Workspace",
    })
  ).workspaceId;

  auth = createAuth({
    pool: wb.appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    rateLimit: { enabled: false },
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the one filter an identity provider sends", () => {
  it("reads a userName equality", () => {
    expect(parseScimFilter('userName eq "someone@acme.com"')).toEqual({
      attribute: "userName",
      value: "someone@acme.com",
    });
    expect(parseScimFilter('USERNAME EQ "Someone@ACME.com"')).toEqual({
      attribute: "userName",
      value: "Someone@ACME.com",
    });
  });

  it("answers null when there is no filter", () => {
    expect(parseScimFilter(null)).toBeNull();
    expect(parseScimFilter("")).toBeNull();
    expect(parseScimFilter("   ")).toBeNull();
  });

  it("says so rather than guessing when it cannot read one", () => {
    expect(parseScimFilter('displayName co "Ada"')).toBe("unsupported");
    expect(parseScimFilter('userName ne "a@b.c"')).toBe("unsupported");
    expect(parseScimFilter("userName eq unquoted")).toBe("unsupported");
  });
});

describe("provisioning somebody the directory sent", () => {
  it("creates the account and the membership, on a closed instance", async () => {
    const wb = await workerDb();

    const { member, created } = await provisionDirectoryUser(await deps(), {
      workspaceId,
      email: "Ada@scim.test",
      name: "Ada Lovelace",
      externalId: "okta-0001",
    });

    expect(created).toBe(true);
    expect(member.email).toBe("ada@scim.test");
    expect(member.name).toBe("Ada Lovelace");
    expect(member.active).toBe(true);

    // One account, through Better Auth, with the address lower-cased the way
    // every other account created through it is.
    const accounts = await wb.admin.query(
      "select id, email_verified from users where email = 'ada@scim.test'",
    );
    expect(accounts.rows).toHaveLength(1);
    expect(accounts.rows[0]?.email_verified).toBe(true);

    // In the token's workspace, and in no other. A stray personal workspace
    // is what the provisioning hook would have given them on its own.
    const memberships = await wb.admin.query(
      `select workspace_id from workspace_members
        where user_id = $1 and deleted_at is null`,
      [accounts.rows[0]?.id],
    );
    expect(memberships.rows).toHaveLength(1);
    expect(memberships.rows[0]?.workspace_id).toBe(workspaceId);
  });

  it("writes an audit row rather than a silent insert", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      `select payload from audit_events
        where action = 'workspace.directoryJoin' and workspace_id = $1`,
      [workspaceId],
    );
    expect(rows).toHaveLength(1);
    const payload = rows[0]?.payload as
      | { via: string; externalId?: string }
      | undefined;
    expect(payload?.via).toBe("directory_sync");
    expect(payload?.externalId).toBe("okta-0001");
  });

  it("is safe to replay, which is what a directory does", async () => {
    const wb = await workerDb();

    const again = await provisionDirectoryUser(await deps(), {
      workspaceId,
      email: "ada@scim.test",
      name: "Ada Lovelace",
      externalId: "okta-0001",
    });

    expect(again.created).toBe(false);
    const { rows } = await wb.admin.query(
      "select id from users where email = 'ada@scim.test'",
    );
    expect(rows).toHaveLength(1);
  });

  it("reuses an account that already exists under that address", async () => {
    const { member, created } = await provisionDirectoryUser(await deps(), {
      workspaceId,
      email: "known@scim.test",
      name: "Known Person",
      externalId: "okta-0002",
    });

    expect(created).toBe(true);
    expect(member.userId).toBe("scim-known");
  });

  it("can create somebody the directory sent already deactivated", async () => {
    const { member } = await provisionDirectoryUser(await deps(), {
      workspaceId,
      email: "dormant@scim.test",
      name: "Dormant",
      active: false,
    });

    expect(member.active).toBe(false);
  });
});

describe("a user the directory removed", () => {
  it("is suspended, and never deleted", async () => {
    const wb = await workerDb();
    const [ada] = (await listDirectoryUsers(wb.appPool, workspaceId)).filter(
      (member) => member.email === "ada@scim.test",
    );

    const suspended = await setDirectoryUserActive(wb.appPool, {
      workspaceId,
      memberId: ada?.memberId as string,
      active: false,
    });
    expect(suspended.active).toBe(false);

    const { rows } = await wb.admin.query(
      "select status, deleted_at from workspace_members where id = $1",
      [ada?.memberId],
    );
    expect(rows[0]?.status).toBe("suspended");
    expect(rows[0]?.deleted_at).toBeNull();
  });

  it("comes back when the directory restores them", async () => {
    const wb = await workerDb();
    const [ada] = (await listDirectoryUsers(wb.appPool, workspaceId)).filter(
      (member) => member.email === "ada@scim.test",
    );

    const restored = await setDirectoryUserActive(wb.appPool, {
      workspaceId,
      memberId: ada?.memberId as string,
      active: true,
    });
    expect(restored.active).toBe(true);
  });

  it("cannot be the last person who can administer the workspace", async () => {
    const wb = await workerDb();
    const [owner] = (await listDirectoryUsers(wb.appPool, workspaceId)).filter(
      (member) => member.email === "owner@scim.test",
    );

    await expect(
      setDirectoryUserActive(wb.appPool, {
        workspaceId,
        memberId: owner?.memberId as string,
        active: false,
      }),
    ).rejects.toThrow();

    const { rows } = await wb.admin.query(
      "select status from workspace_members where id = $1",
      [owner?.memberId],
    );
    expect(rows[0]?.status).toBe("active");
  });
});

describe("listing members for the directory to reconcile against", () => {
  it("answers with everybody, suspended people included", async () => {
    const wb = await workerDb();
    const members = await listDirectoryUsers(wb.appPool, workspaceId);

    expect(members.map((member) => member.email).sort()).toEqual([
      "ada@scim.test",
      "dormant@scim.test",
      "known@scim.test",
      "owner@scim.test",
    ]);
    expect(members.find((m) => m.email === "dormant@scim.test")?.active).toBe(
      false,
    );
  });

  it("answers one person when the filter names them", async () => {
    const wb = await workerDb();
    const members = await listDirectoryUsers(wb.appPool, workspaceId, {
      attribute: "userName",
      value: "ADA@scim.test",
    });

    expect(members).toHaveLength(1);
    expect(members[0]?.email).toBe("ada@scim.test");
  });

  it("answers nobody when the filter names nobody here", async () => {
    const wb = await workerDb();
    expect(
      await listDirectoryUsers(wb.appPool, workspaceId, {
        attribute: "userName",
        value: "stranger@elsewhere.test",
      }),
    ).toHaveLength(0);
  });
});
