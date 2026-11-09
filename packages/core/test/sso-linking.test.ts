import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/auth.ts";
import { mayLinkSSOAccount, ssoLinkAllowed } from "../src/auth/sso-linking.ts";
import { joinWorkspaceForIdentity } from "../src/workspaces/directory-join.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Which accounts a single sign-on connection may attach a sign-in to
 * (docs/design/sso-account-trust.md, rules 1, 3 and 6).
 *
 * The rule is tested on its own, then against real rows, then through
 * Better Auth's own account write, which is where the hook is wired.
 */

const BASE_URL = "http://localhost:3000";
const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const PROVIDER = "sso-okta-link0001";
const OTHER_PROVIDER = "sso-okta-link0002";

let workspaceId: string;
let otherWorkspaceId: string;
let auth: ReturnType<typeof createAuth>;

const insertUser = async (id: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    `insert into users (id, name, email, email_verified, created_at, updated_at)
     values ($1, $1, $2, true, now(), now())
     on conflict (id) do nothing`,
    [id, `${id}@link.example`],
  );
};

const insertPassword = async (userId: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    `insert into accounts (id, user_id, account_id, provider_id, password)
     values ($1, $2, $2, 'credential', 'hash')`,
    [`cred-${userId}`, userId],
  );
};

const join = async (userId: string, into: string = workspaceId) => {
  const wb = await workerDb();
  await joinWorkspaceForIdentity(wb.appPool, {
    workspaceId: into,
    user: { id: userId, name: userId },
    via: "sso",
  });
};

const providerAccounts = async (userId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select provider_id from accounts where user_id = $1 and provider_id like 'sso-%'",
    [userId],
  );
  return rows;
};

/** Better Auth's own write of a provider account, hooks included. */
const link = async (userId: string, providerId: string) => {
  const context = await auth.$context;
  return context.internalAdapter.linkAccount({
    userId,
    providerId,
    accountId: `${providerId}-${userId}`,
  });
};

beforeAll(async () => {
  const wb = await workerDb();
  await insertUser("link-owner");
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: "link-owner",
      name: "Linking Workspace",
    })
  ).workspaceId;
  await insertUser("link-other-owner");
  otherWorkspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: "link-other-owner",
      name: "Other Workspace",
    })
  ).workspaceId;

  auth = createAuth({
    pool: wb.appPool,
    secret: SECRET,
    baseUrl: BASE_URL,
    rateLimit: { enabled: false },
    ssoProviders: [
      {
        providerId: PROVIDER,
        workspaceId,
        clientId: "client-id",
        clientSecret: "client-secret",
        authorizationUrl: "https://idp.example.com/authorize",
        tokenUrl: "https://idp.example.com/token",
        userInfoUrl: "https://idp.example.com/userinfo",
      },
    ],
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the linking rule", () => {
  const member = (status: string, deleted = false, ws = "ws-a") => ({
    workspaceId: ws,
    status,
    deleted,
  });

  it("admits an active or invited member of the connection's workspace", () => {
    for (const status of ["active", "invited"]) {
      expect(
        mayLinkSSOAccount("ws-a", {
          memberships: [member(status)],
          hasOtherAccount: true,
        }),
      ).toBe(true);
    }
  });

  it("refuses a suspended or removed member, and a member of another workspace", () => {
    const facts = (m: ReturnType<typeof member>) => ({
      memberships: [m],
      hasOtherAccount: true,
    });
    expect(mayLinkSSOAccount("ws-a", facts(member("suspended")))).toBe(false);
    expect(mayLinkSSOAccount("ws-a", facts(member("active", true)))).toBe(
      false,
    );
    expect(
      mayLinkSSOAccount("ws-a", facts(member("active", false, "ws-b"))),
    ).toBe(false);
  });

  it("admits a new account and nothing that has another way in", () => {
    expect(
      mayLinkSSOAccount("ws-a", { memberships: [], hasOtherAccount: false }),
    ).toBe(true);
    expect(
      mayLinkSSOAccount("ws-a", { memberships: [], hasOtherAccount: true }),
    ).toBe(false);
    expect(
      mayLinkSSOAccount("ws-a", {
        memberships: [member("active", false, "ws-b")],
        hasOtherAccount: false,
      }),
    ).toBe(false);
  });
});

describe("the linking rule against real accounts", () => {
  it("admits an active member who has a password", async () => {
    const wb = await workerDb();
    await insertUser("link-member");
    await insertPassword("link-member");
    await join("link-member");

    expect(await ssoLinkAllowed(wb.appPool, "link-member", workspaceId)).toBe(
      true,
    );
  });

  it("refuses an account that belongs to another workspace only", async () => {
    const wb = await workerDb();
    await insertUser("link-outsider");
    await insertPassword("link-outsider");
    await join("link-outsider", otherWorkspaceId);

    expect(await ssoLinkAllowed(wb.appPool, "link-outsider", workspaceId)).toBe(
      false,
    );
  });

  it("admits a fresh registration: no other method, no membership", async () => {
    const wb = await workerDb();
    await insertUser("link-fresh");

    expect(await ssoLinkAllowed(wb.appPool, "link-fresh", workspaceId)).toBe(
      true,
    );
  });

  it("refuses a suspended member", async () => {
    const wb = await workerDb();
    await insertUser("link-suspended");
    await insertPassword("link-suspended");
    await join("link-suspended");
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where user_id = 'link-suspended'",
    );

    expect(
      await ssoLinkAllowed(wb.appPool, "link-suspended", workspaceId),
    ).toBe(false);
  });
});

describe("the account write", () => {
  it("links a member of the connection's workspace", async () => {
    await insertUser("write-member");
    await insertPassword("write-member");
    await join("write-member");

    await link("write-member", PROVIDER);

    expect(await providerAccounts("write-member")).toHaveLength(1);
  });

  it("writes no account row for a user outside that workspace", async () => {
    await insertUser("write-outsider");
    await insertPassword("write-outsider");
    await join("write-outsider", otherWorkspaceId);

    await expect(link("write-outsider", PROVIDER)).rejects.toMatchObject({
      status: "FORBIDDEN",
    });
    expect(await providerAccounts("write-outsider")).toHaveLength(0);
  });

  it("links a fresh account", async () => {
    await insertUser("write-fresh");

    await link("write-fresh", PROVIDER);

    expect(await providerAccounts("write-fresh")).toHaveLength(1);
  });

  it("leaves a provider that is not a workspace connection alone", async () => {
    await insertUser("write-other");
    await insertPassword("write-other");

    await link("write-other", OTHER_PROVIDER);

    expect(await providerAccounts("write-other")).toHaveLength(1);
  });
});
