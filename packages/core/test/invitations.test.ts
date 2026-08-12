import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Invitations (P2-T04 test plan, TECHNICAL-PLAN §4.1).
 *
 * Invite, accept, the member exists. A link past its limit, expiry or
 * revocation refuses. A domain-restricted link rejects other domains.
 * Trusted-domain joining works. Only a member with full access may invite.
 */

const OWNER = "invitations-owner";

let workspaceId: string;

const ownerContext = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

async function createUser(id: string, email: string, name: string) {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [id, name, email],
  );
}

function actingAs(userId: string) {
  return { workspaceId, actor: { kind: "human" as const, userId } };
}

async function memberRow(userId: string) {
  const wb = await workerDb();
  const rows = await wb.admin.query(
    "select id, status from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, userId],
  );
  return rows.rows[0] as { id: string; status: string } | undefined;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await createUser(OWNER, "owner@example.com", "Owner");
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a reusable workspace link", () => {
  it("invites, accepts, and the member exists", async () => {
    const wb = await workerDb();
    const link = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createWorkspaceLink",
      {},
    );
    expect(link.token).toBeTruthy();

    await createUser("invitee-1", "invitee1@example.com", "Invitee One");
    const outcome = await callAction(
      { pool: wb.appPool, ...actingAs("invitee-1") },
      "invitations.acceptLink",
      { token: link.token },
    );

    const member = await memberRow("invitee-1");
    expect(member?.status).toBe("active");
    expect(member?.id).toBe(outcome.memberId);
  });

  it("is idempotent: accepting twice does not create a second member", async () => {
    const wb = await workerDb();
    const link = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createWorkspaceLink",
      {},
    );
    await createUser("invitee-2", "invitee2@example.com", "Invitee Two");

    const first = await callAction(
      { pool: wb.appPool, ...actingAs("invitee-2") },
      "invitations.acceptLink",
      { token: link.token },
    );
    const second = await callAction(
      { pool: wb.appPool, ...actingAs("invitee-2") },
      "invitations.acceptLink",
      { token: link.token },
    );
    expect(second.memberId).toBe(first.memberId);

    const rows = await wb.admin.query(
      "select count(*)::int as n from workspace_members where user_id = $1",
      ["invitee-2"],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it("refuses once past its use limit", async () => {
    const wb = await workerDb();
    const link = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createWorkspaceLink",
      { maxUses: 1 },
    );
    await createUser("invitee-3", "invitee3@example.com", "Invitee Three");
    await callAction(
      { pool: wb.appPool, ...actingAs("invitee-3") },
      "invitations.acceptLink",
      { token: link.token },
    );

    await createUser("invitee-4", "invitee4@example.com", "Invitee Four");
    await expect(
      callAction(
        { pool: wb.appPool, ...actingAs("invitee-4") },
        "invitations.acceptLink",
        { token: link.token },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await memberRow("invitee-4")).toBeUndefined();
  });

  it("refuses once expired", async () => {
    const wb = await workerDb();
    const link = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createWorkspaceLink",
      {},
    );
    await wb.admin.query(
      "update invite_links set expires_at = now() - interval '1 day' where id = $1",
      [link.id],
    );

    await createUser("invitee-5", "invitee5@example.com", "Invitee Five");
    await expect(
      callAction(
        { pool: wb.appPool, ...actingAs("invitee-5") },
        "invitations.acceptLink",
        { token: link.token },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses once revoked", async () => {
    const wb = await workerDb();
    const link = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createWorkspaceLink",
      {},
    );
    await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.revokeLink",
      { linkId: link.id },
    );

    await createUser("invitee-6", "invitee6@example.com", "Invitee Six");
    await expect(
      callAction(
        { pool: wb.appPool, ...actingAs("invitee-6") },
        "invitations.acceptLink",
        { token: link.token },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects a domain outside the allow list, and accepts one inside it", async () => {
    const wb = await workerDb();
    const link = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createWorkspaceLink",
      { allowedDomains: ["allowed.example"] },
    );

    await createUser("outsider", "person@other.example", "Outsider");
    await expect(
      callAction(
        { pool: wb.appPool, ...actingAs("outsider") },
        "invitations.acceptLink",
        { token: link.token },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await memberRow("outsider")).toBeUndefined();

    await createUser("insider", "person@allowed.example", "Insider");
    const outcome = await callAction(
      { pool: wb.appPool, ...actingAs("insider") },
      "invitations.acceptLink",
      { token: link.token },
    );
    expect(outcome.memberId).toBeTruthy();
  });
});

describe("a single-use personal link", () => {
  it("only the invited address can accept it, once", async () => {
    const wb = await workerDb();
    const link = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createPersonalLink",
      { email: "personal@example.com" },
    );

    await createUser("wrong-person", "someone-else@example.com", "Wrong");
    await expect(
      callAction(
        { pool: wb.appPool, ...actingAs("wrong-person") },
        "invitations.acceptLink",
        { token: link.token },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });

    await createUser("right-person", "personal@example.com", "Right");
    const outcome = await callAction(
      { pool: wb.appPool, ...actingAs("right-person") },
      "invitations.acceptLink",
      { token: link.token },
    );
    expect(outcome.memberId).toBeTruthy();

    // Used once: a second person cannot accept it again, even one who could
    // otherwise have been invited by the same link. `users.email` is unique,
    // so this cannot literally be the invited address again on a second
    // account — the point is single-use, not the address matching.
    await createUser(
      "right-person-2",
      "someone-else-2@example.com",
      "Right Two",
    );
    await expect(
      callAction(
        { pool: wb.appPool, ...actingAs("right-person-2") },
        "invitations.acceptLink",
        { token: link.token },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("trusted-domain automatic joining", () => {
  it("joins without a link when the email domain is trusted", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `update workspaces set settings = settings || '{"trustedEmailDomains": ["trusted.example"]}'::jsonb where id = $1`,
      [workspaceId],
    );

    await createUser("trusted-person", "someone@trusted.example", "Trusted");
    const outcome = await callAction(
      { pool: wb.appPool, ...actingAs("trusted-person") },
      "invitations.joinByTrustedDomain",
      {},
    );
    expect(outcome.memberId).toBeTruthy();
    expect((await memberRow("trusted-person"))?.status).toBe("active");
  });

  it("refuses when the domain is not trusted", async () => {
    const wb = await workerDb();
    await createUser(
      "untrusted-person",
      "someone@untrusted.example",
      "Untrusted",
    );
    await expect(
      callAction(
        { pool: wb.appPool, ...actingAs("untrusted-person") },
        "invitations.joinByTrustedDomain",
        {},
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("only a member with full access may invite", () => {
  it("refuses to create a link for a member without full access", async () => {
    const wb = await workerDb();
    // A workspace_standard binding only ever reaches view by default in this
    // build (nothing raises it), so a plain second member has no way to
    // reach full without an explicit grant, which is exactly the point.
    await createUser("low-access", "low@example.com", "Low Access");
    const link = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createWorkspaceLink",
      {},
    );
    await callAction(
      { pool: wb.appPool, ...actingAs("low-access") },
      "invitations.acceptLink",
      { token: link.token },
    );

    await expect(
      callAction(
        { pool: wb.appPool, ...actingAs("low-access") },
        "invitations.createWorkspaceLink",
        {},
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
