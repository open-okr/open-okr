import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  hashApiToken,
  resolveApiToken,
  stampTokenUse,
} from "../src/api/tokens.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * API tokens (§14, P5-T07a).
 *
 * The acceptance criterion for this task is scope refusal, and it is tested at
 * the transport in the end-to-end suite because that is where a scope is
 * actually checked. What is tested here is everything a token *is*: hashed at
 * rest, bound to one audience, bound to one member, and dead the moment it is
 * revoked, expires, or the member is suspended.
 */

const OWNER = "token-owner";
const OTHER = "token-other";
const NOW = new Date("2026-08-28T09:00:00.000Z");

let workspaceId: string;
let memberId: string;

const asOwner = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

const mint = async (
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; token: string; prefix: string }> => {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...asOwner() }, "tokens.create", {
    name: "Deploy script",
    audience: "rest",
    scopes: ["read"],
    expiresInDays: null,
    ...overrides,
  });
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Owner",
      "token-owner@example.com",
      OTHER,
      "Other",
      "token-other@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  const member = await wb.admin.query(
    "select id from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, OWNER],
  );
  memberId = member.rows[0].id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("minting", () => {
  it("returns the raw token once and stores only its digest", async () => {
    const wb = await workerDb();
    const created = await mint();

    expect(created.token).toMatch(/^okr_rest_/);
    expect(created.prefix).toBe(created.token.slice(0, 16));

    const row = await wb.admin.query("select * from api_tokens where id = $1", [
      created.id,
    ]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].token_hash).toBe(hashApiToken(created.token));
    // The raw value appears in no column of the row it created. A stolen
    // database is not a set of credentials.
    const serialised = JSON.stringify(row.rows[0]);
    expect(serialised).not.toContain(created.token);
    // The prefix is in there, and that is deliberate: it is 16 characters of a
    // 43-character secret, kept so a person can tell two tokens apart.
    expect(row.rows[0].prefix).toBe(created.prefix);
  });

  it("never shows the token again", async () => {
    const wb = await workerDb();
    const created = await mint();
    const listed = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "tokens.mine",
      {},
    );
    expect(listed.tokens).toHaveLength(1);
    const serialised = JSON.stringify(listed.tokens);
    expect(serialised).not.toContain(created.token);
    expect(serialised).not.toContain(hashApiToken(created.token));
    // The prefix is there, and it does begin with the door marker. Sixteen
    // characters of a fifty-two character token, six of them random, which is
    // enough to tell two of your own apart and nowhere near enough to present.
    expect(listed.tokens[0]?.prefix).toBe(created.prefix);
    expect(created.token.length).toBeGreaterThan(created.prefix.length + 30);
  });

  it("marks the door in the token's own text", async () => {
    const rest = await mint({ audience: "rest" });
    const mcp = await mint({ name: "Agent", audience: "mcp" });
    expect(rest.token.startsWith("okr_rest_")).toBe(true);
    expect(mcp.token.startsWith("okr_mcp_")).toBe(true);
  });

  it("refuses a token with no scopes", async () => {
    await expect(mint({ scopes: [] })).rejects.toThrow();
  });
});

describe("resolving", () => {
  it("turns a token into the member who minted it", async () => {
    const wb = await workerDb();
    const created = await mint({ scopes: ["read", "write"] });

    const resolved = await resolveApiToken(wb.appPool, {
      raw: created.token,
      audience: "rest",
      now: NOW,
    });
    expect(resolved.kind).toBe("ok");
    if (resolved.kind === "ok") {
      expect(resolved.workspaceId).toBe(workspaceId);
      expect(resolved.memberId).toBe(memberId);
      expect(resolved.userId).toBe(OWNER);
      expect(resolved.scopes).toEqual(["read", "write"]);
    }
  });

  it("refuses a real token at the other door", async () => {
    const wb = await workerDb();
    const created = await mint({ audience: "rest" });

    const resolved = await resolveApiToken(wb.appPool, {
      raw: created.token,
      audience: "mcp",
      now: NOW,
    });
    expect(resolved).toEqual({ kind: "rejected", reason: "wrong_audience" });
  });

  it("refuses something that is not a token at all", async () => {
    const wb = await workerDb();
    for (const raw of ["", "   ", "hunter2", "Bearer okr_rest_x"]) {
      const resolved = await resolveApiToken(wb.appPool, {
        raw,
        audience: "rest",
        now: NOW,
      });
      expect(resolved).toEqual({ kind: "rejected", reason: "invalid" });
    }
  });

  it("refuses a well-formed token nobody issued", async () => {
    const wb = await workerDb();
    const resolved = await resolveApiToken(wb.appPool, {
      raw: `okr_rest_${"a".repeat(43)}`,
      audience: "rest",
      now: NOW,
    });
    expect(resolved).toEqual({ kind: "rejected", reason: "invalid" });
  });

  it("refuses a revoked token", async () => {
    const wb = await workerDb();
    const created = await mint();
    await callAction({ pool: wb.appPool, ...asOwner() }, "tokens.revoke", {
      id: created.id,
    });

    const resolved = await resolveApiToken(wb.appPool, {
      raw: created.token,
      audience: "rest",
      now: NOW,
    });
    expect(resolved).toEqual({ kind: "rejected", reason: "revoked" });
  });

  it("refuses an expired token, on the clock the caller supplies", async () => {
    const wb = await workerDb();
    const created = await mint({ expiresInDays: 1 });

    const stillGood = await resolveApiToken(wb.appPool, {
      raw: created.token,
      audience: "rest",
      now: new Date(Date.parse("2026-08-28T09:00:00.000Z")),
    });
    expect(stillGood.kind).toBe("ok");

    // Two days on. Nothing had to run for this to stop working.
    const expired = await resolveApiToken(wb.appPool, {
      raw: created.token,
      audience: "rest",
      now: new Date(Date.parse("2026-08-30T09:00:00.000Z")),
    });
    expect(expired).toEqual({ kind: "rejected", reason: "expired" });
  });

  it("stops working when the member is suspended, with nothing revoked", async () => {
    const wb = await workerDb();
    const created = await mint();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberId],
    );

    const resolved = await resolveApiToken(wb.appPool, {
      raw: created.token,
      audience: "rest",
      now: NOW,
    });
    expect(resolved).toEqual({ kind: "rejected", reason: "no_member" });
  });

  it("names the workspace the token belongs to, not one the caller asked for", async () => {
    const wb = await workerDb();
    const created = await mint();
    // A second workspace exists. Resolution has no input but the token, so
    // there is nothing for a caller to point at the wrong tenant.
    const second = await provisionWorkspaceForUser(wb.appPool, {
      id: OTHER,
      name: "Other",
    });
    expect(second.workspaceId).not.toBe(workspaceId);

    const resolved = await resolveApiToken(wb.appPool, {
      raw: created.token,
      audience: "rest",
      now: NOW,
    });
    expect(resolved.kind).toBe("ok");
    if (resolved.kind === "ok") {
      expect(resolved.workspaceId).toBe(workspaceId);
    }
  });
});

describe("revoking", () => {
  it("keeps the row, marked, so a person can see what they turned off", async () => {
    const wb = await workerDb();
    const created = await mint();
    await callAction({ pool: wb.appPool, ...asOwner() }, "tokens.revoke", {
      id: created.id,
    });

    const listed = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "tokens.mine",
      {},
    );
    expect(listed.tokens).toHaveLength(1);
    expect(listed.tokens[0]?.revokedAt).not.toBeNull();
  });

  it("refuses a second revoke rather than reporting success twice", async () => {
    const wb = await workerDb();
    const created = await mint();
    await callAction({ pool: wb.appPool, ...asOwner() }, "tokens.revoke", {
      id: created.id,
    });
    await expect(
      callAction({ pool: wb.appPool, ...asOwner() }, "tokens.revoke", {
        id: created.id,
      }),
    ).rejects.toThrow();
  });

  it("audits the mint and the revoke", async () => {
    const wb = await workerDb();
    const created = await mint({ scopes: ["read", "write"] });
    await callAction({ pool: wb.appPool, ...asOwner() }, "tokens.revoke", {
      id: created.id,
    });

    const audited = await wb.admin.query(
      "select action, target_id, payload from audit_events where workspace_id = $1 and action like 'tokens.%' order by action",
      [workspaceId],
    );
    expect(audited.rows.map((row) => row.action)).toEqual([
      "tokens.create",
      "tokens.revoke",
    ]);
    expect((audited.rows[0].payload as Record<string, unknown>).scopes).toEqual(
      ["read", "write"],
    );
  });
});

describe("the use stamp", () => {
  it("records when a token was last used", async () => {
    const wb = await workerDb();
    const created = await mint();
    await stampTokenUse(wb.appPool, {
      workspaceId,
      tokenId: created.id,
      now: NOW,
    });

    const row = await wb.admin.query(
      "select last_used_at from api_tokens where id = $1",
      [created.id],
    );
    expect(row.rows[0].last_used_at).not.toBeNull();
  });

  it("is silent when there is nothing to stamp", async () => {
    const wb = await workerDb();
    // A token id that does not exist. A failed stamp must never fail a call
    // that was otherwise fine.
    await expect(
      stampTokenUse(wb.appPool, {
        workspaceId,
        tokenId: "7f3c1d2e-0000-4000-8000-000000000000",
        now: NOW,
      }),
    ).resolves.toBeUndefined();
  });
});
