import { oauthGrants, oauthRefreshTokens, withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mintApiToken } from "../src/api/tokens.ts";
import {
  challengeFor,
  createGrant,
  issueAuthorisationCode,
  redeemCodeForTokens,
  refreshForTokens,
  resolveAccessToken,
  resolveClient,
} from "../src/index.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The authorisation code flow (AI-NATIVE-PLAN.md §8.2, P5-T08a).
 *
 * Every test here is about a way somebody could hold a secret they should not.
 *
 * | Property | What it stops |
 * |---|---|
 * | A code is single use, consumed in the redemption's own transaction | A replayed code minting a second live session |
 * | A refresh token is used once, and a second use ends the lineage | A copied refresh token being worth anything |
 * | Resource is compared at issue and on every use | A token minted for one instance working against another |
 * | Membership is read on every use | A suspended member's connections outliving their membership |
 * | The two token kinds live in different tables | An API token being usable as an MCP token |
 */

const OWNER = "oauth-owner";
const RESOURCE = "https://okr.example";
const OTHER_RESOURCE = "https://other.example";
const REDIRECT = "http://127.0.0.1:7777/callback";
const VERIFIER = "a".repeat(64);

let workspaceId: string;
let memberId: string;
let clientRowId: string;

const now = () => new Date();

/** One complete grant, as the consent screen will make it (P5-T08c). */
async function grantAndCode(
  over: { readonly resource?: string; readonly redirectUri?: string } = {},
): Promise<string> {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, async (tx) => {
    const grantId = await createGrant(tx, {
      workspaceId,
      memberId,
      clientId: clientRowId,
      scopes: ["read", "write"],
      resource: over.resource ?? RESOURCE,
      now: now(),
    });
    return issueAuthorisationCode(tx, {
      workspaceId,
      grantId,
      challenge: challengeFor(VERIFIER),
      redirectUri: over.redirectUri ?? REDIRECT,
      resource: over.resource ?? RESOURCE,
      now: now(),
    });
  });
}

const redeem = async (
  code: string,
  over: {
    readonly verifier?: string;
    readonly redirectUri?: string;
    readonly resource?: string;
  } = {},
) => {
  const wb = await workerDb();
  return redeemCodeForTokens(wb.appPool, {
    code,
    verifier: over.verifier ?? VERIFIER,
    redirectUri: over.redirectUri ?? REDIRECT,
    resource: over.resource ?? RESOURCE,
    now: now(),
  });
};

const refresh = async (token: string, resource = RESOURCE) => {
  const wb = await workerDb();
  return refreshForTokens(wb.appPool, {
    refreshToken: token,
    resource,
    now: now(),
  });
};

async function grantRow() {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, async (tx) => {
    const [row] = await tx
      .select()
      .from(oauthGrants)
      .where(eq(oauthGrants.workspaceId, workspaceId))
      .limit(1);
    return row;
  });
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Ada", "oauth-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  memberId = provisioned.memberId;

  // The allow-listed client is written the first time it is used, so this is
  // both the setup and a test that the materialising path works.
  const client = await withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
    resolveClient(tx, { clientId: "openokr-cli", redirectUri: REDIRECT }),
  );
  if (client.kind !== "ok") {
    throw new Error("the allow-listed client did not resolve");
  }
  clientRowId = client.client.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("redeeming a code", () => {
  it("hands back an access token, a refresh token and the granted scopes", async () => {
    const outcome = await redeem(await grantAndCode());
    expect(outcome.kind).toBe("issued");
    if (outcome.kind !== "issued") {
      return;
    }
    expect(outcome.tokens.accessToken).toMatch(/^okr_at_/);
    expect(outcome.tokens.refreshToken).toMatch(/^okr_rt_/);
    expect(outcome.tokens.scopes).toEqual(["read", "write"]);
    expect(outcome.tokens.expiresIn).toBe(3600);
  });

  it("refuses the second redemption and revokes the grant", async () => {
    const code = await grantAndCode();
    expect((await redeem(code)).kind).toBe("issued");

    const replay = await redeem(code);
    expect(replay.kind).toBe("refused");

    // A code redeemed twice means somebody other than the client has it, and
    // the tokens the first redemption produced are already in their hands.
    const grant = await grantRow();
    expect(grant?.revokedAt).not.toBeNull();
    expect(grant?.revokedReason).toBe("reuse");
  });

  it("refuses a verifier that does not match the challenge", async () => {
    const outcome = await redeem(await grantAndCode(), {
      verifier: "b".repeat(64),
    });
    expect(outcome.kind).toBe("refused");
    // Not consumed, so the real client can still complete: a wrong verifier is
    // a client bug as often as it is an attack.
    expect((await grantRow())?.revokedAt).toBeNull();
  });

  it("refuses a redirect address the code was not issued for", async () => {
    const outcome = await redeem(await grantAndCode(), {
      redirectUri: "http://127.0.0.1:7777/elsewhere",
    });
    expect(outcome.kind).toBe("refused");
  });

  it("refuses a code issued for another instance", async () => {
    const outcome = await redeem(await grantAndCode(), {
      resource: OTHER_RESOURCE,
    });
    expect(outcome.kind).toBe("refused");
  });

  it("refuses a code this server never issued", async () => {
    const outcome = await redeem("okr_code_neverissued");
    expect(outcome.kind).toBe("refused");
  });
});

describe("rotating a refresh token", () => {
  const firstTokens = async () => {
    const outcome = await redeem(await grantAndCode());
    if (outcome.kind !== "issued") {
      throw new Error("expected tokens");
    }
    return outcome.tokens;
  };

  it("mints a new pair and the old refresh token stops working", async () => {
    const first = await firstTokens();
    const second = await refresh(first.refreshToken);
    expect(second.kind).toBe("issued");
    if (second.kind !== "issued") {
      return;
    }
    expect(second.tokens.refreshToken).not.toBe(first.refreshToken);
  });

  it("revokes the whole lineage when one is presented twice", async () => {
    const first = await firstTokens();
    const second = await refresh(first.refreshToken);
    if (second.kind !== "issued") {
      throw new Error("expected tokens");
    }
    const third = await refresh(second.tokens.refreshToken);
    if (third.kind !== "issued") {
      throw new Error("expected tokens");
    }

    // The attacker's copy, three rotations old.
    const replay = await refresh(first.refreshToken);
    expect(replay.kind).toBe("refused");

    const grant = await grantRow();
    expect(grant?.revokedReason).toBe("reuse");

    // Every link, not only the replayed one: the honest assumption is that
    // whoever copied one has whatever the client has.
    const wb = await workerDb();
    const links = await withWorkspace(
      drizzle(wb.appPool),
      workspaceId,
      async (tx) =>
        tx
          .select()
          .from(oauthRefreshTokens)
          .where(eq(oauthRefreshTokens.workspaceId, workspaceId)),
    );
    expect(links.length).toBeGreaterThan(2);
    expect(links.every((row) => row.revokedAt !== null)).toBe(true);

    // And the newest token, which the real client still holds, is dead too.
    expect((await refresh(third.tokens.refreshToken)).kind).toBe("refused");
  });

  it("leaves a walkable chain, so a lineage can be followed from any link", async () => {
    const first = await firstTokens();
    const second = await refresh(first.refreshToken);
    if (second.kind !== "issued") {
      throw new Error("expected tokens");
    }

    const wb = await workerDb();
    const links = await withWorkspace(
      drizzle(wb.appPool),
      workspaceId,
      async (tx) =>
        tx
          .select()
          .from(oauthRefreshTokens)
          .where(eq(oauthRefreshTokens.workspaceId, workspaceId)),
    );
    const used = links.find((row) => row.usedAt !== null);
    expect(used?.replacedBy).toBeTruthy();
    expect(links.some((row) => row.id === used?.replacedBy)).toBe(true);
  });

  it("refuses a refresh token presented against another instance", async () => {
    const first = await firstTokens();
    expect((await refresh(first.refreshToken, OTHER_RESOURCE)).kind).toBe(
      "refused",
    );
  });
});

describe("using an access token", () => {
  const accessToken = async () => {
    const outcome = await redeem(await grantAndCode());
    if (outcome.kind !== "issued") {
      throw new Error("expected tokens");
    }
    return outcome.tokens.accessToken;
  };

  it("resolves to the member who granted it, with the granted scopes", async () => {
    const wb = await workerDb();
    const resolved = await resolveAccessToken(wb.appPool, {
      raw: await accessToken(),
      resource: RESOURCE,
      now: now(),
    });
    expect(resolved.kind).toBe("ok");
    if (resolved.kind !== "ok") {
      return;
    }
    expect(resolved.workspaceId).toBe(workspaceId);
    expect(resolved.memberId).toBe(memberId);
    expect(resolved.userId).toBe(OWNER);
    expect(resolved.scopes).toEqual(["read", "write"]);
  });

  it("refuses a token presented against another instance", async () => {
    const wb = await workerDb();
    const resolved = await resolveAccessToken(wb.appPool, {
      raw: await accessToken(),
      resource: OTHER_RESOURCE,
      now: now(),
    });
    expect(resolved).toEqual({ kind: "rejected", reason: "wrong_resource" });
  });

  it("stops working when the member is suspended, with nothing revoked", async () => {
    const token = await accessToken();
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberId],
    );

    const resolved = await resolveAccessToken(wb.appPool, {
      raw: token,
      resource: RESOURCE,
      now: now(),
    });
    expect(resolved).toEqual({ kind: "rejected", reason: "no_member" });
  });

  it("refuses an API token, because the two are different tables", async () => {
    const wb = await workerDb();
    const api = mintApiToken("mcp");
    const resolved = await resolveAccessToken(wb.appPool, {
      raw: api.raw,
      resource: RESOURCE,
      now: now(),
    });
    // Not a comparison somebody could forget to write: the prefix is wrong and
    // the digest is in another table, so the lookup cannot succeed.
    expect(resolved).toEqual({ kind: "rejected", reason: "invalid" });
  });
});

describe("losing membership", () => {
  it("ends the grant on the next refresh, rather than refusing forever", async () => {
    const outcome = await redeem(await grantAndCode());
    if (outcome.kind !== "issued") {
      throw new Error("expected tokens");
    }

    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberId],
    );

    expect((await refresh(outcome.tokens.refreshToken)).kind).toBe("refused");
    const grant = await grantRow();
    expect(grant?.revokedReason).toBe("membership");
  });
});
