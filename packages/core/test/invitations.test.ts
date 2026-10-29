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

/**
 * A joining member's own timezone, from the browser they joined in
 * (TECHNICAL-PLAN §4.14, docs/design/browser-timezone.md). The web layer reads
 * `openokr_tz` and passes it; the action checks it like any other timezone
 * write. Absent, the member has none and reads the workspace's.
 */
describe("a joining member's timezone", () => {
  async function zoneOf(userId: string) {
    const wb = await workerDb();
    const rows = await wb.admin.query(
      "select timezone from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, userId],
    );
    return rows.rows[0]?.timezone as string | null | undefined;
  }
  async function workspaceZone() {
    const wb = await workerDb();
    const rows = await wb.admin.query(
      "select settings ->> 'timezone' as zone from workspaces where id = $1",
      [workspaceId],
    );
    return rows.rows[0]?.zone as string | undefined;
  }
  async function link() {
    const wb = await workerDb();
    return callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createWorkspaceLink",
      {},
    );
  }

  it("takes the browser's zone through a link, and leaves the workspace's alone", async () => {
    const wb = await workerDb();
    const { token } = await link();
    await createUser("berlin", "berlin@example.com", "Berlin");
    await callAction(
      { pool: wb.appPool, ...actingAs("berlin") },
      "invitations.acceptLink",
      { token, timezone: "Europe/Berlin" },
    );
    expect(await zoneOf("berlin")).toBe("Europe/Berlin");
    expect(await workspaceZone()).toBe("UTC");
  });

  it("has none of its own without one, and so reads the workspace's", async () => {
    const wb = await workerDb();
    const { token } = await link();
    await createUser("plain", "plain@example.com", "Plain");
    await callAction(
      { pool: wb.appPool, ...actingAs("plain") },
      "invitations.acceptLink",
      { token },
    );
    expect(await zoneOf("plain")).toBeNull();
  });

  it("refuses a zone off the list, and writes nothing", async () => {
    const wb = await workerDb();
    const { token } = await link();
    await createUser("mars", "mars@example.com", "Mars");
    await expect(
      callAction(
        { pool: wb.appPool, ...actingAs("mars") },
        "invitations.acceptLink",
        { token, timezone: "Mars/Olympus_Mons" },
      ),
    ).rejects.toThrow();
    expect(await memberRow("mars")).toBeUndefined();
  });

  it("takes it when joining by a trusted domain too", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `update workspaces set settings = settings || '{"trustedEmailDomains": ["trusted.example"]}'::jsonb where id = $1`,
      [workspaceId],
    );
    await createUser("tokyo", "tokyo@trusted.example", "Tokyo");
    await wb.admin.query(
      "update users set email_verified = true where id = $1",
      ["tokyo"],
    );
    await callAction(
      { pool: wb.appPool, ...actingAs("tokyo") },
      "invitations.joinByTrustedDomain",
      { timezone: "Asia/Tokyo" },
    );
    expect(await zoneOf("tokyo")).toBe("Asia/Tokyo");
  });

  it("gives a waiting imported member the zone it lacks, and keeps one it has", async () => {
    const wb = await workerDb();
    const owner = { pool: wb.appPool, ...ownerContext() };
    await callAction(owner, "people.importMember", {
      name: "Waiting Without",
      email: "without@example.com",
      legacy: { type: "csv", id: "without" },
    });
    await callAction(owner, "people.importMember", {
      name: "Waiting With",
      email: "with@example.com",
      timezone: "America/New_York",
      legacy: { type: "csv", id: "with" },
    });
    const { token } = await link();

    await createUser("without", "without@example.com", "Waiting Without");
    await callAction(
      { pool: wb.appPool, ...actingAs("without") },
      "invitations.acceptLink",
      { token, timezone: "Asia/Kuala_Lumpur" },
    );
    await createUser("with", "with@example.com", "Waiting With");
    await callAction(
      { pool: wb.appPool, ...actingAs("with") },
      "invitations.acceptLink",
      { token, timezone: "Asia/Kuala_Lumpur" },
    );

    expect(await zoneOf("without")).toBe("Asia/Kuala_Lumpur");
    expect(await zoneOf("with")).toBe("America/New_York");
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
    // A confirmed address, which joining by domain requires since
    // completeness review M-34. The rest of that path, and every refusal, is
    // in `trusted-domain.test.ts`.
    await wb.admin.query(
      "update users set email_verified = true where id = $1",
      ["trusted-person"],
    );
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

  it("refuses to list them either, because the list names addresses", async () => {
    // Added at P6-G06a. Reading who has been invited is reading email
    // addresses and who invited them, which is the same fact the create path
    // guards, so it takes the same level.
    //
    // `forbidden`, as the create path beside it raises: an active member
    // already knows the workspace, so they are told the level they lack
    // rather than that the workspace does not exist (MCP UAT BUG-005). A
    // stranger still hears `not_found`, which `read-access.test.ts` pins.
    const wb = await workerDb();
    await createUser("low-reader", "reader@example.com", "Low Reader");
    const link = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createWorkspaceLink",
      {},
    );
    await callAction(
      { pool: wb.appPool, ...actingAs("low-reader") },
      "invitations.acceptLink",
      { token: link.token },
    );

    await expect(
      callAction(
        { pool: wb.appPool, ...actingAs("low-reader") },
        "invitations.list",
        {},
      ),
    ).rejects.toMatchObject({
      code: "forbidden",
      message: "invitations.list needs a higher access level than you hold.",
    });
  });
});

/**
 * Listing what has been issued (P6-G06a).
 *
 * P2-T04 built five write actions and no read, so an administrator could issue
 * an invitation and then had no way to see it. `revokeLink` takes an id, which
 * made revoke unreachable in practice as well as in the interface.
 */
describe("listing invitations", () => {
  it("returns nothing on a workspace that has issued nothing", async () => {
    const wb = await workerDb();
    const links = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.list",
      {},
    );
    expect(links).toEqual([]);
  });

  it("never returns a token, because the table holds only its digest", async () => {
    // The whole reason a leaked list of invitations is harmless. A read that
    // could hand back a working token would undo that, and no screen needs one.
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createWorkspaceLink",
      { maxUses: 5 },
    );
    const links = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.list",
      {},
    );
    expect(links).toHaveLength(1);
    expect(JSON.stringify(links)).not.toContain("token");
  });

  it("carries what the screen needs to say what a link is doing", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createPersonalLink",
      { email: "Newcomer@Example.com", expiresInDays: 7 },
    );
    const [link] = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.list",
      {},
    );
    expect(link?.mode).toBe("personal");
    expect(link?.email).toBe("newcomer@example.com");
    expect(link?.maxUses).toBe(1);
    expect(link?.useCount).toBe(0);
    expect(link?.expiresAt).not.toBeNull();
    expect(link?.revokedAt).toBeNull();
  });

  it("keeps a revoked link in the list", async () => {
    // "Did I already invite this person" is a question about history. A list
    // that hid the answer would send an administrator to issue a second link.
    const wb = await workerDb();
    const created = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createWorkspaceLink",
      {},
    );
    await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.revokeLink",
      { linkId: created.id },
    );
    const [link] = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.list",
      {},
    );
    expect(link?.id).toBe(created.id);
    expect(link?.revokedAt).not.toBeNull();
  });

  it("carries the allowed domains a workspace link was bounded with", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createWorkspaceLink",
      { allowedDomains: ["example.com"] },
    );
    const [link] = await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.list",
      {},
    );
    expect(link?.allowedDomains).toEqual(["example.com"]);
  });

  it("refuses an allowed domain that is not a domain, as a trusted domain is", async () => {
    // guided-inputs §4.11: one domain rule. This took any word, so a link
    // bounded by "@example.com" or "example" let nobody in.
    const wb = await workerDb();
    for (const entry of ["@example.com", "example", "https://example.com"]) {
      await expect(
        callAction(
          { pool: wb.appPool, ...ownerContext() },
          "invitations.createWorkspaceLink",
          { allowedDomains: [entry] },
        ),
      ).rejects.toThrow("An allowed domain is written like example.com");
    }
  });

  it("opens a link for a year at most", async () => {
    // guided-inputs §6: no limit on either side, so a link could stay open
    // for as long as somebody typed.
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...ownerContext() },
      "invitations.createWorkspaceLink",
      { expiresInDays: 365 },
    );
    await expect(
      callAction(
        { pool: wb.appPool, ...ownerContext() },
        "invitations.createWorkspaceLink",
        { expiresInDays: 366 },
      ),
    ).rejects.toThrow();
  });
});
