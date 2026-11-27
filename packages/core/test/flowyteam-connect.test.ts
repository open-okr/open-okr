import { workerDb } from "@openokr/test-support/db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  FLOWYTEAM_REVOKE_TOPIC,
  type FlowyteamAnswer,
  type FlowyteamGateway,
  newConnectState,
  openConnectState,
  sealConnectState,
} from "../src/imports/flowyteam/connection.ts";
import { flowyteamQueryCatalogue } from "../src/imports/flowyteam/queries.ts";
import { OperationError } from "../src/operations/errors.ts";
import { dispatchOutbox, type OutboxDelivery } from "../src/outbox/handlers.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Connecting FlowyTeam (docs/design/flowyteam-connect.md §4.1, §4.2, §5;
 * acceptance criteria 1 and 8, plan card C3).
 *
 * The gateway is a fake here: the HTTP driver has its own test against a
 * local FlowyTeam stub in `packages/adapters`. What this file proves is the
 * state, the sealing, the tenant floor and that no token lands anywhere a
 * person can read it.
 */

const OWNER = "flowyteam-owner";
const OTHER = "flowyteam-other";
const STRANGER = "flowyteam-stranger";
const TOKEN = "ft-export-token-9f8e7d6c5b4a";
const ORIGIN = "https://okr.example.test";
const FLOWYTEAM = "https://flowyteam.example.test";

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

let workspaceId: string;
let ownerMemberId: string;
let otherWorkspaceId: string;

interface FakeGateway extends FlowyteamGateway {
  calls: string[];
  exchanged: Record<string, unknown>[];
  revoked: string[];
  companyAnswer: FlowyteamAnswer<{ companyId: string; companyName: string }>;
}

function fakeGateway(): FakeGateway {
  const gateway: FakeGateway = {
    calls: [],
    exchanged: [],
    revoked: [],
    companyAnswer: {
      ok: true,
      value: { companyId: "42", companyName: "Northwind" },
    },
    async exchangeCode(input) {
      gateway.calls.push("exchange");
      gateway.exchanged.push({ ...input });
      return {
        ok: true,
        value: { accessToken: TOKEN, scope: "flowyteam:export" },
      };
    },
    async readCompany(input) {
      gateway.calls.push(`company:${input.version}:${input.accessToken}`);
      return gateway.companyAnswer;
    },
    async revoke(input) {
      gateway.revoked.push(input.accessToken);
      return { ok: true, value: null };
    },
  };
  return gateway;
}

let gateway: FakeGateway;

const as = (userId: string, inWorkspace = () => workspaceId) => ({
  workspaceId: inWorkspace(),
  actor: { kind: "human" as const, userId },
  ring,
  baseUrl: ORIGIN,
  flowyteam: gateway,
});

async function call(userId: string, name: string, input: unknown) {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...as(userId) },
    name as never,
    input as never,
  ) as Promise<Record<string, unknown>>;
}

/** Starts a connection and answers the way FlowyTeam's redirect would. */
async function connectAs(userId: string) {
  const started = (await call(userId, "imports.flowyteamConnect", {})) as {
    authorizeUrl: string;
    stateCookie: string;
  };
  const state = new URL(started.authorizeUrl).searchParams.get("state") ?? "";
  return { started, state };
}

async function finish(stateCookie: string, state: string, userId = OWNER) {
  return call(userId, "imports.flowyteamFinishConnect", {
    code: "code-123",
    state,
    stateCookie,
  });
}

async function refusalOf(promise: Promise<unknown>): Promise<OperationError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OperationError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

async function memberIdFor(userId: string, ws: string): Promise<string> {
  const wb = await workerDb();
  const rows = await wb.admin.query(
    "select id from workspace_members where workspace_id = $1 and user_id = $2",
    [ws, userId],
  );
  return rows.rows[0].id as string;
}

async function outboxRows(): Promise<OutboxDelivery[]> {
  const wb = await workerDb();
  const rows = await wb.admin.query(
    "select topic, payload, idempotency_key, attempts from outbox order by created_at",
  );
  return rows.rows.map((row) => ({
    topic: row.topic as string,
    payload: row.payload as Record<string, unknown>,
    idempotencyKey: row.idempotency_key as string,
    attempts: row.attempts as number,
  }));
}

beforeEach(async () => {
  process.env.OPENOKR_FLOWYTEAM_URL = FLOWYTEAM;
  gateway = fakeGateway();
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Owner', 'o@example.com'), ($2, 'Other', 'x@example.com'), ($3, 'Stranger', 's@example.com')",
    [OWNER, OTHER, STRANGER],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = await memberIdFor(OWNER, workspaceId);
  // An ordinary member, without `full`.
  await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Other', 'active')`,
    [workspaceId, OTHER],
  );
  const elsewhere = await provisionWorkspaceForUser(wb.appPool, {
    id: STRANGER,
    name: "Stranger",
  });
  otherWorkspaceId = elsewhere.workspaceId;
});

afterEach(() => {
  delete process.env.OPENOKR_FLOWYTEAM_URL;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("connect", () => {
  it("answers FlowyTeam's authorize address with PKCE S256 and a sealed state", async () => {
    const { started, state } = await connectAs(OWNER);
    const url = new URL(started.authorizeUrl);
    expect(`${url.origin}${url.pathname}`).toBe(`${FLOWYTEAM}/oauth/authorize`);
    expect(url.searchParams.get("scope")).toBe("flowyteam:export");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/admin/imports/flowyteam/callback`,
    );
    // No registered client: the metadata document identifies the instance.
    expect(url.searchParams.get("client_id")).toBe(
      `${ORIGIN}/api/imports/flowyteam/client`,
    );

    const opened = openConnectState(ring, started.stateCookie, Date.now());
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.state.state).toBe(state);
      expect(opened.state.workspaceId).toBe(workspaceId);
      expect(opened.state.memberId).toBe(ownerMemberId);
      // The verifier is in the sealed cookie and nowhere in the address.
      expect(started.authorizeUrl).not.toContain(opened.state.verifier);
    }
  });

  it("refuses a member without full access", async () => {
    await expect(call(OTHER, "imports.flowyteamConnect", {})).rejects.toThrow();
  });

  it("connects to FlowyTeam's cloud when no address is set, on any instance", async () => {
    // Owner decision, 23 November 2026: empty is https://flowyteam.com for a
    // self-hosted instance too, so the connect step always shows.
    delete process.env.OPENOKR_FLOWYTEAM_URL;
    const read = await call(OWNER, "imports.flowyteamConnection", {});
    expect(read.available).toBe(true);
    const { started } = await connectAs(OWNER);
    expect(
      started.authorizeUrl.startsWith("https://flowyteam.com/oauth/authorize?"),
    ).toBe(true);
  });

  it("refuses when the address is `off`, as an air-gapped instance sets it", async () => {
    process.env.OPENOKR_FLOWYTEAM_URL = "off";
    const refusal = await refusalOf(
      call(OWNER, "imports.flowyteamConnect", {}),
    );
    expect(refusal.details?.reason).toBe("not_configured");
    const read = await call(OWNER, "imports.flowyteamConnection", {});
    expect(read).toEqual({
      available: false,
      backgroundWork: true,
      connection: null,
    });
  });
});

describe("the sealed state", () => {
  it("does not open once a byte is changed", async () => {
    const { started } = await connectAs(OWNER);
    const bytes = Buffer.from(started.stateCookie, "base64url");
    const parts = JSON.parse(bytes.toString("utf8")) as string[];
    const cipher = Buffer.from(parts[2] as string, "base64");
    cipher[cipher.length - 1] = (cipher[cipher.length - 1] ?? 0) ^ 1;
    parts[2] = cipher.toString("base64");
    const tampered = Buffer.from(JSON.stringify(parts)).toString("base64url");
    expect(openConnectState(ring, tampered, Date.now())).toEqual({
      ok: false,
      refusal: "state_invalid",
    });
    expect(openConnectState(ring, "not-a-cookie", Date.now())).toEqual({
      ok: false,
      refusal: "state_invalid",
    });
  });

  it("expires after ten minutes", async () => {
    const { started } = await connectAs(OWNER);
    expect(
      openConnectState(
        ring,
        started.stateCookie,
        Date.now() + 10 * 60 * 1000 + 1,
      ),
    ).toEqual({ ok: false, refusal: "state_expired" });
  });
});

describe("finish", () => {
  it("stores the company and a sealed token, and never a readable one", async () => {
    const { started, state } = await connectAs(OWNER);
    const view = await finish(started.stateCookie, state);
    expect(view).toMatchObject({
      companyId: "42",
      companyName: "Northwind",
      state: "connected",
      connectedByMemberId: ownerMemberId,
    });
    expect(gateway.exchanged[0]).toMatchObject({
      code: "code-123",
      redirectUri: `${ORIGIN}/admin/imports/flowyteam/callback`,
    });
    expect(gateway.exchanged[0]?.clientSecret).toBeUndefined();
    expect(gateway.calls).toContain(
      `company:${flowyteamQueryCatalogue().version}:${TOKEN}`,
    );

    const wb = await workerDb();
    const rows = await wb.admin.query(
      "select row_to_json(c)::text as json from import_connections c",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].json).not.toContain(TOKEN);
    const audit = await wb.admin.query(
      "select action, payload::text as payload from audit_events where action like 'imports.flowyteam%'",
    );
    expect(audit.rows.map((row) => row.action).sort()).toEqual([
      "imports.flowyteamConnect",
      "imports.flowyteamFinishConnect",
    ]);
    for (const row of audit.rows) {
      expect(row.payload).not.toContain(TOKEN);
    }
    const finished = audit.rows.find(
      (row) => row.action === "imports.flowyteamFinishConnect",
    );
    expect(finished?.payload).toContain('"companyId": "42"');
    const outbox = await wb.admin.query(
      "select payload::text as p from outbox",
    );
    for (const row of outbox.rows) {
      expect(row.p).not.toContain(TOKEN);
    }

    const read = await call(OWNER, "imports.flowyteamConnection", {});
    expect(read.available).toBe(true);
    expect(read.connection).toMatchObject({
      companyName: "Northwind",
      state: "connected",
    });
    expect(JSON.stringify(read)).not.toContain(TOKEN);
  });

  it("refuses a state FlowyTeam did not return, before spending the code", async () => {
    const { started } = await connectAs(OWNER);
    const refusal = await refusalOf(
      finish(started.stateCookie, "forged-state"),
    );
    expect(refusal.details?.reason).toBe("state_mismatch");
    expect(gateway.calls).toEqual([]);
  });

  it("refuses an expired or missing state", async () => {
    const { state } = newConnectState({
      workspaceId,
      memberId: ownerMemberId,
      baseUrl: FLOWYTEAM,
      clientId: "client",
      redirectUri: `${ORIGIN}/admin/imports/flowyteam/callback`,
      now: Date.now() - 11 * 60 * 1000,
    });
    const expired = await refusalOf(
      finish(sealConnectState(ring, state), state.state),
    );
    expect(expired.details?.reason).toBe("state_expired");
    const missing = await refusalOf(finish("-", "x"));
    expect(missing.details?.reason).toBe("state_invalid");
    expect(gateway.calls).toEqual([]);
  });

  it("refuses a state started by somebody else", async () => {
    const otherMember = await memberIdFor(OTHER, workspaceId);
    const { state } = newConnectState({
      workspaceId,
      memberId: otherMember,
      baseUrl: FLOWYTEAM,
      clientId: "client",
      redirectUri: `${ORIGIN}/admin/imports/flowyteam/callback`,
      now: Date.now(),
    });
    const refusal = await refusalOf(
      finish(sealConnectState(ring, state), state.state),
    );
    expect(refusal.details?.reason).toBe("state_other_member");
    expect(gateway.calls).toEqual([]);
  });

  it("says FlowyTeam needs an update when the catalogue versions differ", async () => {
    gateway.companyAnswer = {
      ok: false,
      failure: "version_mismatch",
      status: 409,
      detail: "409",
    };
    const { started, state } = await connectAs(OWNER);
    const refusal = await refusalOf(finish(started.stateCookie, state));
    expect(refusal.code).toBe("conflict");
    expect(refusal.message).toBe(
      "FlowyTeam needs an update before this import.",
    );
    const wb = await workerDb();
    const rows = await wb.admin.query("select id from import_connections");
    expect(rows.rows).toHaveLength(0);
  });

  it("replaces an earlier connection and revokes its token", async () => {
    const first = await connectAs(OWNER);
    await finish(first.started.stateCookie, first.state);
    const second = await connectAs(OWNER);
    await finish(second.started.stateCookie, second.state);

    const wb = await workerDb();
    const rows = await wb.admin.query(
      "select deleted_at is null as live from import_connections order by created_at",
    );
    expect(rows.rows.map((row) => row.live)).toEqual([false, true]);
    const revokes = (await outboxRows()).filter(
      (row) => row.topic === FLOWYTEAM_REVOKE_TOPIC,
    );
    expect(revokes).toHaveLength(1);
  });
});

describe("disconnect", () => {
  it("closes the connection, revokes the token at FlowyTeam and clears it", async () => {
    const { started, state } = await connectAs(OWNER);
    await finish(started.stateCookie, state);
    await expect(
      call(OTHER, "imports.flowyteamDisconnect", {}),
    ).rejects.toThrow();

    const result = await call(OWNER, "imports.flowyteamDisconnect", {});
    expect(result).toEqual({ companyId: "42" });
    expect(await call(OWNER, "imports.flowyteamConnection", {})).toEqual({
      available: true,
      backgroundWork: true,
      connection: null,
    });

    const jobs = (await outboxRows()).filter(
      (row) => row.topic === FLOWYTEAM_REVOKE_TOPIC,
    );
    expect(jobs).toHaveLength(1);
    const wb = await workerDb();
    await dispatchOutbox(jobs[0] as OutboxDelivery, {
      pool: wb.appPool,
      ring,
      revokeFlowyteam: gateway.revoke,
    });
    expect(gateway.revoked).toEqual([TOKEN]);
    const rows = await wb.admin.query(
      "select token_ciphertext, revoked_at, deleted_at from import_connections",
    );
    expect(rows.rows[0]).toMatchObject({ token_ciphertext: null });
    expect(rows.rows[0].revoked_at).not.toBeNull();
    expect(rows.rows[0].deleted_at).not.toBeNull();

    const audit = await wb.admin.query(
      "select payload::text as payload from audit_events where action = 'imports.flowyteamDisconnect'",
    );
    expect(audit.rows[0].payload).toContain('"companyId": "42"');
  });

  it("is not found when nothing is connected", async () => {
    const refusal = await refusalOf(
      call(OWNER, "imports.flowyteamDisconnect", {}),
    );
    expect(refusal.code).toBe("not_found");
  });

  it("retries a revocation FlowyTeam did not answer, and keeps the token until it does", async () => {
    const { started, state } = await connectAs(OWNER);
    await finish(started.stateCookie, state);
    await call(OWNER, "imports.flowyteamDisconnect", {});
    const job = (await outboxRows()).find(
      (row) => row.topic === FLOWYTEAM_REVOKE_TOPIC,
    ) as OutboxDelivery;
    const wb = await workerDb();
    await expect(
      dispatchOutbox(job, {
        pool: wb.appPool,
        ring,
        revokeFlowyteam: async () => ({
          ok: false,
          failure: "unreachable",
          detail: "timed out",
        }),
      }),
    ).rejects.toThrow("timed out");
    const rows = await wb.admin.query(
      "select token_ciphertext from import_connections",
    );
    expect(rows.rows[0].token_ciphertext).not.toBeNull();
  });
});

describe("the tenant floor", () => {
  it("hides one workspace's connection from another", async () => {
    const { started, state } = await connectAs(OWNER);
    await finish(started.stateCookie, state);

    const wb = await workerDb();
    const read = await callAction(
      { pool: wb.appPool, ...as(STRANGER, () => otherWorkspaceId) },
      "imports.flowyteamConnection",
      {},
    );
    expect(read.connection).toBeNull();

    const client = await wb.appPool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.workspace_id', $1, true)", [
        otherWorkspaceId,
      ]);
      const seen = await client.query("select id from import_connections");
      expect(seen.rows).toHaveLength(0);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  it("refuses a state started in another workspace", async () => {
    const { started, state } = await connectAs(OWNER);
    const wb = await workerDb();
    const refusal = await refusalOf(
      callAction(
        { pool: wb.appPool, ...as(STRANGER, () => otherWorkspaceId) },
        "imports.flowyteamFinishConnect",
        { code: "c", state, stateCookie: started.stateCookie },
      ),
    );
    expect(refusal.details?.reason).toBe("state_other_workspace");
    expect(gateway.calls).toEqual([]);
  });
});
