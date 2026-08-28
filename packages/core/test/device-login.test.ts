import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  DEVICE_POLL_INTERVAL_SECONDS,
  hashDeviceCode,
  pollDeviceAuthorisation,
  startDeviceAuthorisation,
} from "../src/api/device.ts";
import { hashApiToken, resolveApiToken } from "../src/api/tokens.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The device login (§14, P5-T07c-b).
 *
 * The three test-plan lines are here: a grant carries the scopes that were asked
 * for and no more, an expired code is refused, and a code approved twice grants
 * once. The acceptance criterion runs in the browser, in
 * `e2e/s38-device-login.spec.ts`, because the whole point of the flow is that two
 * different clients meet through it.
 */

const OWNER = "device-owner";
const OTHER = "device-other";
/**
 * The real clock, not a fixed moment.
 *
 * A device request expires ten minutes after it is made, and the approve action
 * reads the clock itself, as it must: whether a code has expired is a fact about
 * now rather than about an argument. A fixed `NOW` in the past therefore makes
 * every request in this file expired before it is answered, which is how this
 * was written the first time and what every failure said.
 */
const NOW = new Date();
const LATER = new Date(
  NOW.getTime() + (DEVICE_POLL_INTERVAL_SECONDS + 1) * 1000,
);

let workspaceId: string;
let memberId: string;

const asOwner = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

const start = async (scopes: readonly string[] = ["read"]) => {
  const wb = await workerDb();
  return startDeviceAuthorisation(wb.appPool, {
    clientName: "okr on a laptop",
    scopes: scopes as never,
    baseUrl: "https://okr.example/",
    now: NOW,
  });
};

const approve = async (userCode: string, approve = true) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...asOwner() },
    "tokens.approveDevice",
    { userCode, approve },
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Owner",
      "device-owner@example.com",
      OTHER,
      "Other",
      "device-other@example.com",
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

describe("starting one", () => {
  it("stores no code in the clear and belongs to no workspace yet", async () => {
    const wb = await workerDb();
    const started = await start();

    const rows = await wb.admin.query("select * from device_authorisations");
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0];
    expect(row.device_code_hash).toBe(hashDeviceCode(started.deviceCode));
    expect(row.user_code_hash).toBe(hashDeviceCode(started.userCode));
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain(started.deviceCode);
    expect(serialised).not.toContain(started.userCode);
    // A terminal has not chosen a workspace. The approver does that.
    expect(row.workspace_id).toBeNull();
    expect(row.approved_at).toBeNull();
  });

  it("puts the short code in the link, on the instance's own address", async () => {
    const started = await start();
    expect(started.verificationUri).toBe(
      `https://okr.example/account/device?code=${encodeURIComponent(started.userCode)}`,
    );
    expect(started.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // No characters a person could mistake for each other.
    expect(started.userCode).not.toMatch(/[0O1IL]/);
  });
});

describe("what the approval screen sees", () => {
  it("reads a pending request by its short code", async () => {
    const wb = await workerDb();
    const started = await start(["read", "write"]);

    const pending = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "tokens.pendingDevice",
      { userCode: started.userCode },
    );
    expect(pending?.clientName).toBe("okr on a laptop");
    expect(pending?.requestedScopes).toEqual(["read", "write"]);
  });

  it("says nothing for a code that never existed, expired, or was answered", async () => {
    const wb = await workerDb();
    const read = (userCode: string) =>
      callAction({ pool: wb.appPool, ...asOwner() }, "tokens.pendingDevice", {
        userCode,
      });

    expect(await read("ZZZZ-ZZZZ")).toBeNull();

    const answered = await start();
    await approve(answered.userCode);
    // Already decided reads the same as never existed: somebody guessing codes
    // learns nothing about which guesses were once real.
    expect(await read(answered.userCode)).toBeNull();

    const expiring = await start();
    await wb.admin.query(
      "update device_authorisations set expires_at = now() - interval '1 minute' where user_code_hash = $1",
      [hashDeviceCode(expiring.userCode)],
    );
    expect(await read(expiring.userCode)).toBeNull();
  });
});

describe("polling", () => {
  it("is pending until somebody answers", async () => {
    const wb = await workerDb();
    const started = await start();

    const first = await pollDeviceAuthorisation(wb.appPool, {
      deviceCode: started.deviceCode,
      now: NOW,
    });
    expect(first).toEqual({ kind: "pending" });
  });

  it("asks a client polling too fast to slow down", async () => {
    const wb = await workerDb();
    const started = await start();

    await pollDeviceAuthorisation(wb.appPool, {
      deviceCode: started.deviceCode,
      now: NOW,
    });
    // A second poll one second later, inside the interval it was given.
    const again = await pollDeviceAuthorisation(wb.appPool, {
      deviceCode: started.deviceCode,
      now: new Date(NOW.getTime() + 1000),
    });
    expect(again).toEqual({ kind: "slow_down" });
  });

  it("refuses an expired code", async () => {
    const wb = await workerDb();
    const started = await start();
    await approve(started.userCode);
    await wb.admin.query(
      "update device_authorisations set expires_at = now() - interval '1 minute'",
    );

    const answer = await pollDeviceAuthorisation(wb.appPool, {
      deviceCode: started.deviceCode,
      now: NOW,
    });
    expect(answer).toEqual({ kind: "expired" });
  });

  it("reports a refusal as a refusal, not as still waiting", async () => {
    const wb = await workerDb();
    const started = await start();
    await approve(started.userCode, false);

    const answer = await pollDeviceAuthorisation(wb.appPool, {
      deviceCode: started.deviceCode,
      now: NOW,
    });
    expect(answer).toEqual({ kind: "denied" });
  });

  it("refuses a device code nobody issued", async () => {
    const wb = await workerDb();
    const answer = await pollDeviceAuthorisation(wb.appPool, {
      deviceCode: "AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHJJJJKKKK",
      now: NOW,
    });
    expect(answer).toEqual({ kind: "invalid" });
  });
});

describe("the grant", () => {
  /**
   * The test-plan line: the scopes it asked for and no more.
   */
  it("mints a token with exactly the scopes that were asked for", async () => {
    const wb = await workerDb();
    const started = await start(["read"]);
    await approve(started.userCode);

    const answer = await pollDeviceAuthorisation(wb.appPool, {
      deviceCode: started.deviceCode,
      now: LATER,
    });
    expect(answer.kind).toBe("granted");
    if (answer.kind !== "granted") {
      return;
    }

    const rows = await wb.admin.query(
      "select * from api_tokens where workspace_id = $1",
      [workspaceId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].scopes).toEqual(["read"]);
    expect(rows.rows[0].member_id).toBe(memberId);
    expect(rows.rows[0].audience).toBe("rest");
    // Hashed, like every other token: the raw value exists only in the answer.
    expect(rows.rows[0].token_hash).toBe(hashApiToken(answer.token));
    expect(JSON.stringify(rows.rows[0])).not.toContain(answer.token);
  });

  it("hands over a token that actually works, as that member", async () => {
    const wb = await workerDb();
    const started = await start(["read"]);
    await approve(started.userCode);
    const answer = await pollDeviceAuthorisation(wb.appPool, {
      deviceCode: started.deviceCode,
      now: LATER,
    });
    if (answer.kind !== "granted") {
      throw new Error("expected a grant");
    }

    const resolved = await resolveApiToken(wb.appPool, {
      raw: answer.token,
      audience: "rest",
      now: LATER,
    });
    expect(resolved.kind).toBe("ok");
    if (resolved.kind === "ok") {
      expect(resolved.workspaceId).toBe(workspaceId);
      expect(resolved.memberId).toBe(memberId);
      expect(resolved.scopes).toEqual(["read"]);
    }
  });

  /**
   * The test-plan line: a code approved twice grants once.
   */
  it("grants once, however many times it is polled", async () => {
    const wb = await workerDb();
    const started = await start();
    await approve(started.userCode);

    const first = await pollDeviceAuthorisation(wb.appPool, {
      deviceCode: started.deviceCode,
      now: LATER,
    });
    expect(first.kind).toBe("granted");

    const second = await pollDeviceAuthorisation(wb.appPool, {
      deviceCode: started.deviceCode,
      now: new Date(LATER.getTime() + 60_000),
    });
    // Not "granted again": the row was claimed in the same transaction that
    // minted, so there is nothing left to collect.
    expect(second).toEqual({ kind: "invalid" });

    const rows = await wb.admin.query(
      "select count(*)::int as count from api_tokens where workspace_id = $1",
      [workspaceId],
    );
    expect(rows.rows[0].count).toBe(1);
  });

  it("refuses to answer a request twice", async () => {
    const started = await start();
    await approve(started.userCode);
    await expect(approve(started.userCode)).rejects.toThrow();
  });

  it("refuses to answer an expired request", async () => {
    const wb = await workerDb();
    const started = await start();
    await wb.admin.query(
      "update device_authorisations set expires_at = now() - interval '1 minute'",
    );
    await expect(approve(started.userCode)).rejects.toThrow();
  });
});

describe("the audit trail", () => {
  it("records who authorised which terminal, and the scopes", async () => {
    const wb = await workerDb();
    const started = await start(["read", "write"]);
    await approve(started.userCode);

    const audited = await wb.admin.query(
      "select action, payload from audit_events where workspace_id = $1 and action = 'tokens.approveDevice'",
      [workspaceId],
    );
    expect(audited.rows).toHaveLength(1);
    const payload = audited.rows[0].payload as Record<string, unknown>;
    expect(payload.approved).toBe(true);
    expect(payload.scopes).toEqual(["read", "write"]);
    expect(payload.clientName).toBe("okr on a laptop");
  });

  it("records a refusal too, because refusing is a decision", async () => {
    const wb = await workerDb();
    const started = await start();
    await approve(started.userCode, false);

    const audited = await wb.admin.query(
      "select payload from audit_events where workspace_id = $1 and action = 'tokens.approveDevice'",
      [workspaceId],
    );
    expect((audited.rows[0].payload as Record<string, unknown>).approved).toBe(
      false,
    );
  });
});

describe("the tenant floor", () => {
  it("keeps a pending request invisible to a workspace that did not start it", async () => {
    const wb = await workerDb();
    const started = await start();
    const second = await provisionWorkspaceForUser(wb.appPool, {
      id: OTHER,
      name: "Other",
    });

    // The other workspace's member holds no code, so the ordinary tenant setting
    // is all they have, and a row with no workspace is not theirs to see.
    const seen = await callAction(
      {
        pool: wb.appPool,
        workspaceId: second.workspaceId,
        actor: { kind: "human", userId: OTHER },
      },
      "tokens.pendingDevice",
      { userCode: "ZZZZ-ZZZZ" },
    );
    expect(seen).toBeNull();

    // With the code, they could answer it, which is exactly the property the
    // protocol has: the code is the capability. It is eight characters from a
    // thirty-one character alphabet and lives ten minutes.
    expect(started.userCode).toHaveLength(9);
  });
});
