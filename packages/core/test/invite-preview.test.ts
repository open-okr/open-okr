import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  addressMayAccept,
  inviteTokenFromCookies,
  previewInvite,
} from "../src/index.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Answering what an invitation token is for (GAP-AUDIT B-07, P6-G06b).
 *
 * **Every invitation this product ever sent was a 404.** `sendInvitation` has
 * mailed `<base>/join/<token>` since P1-T07 and no such route existed. Building
 * it needed one thing first: which workspace a token belongs to, asked by
 * somebody with no session, no member row and no workspace. Migration 0010
 * assumed the URL would carry a slug and nothing ever built it that way, so
 * 0075 gives `invite_links` the second-key policy `api_tokens` has and this is
 * the read that uses it.
 *
 * The tests that matter are the refusals. A preview that answered "revoked"
 * where it should answer nothing would confirm to a stranger that a token
 * existed, and one that consumed a use on a page load would burn a single-use
 * invitation on somebody opening the link twice.
 */

const OWNER = "invite-owner";

let workspaceId: string;

function context(userId: string) {
  return { workspaceId, actor: { kind: "human" as const, userId } };
}

async function pool() {
  return (await workerDb()).appPool;
}

/** Issues a shareable link and hands back its raw token. */
async function issueWorkspaceLink(
  input: { maxUses?: number; expiresInDays?: number } = {},
): Promise<string> {
  const link = await callAction(
    { pool: await pool(), ...context(OWNER) },
    "invitations.createWorkspaceLink",
    input,
  );
  return link.token;
}

async function issuePersonalLink(email: string): Promise<string> {
  const link = await callAction(
    { pool: await pool(), ...context(OWNER) },
    "invitations.createPersonalLink",
    { email },
  );
  return link.token;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Invite Owner", "invite-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Invite Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("previewInvite", () => {
  it("names the workspace a token belongs to, with no tenant known", async () => {
    // The whole reason migration 0075 exists. Nothing here sets
    // `app.workspace_id`: the digest is the only thing the caller holds.
    const token = await issueWorkspaceLink();

    const preview = await previewInvite(await pool(), {
      token,
      now: new Date(),
    });

    expect(preview.kind).toBe("usable");
    if (preview.kind !== "usable") {
      return;
    }
    expect(preview.workspaceId).toBe(workspaceId);
    expect(preview.workspaceName.length).toBeGreaterThan(0);
    expect(preview.mode).toBe("workspace");
  });

  it("consumes nothing, so opening the link twice costs nothing", async () => {
    const token = await issuePersonalLink("guest@example.com");
    const wb = await workerDb();

    await previewInvite(wb.appPool, { token, now: new Date() });
    await previewInvite(wb.appPool, { token, now: new Date() });

    const { rows } = await wb.admin.query<{ use_count: number }>(
      "select use_count from invite_links where workspace_id = $1",
      [workspaceId],
    );
    expect(rows[0]?.use_count).toBe(0);
  });

  it("refuses a token that names nothing", async () => {
    const preview = await previewInvite(await pool(), {
      token: "not-a-token-anybody-issued",
      now: new Date(),
    });
    expect(preview).toEqual({ kind: "refused", reason: "invalid" });
  });

  it("refuses a revoked one", async () => {
    const token = await issueWorkspaceLink();
    const wb = await workerDb();
    await wb.admin.query(
      "update invite_links set revoked_at = now() where workspace_id = $1",
      [workspaceId],
    );

    const preview = await previewInvite(wb.appPool, {
      token,
      now: new Date(),
    });
    expect(preview).toEqual({ kind: "refused", reason: "revoked" });
  });

  it("refuses an expired one", async () => {
    const token = await issueWorkspaceLink({ expiresInDays: 1 });
    const preview = await previewInvite(await pool(), {
      token,
      // Two days on, which is after a one-day expiry.
      now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    });
    expect(preview).toEqual({ kind: "refused", reason: "expired" });
  });

  it("refuses one that has run out of uses", async () => {
    const token = await issueWorkspaceLink({ maxUses: 1 });
    const wb = await workerDb();
    await wb.admin.query(
      "update invite_links set use_count = 1 where workspace_id = $1",
      [workspaceId],
    );

    const preview = await previewInvite(wb.appPool, {
      token,
      now: new Date(),
    });
    expect(preview).toEqual({ kind: "refused", reason: "used_up" });
  });

  it("refuses a personal one that has already been taken", async () => {
    // A personal link is single-use by carrying the member it created, which
    // is why migration 0010 stores no max_uses of 1 for it.
    const token = await issuePersonalLink("guest@example.com");
    const wb = await workerDb();
    const member = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, name, kind, status)
       values (gen_random_uuid(), $1, 'Guest', 'human', 'active')
       returning id`,
      [workspaceId],
    );
    await wb.admin.query(
      "update invite_links set member_id = $2 where workspace_id = $1",
      [workspaceId, member.rows[0]?.id],
    );

    const preview = await previewInvite(wb.appPool, {
      token,
      now: new Date(),
    });
    expect(preview).toEqual({ kind: "refused", reason: "already_taken" });
  });
});

describe("addressMayAccept", () => {
  it("admits only the address a personal invitation names", () => {
    const link = {
      mode: "personal" as const,
      email: "guest@example.com",
      allowedDomains: [],
    };
    expect(addressMayAccept(link, "guest@example.com")).toBe(true);
    expect(addressMayAccept(link, "GUEST@example.com")).toBe(true);
    expect(addressMayAccept(link, "somebody@example.com")).toBe(false);
  });

  it("admits anybody holding an unbounded shareable link", () => {
    const link = {
      mode: "workspace" as const,
      email: null,
      allowedDomains: [],
    };
    expect(addressMayAccept(link, "anyone@anywhere.test")).toBe(true);
  });

  it("holds a bounded shareable link to its domains", () => {
    const link = {
      mode: "workspace" as const,
      email: null,
      allowedDomains: ["example.com"],
    };
    expect(addressMayAccept(link, "somebody@example.com")).toBe(true);
    expect(addressMayAccept(link, "somebody@elsewhere.test")).toBe(false);
    // Not an address at all. Refused rather than treated as a bare domain.
    expect(addressMayAccept(link, "example.com")).toBe(false);
  });
});

describe("inviteTokenFromCookies", () => {
  it("finds the token among other cookies", () => {
    expect(inviteTokenFromCookies("a=1; openokr_invite=abc123; b=2")).toBe(
      "abc123",
    );
  });

  it("answers null when there is nothing to find", () => {
    expect(inviteTokenFromCookies(null)).toBeNull();
    expect(inviteTokenFromCookies("")).toBeNull();
    expect(inviteTokenFromCookies("other=1")).toBeNull();
    expect(inviteTokenFromCookies("openokr_invite=")).toBeNull();
  });

  it("does not throw on a malformed header, because a hook cannot crash", () => {
    expect(inviteTokenFromCookies("openokr_invite=%E0%A4%A")).toBeNull();
    expect(inviteTokenFromCookies(";;;")).toBeNull();
  });
});
