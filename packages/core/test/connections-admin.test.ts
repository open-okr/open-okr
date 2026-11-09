import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { approveAuthorisationForMember, challengeFor } from "../src/index.ts";
import { provisionMemberForInvite } from "../src/invitations/provisioning.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * An administrator's list of the workspace's agent connections, and the
 * power to end one (docs/design/agent-connections-admin.md, plan 0.7.0 A4,
 * approved 9 November 2026 with agent API tokens and an inbox notice).
 *
 * Each member saw only their own, at /account/connections. An administrator
 * could end every connection a colleague had only by suspending them.
 */

const OWNER = "connections-owner";
const MEMBER = "connections-member";

let workspaceId: string;
let memberId: string;

const as = async (userId: string, channel?: string) => ({
  pool: (await workerDb()).appPool,
  workspaceId,
  actor: { kind: "human" as const, userId },
  ...(channel ? { channel } : {}),
});

/** A connection the member made, as the consent screen makes one. */
async function memberGrant(): Promise<string> {
  const wb = await workerDb();
  const outcome = await approveAuthorisationForMember(wb.appPool, {
    workspaceId,
    userId: MEMBER,
    clientId: "openokr-cli",
    redirectUri: "http://127.0.0.1:7777/callback",
    challenge: challengeFor("a".repeat(64)),
    challengeMethod: "S256",
    scope: "read write",
    resource: "",
    issuer: "https://okr.example",
    now: new Date(),
  });
  if (outcome.kind !== "issued") {
    throw new Error("expected a grant");
  }
  return outcome.grantId;
}

/** An agent token the member made on their own tokens screen. */
async function memberAgentToken(): Promise<string> {
  const created = await callAction(await as(MEMBER), "tokens.create", {
    name: "My agent",
    audience: "mcp",
    scopes: ["read"],
    expiresInDays: null,
  });
  return created.id;
}

const inboxOf = async (member: string, reason: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select id from notifications where workspace_id = $1 and recipient_member_id = $2 and reason = $3",
    [workspaceId, member, reason],
  );
  return rows.length;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2), ($3, $3, $4)",
    [
      OWNER,
      "connections-owner@example.com",
      MEMBER,
      "connections-member@example.com",
    ],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: OWNER })
  ).workspaceId;
  memberId = (
    await withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
      provisionMemberForInvite(tx, {
        workspaceId,
        user: { id: MEMBER, name: MEMBER },
      }),
    )
  ).memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the administrator's list", () => {
  it("shows a colleague's connections and agent tokens, and nothing secret", async () => {
    await memberGrant();
    await memberAgentToken();
    const listed = await callAction(await as(OWNER), "connections.list", {
      state: "live",
      page: 0,
    });
    expect(listed.items.map((item) => item.kind).sort()).toEqual([
      "grant",
      "token",
    ]);
    for (const item of listed.items) {
      expect(item.memberId).toBe(memberId);
      expect(JSON.stringify(item)).not.toMatch(/hash|token_|redirect/i);
    }
  });

  it("is refused to a member below full access", async () => {
    await expect(
      callAction(await as(MEMBER), "connections.list", {
        state: "live",
        page: 0,
      }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/not_found|forbidden/),
    });
  });

  it("is refused through any channel but the signed-in browser", async () => {
    await expect(
      callAction(await as(OWNER, "rest"), "connections.list", {
        state: "live",
        page: 0,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("ending a colleague's connection", () => {
  it("revokes the grant, says why on their page, tells them, and records it", async () => {
    const grantId = await memberGrant();
    await callAction(await as(OWNER), "connections.revokeAsAdmin", {
      kind: "grant",
      id: grantId,
    });

    const own = await callAction(await as(MEMBER), "connections.mine", {});
    expect(own.connections[0]?.revokedReason).toBe(
      "An administrator of this workspace ended this connection.",
    );
    expect(await inboxOf(memberId, "connection_ended")).toBe(1);
    const wb = await workerDb();
    const audit = await wb.admin.query(
      "select target_type from audit_events where workspace_id = $1 and action = 'connections.revokeAsAdmin'",
      [workspaceId],
    );
    expect(audit.rows).toEqual([{ target_type: "oauth_grant" }]);
  });

  it("ends an agent token the same way, with its reason stored", async () => {
    const tokenId = await memberAgentToken();
    await callAction(await as(OWNER), "connections.revokeAsAdmin", {
      kind: "token",
      id: tokenId,
    });
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select revoked_at is not null as revoked, revoked_reason from api_tokens where id = $1",
      [tokenId],
    );
    expect(rows[0]).toEqual({ revoked: true, revoked_reason: "admin" });
    expect(await inboxOf(memberId, "connection_ended")).toBe(1);
  });

  it("answers not-found for one that is already ended", async () => {
    const grantId = await memberGrant();
    await callAction(await as(OWNER), "connections.revokeAsAdmin", {
      kind: "grant",
      id: grantId,
    });
    await expect(
      callAction(await as(OWNER), "connections.revokeAsAdmin", {
        kind: "grant",
        id: grantId,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("is refused through any channel but the signed-in browser", async () => {
    const grantId = await memberGrant();
    await expect(
      callAction(await as(OWNER, "mcp"), "connections.revokeAsAdmin", {
        kind: "grant",
        id: grantId,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

// agent-tool-calls.md D11 and D12, plan 0.7.0 A2: the record of agent calls is
// kept 90 days by default, and 0 keeps every row.
describe("the agent call record's retention", () => {
  const callAgo = async (grantId: string, days: number) => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into ai_tool_calls (workspace_id, member_id, grant_id, tool, scope, outcome, duration_ms, called_at)
       values ($1, $2, $3, 'cycles.list', 'read', 'ok', 4, now() - ($4 || ' days')::interval)`,
      [workspaceId, memberId, grantId, String(days)],
    );
  };
  const count = async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select count(*)::int as n from ai_tool_calls where workspace_id = $1",
      [workspaceId],
    );
    return rows[0].n as number;
  };

  it("removes what is older than 90 days by default, and audits the count", async () => {
    const grantId = await memberGrant();
    await callAgo(grantId, 100);
    await callAgo(grantId, 1);
    const swept = await callAction(
      {
        pool: (await workerDb()).appPool,
        workspaceId,
        actor: { kind: "system" },
      },
      "connections.sweepToolCalls",
      {},
    );
    expect(swept).toMatchObject({ deleted: 1, retentionDays: 90 });
    expect(await count()).toBe(1);
  });

  it("keeps every row when the window is 0", async () => {
    const grantId = await memberGrant();
    await callAgo(grantId, 4000);
    await callAction(await as(OWNER), "settings.updateWorkspaceLimits", {
      agentToolCallRetentionDays: 0,
    });
    await callAction(
      {
        pool: (await workerDb()).appPool,
        workspaceId,
        actor: { kind: "system" },
      },
      "connections.sweepToolCalls",
      {},
    );
    expect(await count()).toBe(1);
  });

  it("refuses a window under a week", async () => {
    await expect(
      callAction(await as(OWNER), "settings.updateWorkspaceLimits", {
        agentToolCallRetentionDays: 3,
      }),
    ).rejects.toThrow();
  });
});
