import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  type AgentPrincipal,
  agentRateKey,
  approveAuthorisationForMember,
  challengeFor,
  dispatchTool,
  redeemCodeForTokens,
  resolveAgentPrincipal,
  resolveApiToken,
  startDeviceAuthorisation,
} from "../src/index.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The agent endpoint's two ways in (AI-NATIVE-PLAN.md §8.1, completeness review
 * M-12).
 *
 * | Property | What it stops |
 * |---|---|
 * | An agent token resolves to its member, narrowed by its own scopes | A local agent having no way in that does not need a browser |
 * | A REST token is refused here, and an agent token at REST | The weakest handling of either token becoming the security of both |
 * | A revoked or expired agent token, or a suspended member, is refused | A token outliving the decision to end it |
 * | The same scope gate runs for a token as for a grant | An agent token being a wider door than the consent screen |
 * | No token, grant or chat link can mint, revoke or approve a terminal | A write-scoped token handing itself destructive scope |
 * | A grant still resolves as a grant | The new path quietly replacing the old one |
 */

const OWNER = "principal-owner";
const ISSUER = "https://okr.example";
const RESOURCE = `${ISSUER}/api/mcp`;
const REDIRECT = "http://127.0.0.1:7777/callback";
const VERIFIER = "a".repeat(64);

let workspaceId: string;
let memberId: string;

const now = () => new Date();

const asOwner = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

const mint = async (
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; token: string }> => {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...asOwner() }, "tokens.create", {
    name: "Coding agent",
    audience: "mcp",
    scopes: ["read"],
    expiresInDays: null,
    ...overrides,
  });
};

const resolve = async (raw: string): Promise<AgentPrincipal> => {
  const wb = await workerDb();
  return resolveAgentPrincipal(wb.appPool, {
    raw,
    resource: RESOURCE,
    now: now(),
  });
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Ada", "principal-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
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

describe("an agent token", () => {
  it("resolves to the member who minted it, with the scopes it was given", async () => {
    const created = await mint({ scopes: ["read", "write"] });

    const principal = await resolve(created.token);
    expect(principal).toEqual({
      kind: "ok",
      via: "token",
      tokenId: created.id,
      workspaceId,
      memberId,
      userId: OWNER,
      scopes: ["read", "write"],
    });
  });

  it("is stamped as used, so the tokens screen can say it is still in use", async () => {
    const created = await mint();
    await resolve(created.token);

    const wb = await workerDb();
    const row = await wb.admin.query(
      "select last_used_at from api_tokens where id = $1",
      [created.id],
    );
    expect(row.rows[0].last_used_at).not.toBeNull();
  });

  it("is counted under its own key, apart from any grant", async () => {
    const created = await mint();
    const principal = await resolve(created.token);
    if (principal.kind !== "ok") {
      throw new Error("expected a principal");
    }
    expect(agentRateKey(principal)).toBe(`mcp:token:${created.id}`);
  });
});

describe("the audiences stay apart", () => {
  it("refuses a REST token at the agent endpoint", async () => {
    const rest = await mint({ name: "Deploy script", audience: "rest" });
    expect(await resolve(rest.token)).toEqual({
      kind: "rejected",
      reason: "wrong_audience",
    });
  });

  it("and the REST surface still refuses an agent token", async () => {
    const agent = await mint();
    const wb = await workerDb();
    const resolved = await resolveApiToken(wb.appPool, {
      raw: agent.token,
      audience: "rest",
      now: now(),
    });
    expect(resolved).toEqual({ kind: "rejected", reason: "wrong_audience" });
  });

  it("refuses an agent token nobody minted", async () => {
    expect(await resolve(`okr_mcp_${"a".repeat(43)}`)).toEqual({
      kind: "rejected",
      reason: "invalid",
    });
  });
});

describe("an agent token that should no longer work", () => {
  it("is refused once revoked", async () => {
    const created = await mint();
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...asOwner() }, "tokens.revoke", {
      id: created.id,
    });
    expect(await resolve(created.token)).toEqual({
      kind: "rejected",
      reason: "revoked",
    });
  });

  it("is refused once expired", async () => {
    const created = await mint({ expiresInDays: 1 });
    const wb = await workerDb();
    await wb.admin.query(
      "update api_tokens set expires_at = now() - interval '1 minute' where id = $1",
      [created.id],
    );
    expect(await resolve(created.token)).toEqual({
      kind: "rejected",
      reason: "expired",
    });
  });

  it("is refused once its member is suspended", async () => {
    const created = await mint();
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberId],
    );
    expect(await resolve(created.token)).toEqual({
      kind: "rejected",
      reason: "no_member",
    });
  });
});

describe("the same scope gate as a grant", () => {
  it("lets a read-only agent token run a read", async () => {
    const principal = await resolve((await mint()).token);
    if (principal.kind !== "ok") {
      throw new Error("expected a principal");
    }
    const wb = await workerDb();
    const outcome = await dispatchTool(
      wb.appPool,
      principal,
      "cycles.list",
      {},
    );
    expect(outcome.isError).toBe(false);
  });

  it("refuses a write tool to a read-only agent token, naming the scope", async () => {
    const principal = await resolve((await mint()).token);
    if (principal.kind !== "ok") {
      throw new Error("expected a principal");
    }
    const wb = await workerDb();
    const outcome = await dispatchTool(wb.appPool, principal, "goals.create", {
      title: "Never written",
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("goals.create needs write");

    const goals = await wb.admin.query(
      "select count(*)::int as count from goals where workspace_id = $1",
      [workspaceId],
    );
    expect(goals.rows[0].count).toBe(0);
  });

  it("refuses a destructive tool to a write agent token", async () => {
    const principal = await resolve(
      (await mint({ scopes: ["read", "write"] })).token,
    );
    if (principal.kind !== "ok") {
      throw new Error("expected a principal");
    }
    const wb = await workerDb();
    const outcome = await dispatchTool(wb.appPool, principal, "goals.delete", {
      id: "00000000-0000-4000-8000-000000000000",
    });
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("needs destructive");
  });
});

describe("a token cannot administer tokens", () => {
  const tokenCount = async (): Promise<number> => {
    const wb = await workerDb();
    const counted = await wb.admin.query(
      "select count(*)::int as count from api_tokens where workspace_id = $1",
      [workspaceId],
    );
    return counted.rows[0].count as number;
  };

  it("refuses a write-scoped agent token that asks for a destructive one", async () => {
    const principal = await resolve(
      (await mint({ scopes: ["read", "write"] })).token,
    );
    if (principal.kind !== "ok") {
      throw new Error("expected a principal");
    }
    const before = await tokenCount();

    const wb = await workerDb();
    const outcome = await dispatchTool(wb.appPool, principal, "tokens.create", {
      name: "Wider",
      audience: "mcp",
      scopes: ["read", "write", "destructive"],
    });

    expect(outcome.isError).toBe(true);
    expect(outcome.text).toContain("tokens screen");
    expect(await tokenCount()).toBe(before);
  });

  it.each(["api", "mcp", "slack"])(
    "refuses to mint through the %s surface",
    async (channel) => {
      const wb = await workerDb();
      await expect(
        callAction(
          { pool: wb.appPool, ...asOwner(), channel },
          "tokens.create",
          {
            name: "Through a token",
            audience: "rest",
            scopes: ["read", "write", "destructive"],
            expiresInDays: null,
          },
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(await tokenCount()).toBe(0);
    },
  );

  it("refuses to approve a terminal through a token", async () => {
    const wb = await workerDb();
    const started = await startDeviceAuthorisation(wb.appPool, {
      clientName: "okr on a laptop",
      scopes: ["read", "write", "destructive"],
      baseUrl: `${ISSUER}/`,
      now: now(),
    });

    await expect(
      callAction(
        { pool: wb.appPool, ...asOwner(), channel: "api" },
        "tokens.approveDevice",
        { userCode: started.userCode, approve: true },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });

    const pending = await wb.admin.query(
      "select approved_at from device_authorisations",
    );
    expect(pending.rows[0].approved_at).toBeNull();
  });

  it("refuses to revoke through a token, even one with destructive scope", async () => {
    const kept = await mint({ name: "Still in use" });
    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, ...asOwner(), channel: "mcp" },
        "tokens.revoke",
        { id: kept.id },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });

    const row = await wb.admin.query(
      "select revoked_at from api_tokens where id = $1",
      [kept.id],
    );
    expect(row.rows[0].revoked_at).toBeNull();
  });

  it("still mints in the browser, which names no channel", async () => {
    await mint({ scopes: ["read", "write", "destructive"] });
    expect(await tokenCount()).toBe(1);
  });
});

describe("a grant", () => {
  it("still resolves as a grant, counted under the grant", async () => {
    const wb = await workerDb();
    const approved = await approveAuthorisationForMember(wb.appPool, {
      workspaceId,
      userId: OWNER,
      clientId: "openokr-cli",
      redirectUri: REDIRECT,
      challenge: challengeFor(VERIFIER),
      challengeMethod: "S256",
      scope: "read",
      resource: "",
      issuer: ISSUER,
      now: now(),
    });
    if (approved.kind !== "issued") {
      throw new Error("expected a code");
    }
    const tokens = await redeemCodeForTokens(wb.appPool, {
      code: approved.code,
      verifier: VERIFIER,
      redirectUri: REDIRECT,
      resource: RESOURCE,
      now: now(),
    });
    if (tokens.kind !== "issued") {
      throw new Error("expected tokens");
    }

    const principal = await resolve(tokens.tokens.accessToken);
    expect(principal).toMatchObject({
      kind: "ok",
      via: "grant",
      grantId: approved.grantId,
      workspaceId,
      memberId,
      userId: OWNER,
      scopes: ["read"],
    });
    if (principal.kind !== "ok") {
      throw new Error("expected a principal");
    }
    expect(agentRateKey(principal)).toBe(`mcp:grant:${approved.grantId}`);
  });

  it("refuses an access token nobody issued", async () => {
    expect(await resolve("okr_at_invented")).toEqual({
      kind: "rejected",
      reason: "invalid",
    });
  });
});
