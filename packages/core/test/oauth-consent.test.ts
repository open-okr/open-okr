import { oauthGrants, withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  type AuthoriseRequest,
  approveAuthorisationForMember,
  challengeFor,
  checkAuthoriseRequestFor,
  redeemCodeForTokens,
  redirectWith,
  resolveAccessToken,
  scopesFrom,
} from "../src/index.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The consent screen and the connections list (screen S-40, P5-T08c).
 *
 * The acceptance criterion is the last test: a user whose refresh token was
 * replayed opens their connections list, sees the grant revoked, sees why, and
 * no token in the lineage works.
 */

const OWNER = "consent-owner";
const OTHER = "consent-other";
const ISSUER = "https://okr.example";
/**
 * What a grant is bound to: the protected resource, not the instance root.
 * RFC 9728 names the agent endpoint, so that is what a client sends back and
 * what every token is checked against.
 */
const RESOURCE = `${ISSUER}/api/mcp`;
const REDIRECT = "http://127.0.0.1:7777/callback";
const VERIFIER = "a".repeat(64);

let workspaceId: string;
let memberId: string;

const request = (over: Partial<AuthoriseRequest> = {}): AuthoriseRequest => ({
  clientId: "openokr-cli",
  redirectUri: REDIRECT,
  responseType: "code",
  codeChallenge: challengeFor(VERIFIER),
  codeChallengeMethod: "S256",
  scope: "read write",
  state: "client-state-123",
  resource: "",
  ...over,
});

const check = async (over: Partial<AuthoriseRequest> = {}) => {
  const wb = await workerDb();
  return checkAuthoriseRequestFor(wb.appPool, {
    workspaceId,
    request: request(over),
    issuer: ISSUER,
  });
};

const approve = async (over: Partial<AuthoriseRequest> = {}) => {
  const wb = await workerDb();
  const asked = request(over);
  return approveAuthorisationForMember(wb.appPool, {
    workspaceId,
    userId: OWNER,
    clientId: asked.clientId,
    redirectUri: asked.redirectUri,
    challenge: asked.codeChallenge,
    challengeMethod: asked.codeChallengeMethod,
    scope: asked.scope,
    resource: asked.resource,
    issuer: ISSUER,
    now: new Date(),
  });
};

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const connections = async (userId = OWNER) => {
  const wb = await workerDb();
  return (
    await callAction(
      { pool: wb.appPool, ...context(userId) },
      "connections.mine",
      {},
    )
  ).connections;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Ada",
      "consent-owner@example.com",
      OTHER,
      "Bo",
      "consent-other@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  memberId = provisioned.memberId;

  await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Bo', 'active')`,
    [workspaceId, OTHER],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("what a person is shown, and what they are not", () => {
  it("names the client and the scopes it asked for", async () => {
    const outcome = await check();
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") {
      return;
    }
    expect(outcome.clientName).toBe("The OpenOKR command line");
    expect(outcome.scopes).toEqual(["read", "write"]);
  });

  it("shows an unknown client to the person rather than redirecting", async () => {
    // Bouncing this to the address would hand the error, and the request's
    // state, to whoever supplied that address.
    const outcome = await check({ clientId: "not-a-client" });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.refusal.kind).toBe("show");
    }
  });

  it("shows an unregistered address to the person, for the same reason", async () => {
    const outcome = await check({
      redirectUri: "https://attacker.test/callback",
    });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.refusal.kind).toBe("show");
    }
  });

  it("sends a protocol error back to the client, once the address is its own", async () => {
    for (const over of [
      { responseType: "token" },
      { codeChallenge: "" },
      { codeChallengeMethod: "plain" },
      { resource: "https://elsewhere.example" },
    ]) {
      const outcome = await check(over);
      expect(outcome.kind, JSON.stringify(over)).toBe("refused");
      if (outcome.kind === "refused") {
        expect(outcome.refusal.kind, JSON.stringify(over)).toBe("redirect");
      }
    }
  });

  it("requires a challenge, because every client here is public", async () => {
    const outcome = await check({ codeChallenge: "" });
    if (outcome.kind !== "refused" || outcome.refusal.kind !== "redirect") {
      throw new Error("expected a redirect refusal");
    }
    expect(outcome.refusal.description).toContain("code_challenge");
  });
});

describe("which scopes are granted", () => {
  it("grants what was asked for, and never more", () => {
    expect(scopesFrom("read write")).toEqual(["read", "write"]);
    expect(scopesFrom("read")).toEqual(["read"]);
  });

  it("drops a scope this server does not issue rather than refusing", () => {
    // RFC 6749 §3.3 allows issuing less than was asked for, and a client asking
    // for something unknown is usually one written against a newer version.
    expect(scopesFrom("read admin-everything")).toEqual(["read"]);
  });

  it("falls back to read when nothing usable was asked for", () => {
    expect(scopesFrom("")).toEqual(["read"]);
    expect(scopesFrom("nonsense")).toEqual(["read"]);
  });
});

describe("approving", () => {
  it("records the grant and hands back a code that redeems", async () => {
    const outcome = await approve();
    expect(outcome.kind).toBe("issued");
    if (outcome.kind !== "issued") {
      return;
    }

    const wb = await workerDb();
    const tokens = await redeemCodeForTokens(wb.appPool, {
      code: outcome.code,
      verifier: VERIFIER,
      redirectUri: REDIRECT,
      resource: RESOURCE,
      now: new Date(),
    });
    expect(tokens.kind).toBe("issued");
  });

  it("validates the whole request again, not just what the form said", async () => {
    // The screen validated it to decide what to show; this validates it to
    // decide what to grant, and the two are a page load apart with a browser
    // in between.
    const outcome = await approve({
      redirectUri: "https://attacker.test/callback",
    });
    expect(outcome.kind).toBe("refused");

    const wb = await workerDb();
    const grants = await withWorkspace(
      drizzle(wb.appPool),
      workspaceId,
      async (tx) =>
        tx
          .select()
          .from(oauthGrants)
          .where(eq(oauthGrants.workspaceId, workspaceId)),
    );
    expect(grants).toHaveLength(0);
  });

  it("binds the grant to this instance whatever the request said", async () => {
    const outcome = await approve();
    if (outcome.kind !== "issued") {
      throw new Error("expected a code");
    }
    const wb = await workerDb();
    const [grant] = await withWorkspace(
      drizzle(wb.appPool),
      workspaceId,
      async (tx) =>
        tx
          .select()
          .from(oauthGrants)
          .where(eq(oauthGrants.workspaceId, workspaceId)),
    );
    // The protected resource, which is what the metadata names.
    expect(grant?.resource).toBe(RESOURCE);
  });

  it("refuses somebody who is not an active member of that workspace", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberId],
    );
    const outcome = await approve();
    expect(outcome.kind).toBe("refused");
  });
});

describe("the redirect a browser is sent to", () => {
  it("carries the code and echoes the state exactly", () => {
    const url = redirectWith(REDIRECT, {
      code: "okr_code_abc",
      state: "client-state-123",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("code")).toBe("okr_code_abc");
    // The client's own value, never interpreted: its whole purpose is that the
    // client recognises it.
    expect(parsed.searchParams.get("state")).toBe("client-state-123");
  });

  it("keeps a query the address already had", () => {
    const url = redirectWith("https://agent.example/cb?session=7", {
      code: "okr_code_abc",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("session")).toBe("7");
    expect(parsed.searchParams.get("code")).toBe("okr_code_abc");
  });

  it("omits an empty value rather than sending a blank parameter", () => {
    const url = redirectWith(REDIRECT, { code: "okr_code_abc", state: "" });
    expect(new URL(url).searchParams.has("state")).toBe(false);
  });
});

describe("the connections list", () => {
  it("shows what this person connected, and nothing anybody else did", async () => {
    await approve();

    const mine = await connections();
    expect(mine).toHaveLength(1);
    expect(mine[0]?.clientName).toBe("The OpenOKR command line");
    expect(mine[0]?.scopes).toEqual(["read", "write"]);
    expect(mine[0]?.revokedAt).toBeNull();

    // A screen that could show somebody else's would be a screen somebody
    // could aim at a colleague.
    expect(await connections(OTHER)).toHaveLength(0);
  });

  it("revoking stops the next call, and the row stays with its reason", async () => {
    const outcome = await approve();
    if (outcome.kind !== "issued") {
      throw new Error("expected a code");
    }
    const wb = await workerDb();
    const tokens = await redeemCodeForTokens(wb.appPool, {
      code: outcome.code,
      verifier: VERIFIER,
      redirectUri: REDIRECT,
      resource: RESOURCE,
      now: new Date(),
    });
    if (tokens.kind !== "issued") {
      throw new Error("expected tokens");
    }

    const [connection] = await connections();
    await callAction({ pool: wb.appPool, ...context() }, "connections.revoke", {
      id: connection?.id as string,
    });

    const after = await connections();
    // Kept, marked, with the reason: quietly removing the row would remove the
    // only notice there is.
    expect(after).toHaveLength(1);
    expect(after[0]?.revokedAt).not.toBeNull();
    expect(after[0]?.revokedReason).toContain("You ended this connection");

    expect(
      await resolveAccessToken(wb.appPool, {
        raw: tokens.tokens.accessToken,
        resource: RESOURCE,
        now: new Date(),
      }),
    ).toEqual({ kind: "rejected", reason: "revoked" });
  });

  it("refuses to revoke somebody else's, as not-found", async () => {
    await approve();
    const [connection] = await connections();
    const wb = await workerDb();

    // Not-found rather than forbidden, so a probe learns nothing about which
    // identifiers exist.
    await expect(
      callAction(
        { pool: wb.appPool, ...context(OTHER) },
        "connections.revoke",
        {
          id: connection?.id as string,
        },
      ),
    ).rejects.toThrow(/No such connection/);
  });

  it("acceptance: a replayed refresh token shows as revoked, and says why", async () => {
    const outcome = await approve();
    if (outcome.kind !== "issued") {
      throw new Error("expected a code");
    }
    const wb = await workerDb();
    const first = await redeemCodeForTokens(wb.appPool, {
      code: outcome.code,
      verifier: VERIFIER,
      redirectUri: REDIRECT,
      resource: RESOURCE,
      now: new Date(),
    });
    if (first.kind !== "issued") {
      throw new Error("expected tokens");
    }

    const { refreshForTokens } = await import("../src/index.ts");
    const second = await refreshForTokens(wb.appPool, {
      refreshToken: first.tokens.refreshToken,
      resource: RESOURCE,
      now: new Date(),
    });
    if (second.kind !== "issued") {
      throw new Error("expected a rotation");
    }

    // The copy somebody else kept.
    await refreshForTokens(wb.appPool, {
      refreshToken: first.tokens.refreshToken,
      resource: RESOURCE,
      now: new Date(),
    });

    const after = await connections();
    expect(after[0]?.revokedAt).not.toBeNull();
    expect(after[0]?.revokedReason).toContain("presented twice");

    // And no token in the lineage works, the newest included.
    expect(
      (
        await refreshForTokens(wb.appPool, {
          refreshToken: second.tokens.refreshToken,
          resource: RESOURCE,
          now: new Date(),
        })
      ).kind,
    ).toBe("refused");
    expect(
      (
        await resolveAccessToken(wb.appPool, {
          raw: second.tokens.accessToken,
          resource: RESOURCE,
          now: new Date(),
        })
      ).kind,
    ).toBe("rejected");
  });
});
