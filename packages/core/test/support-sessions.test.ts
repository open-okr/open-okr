import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { callAction } from "../src/actions/registry.ts";
import {
  endSupportSession,
  grantSupportSession,
  listSupportSessions,
  liveSupportSession,
  requestSupportSession,
  sweepExpiredSessions,
} from "../src/operator/index.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * Support access (P8-T04a, design in
 * `docs/design/p8-t01b-support-access.md`).
 *
 * Four claims, and the second is the one the whole design rests on:
 *
 *   1. An operator cannot let themselves in. Consent is the only path.
 *   2. **The session is a binding, not a bypass**, so `can()` answers for an
 *      operator exactly as it answers for anybody else.
 *   3. Expiry is refused at use, not at the next sweep.
 *   4. The customer can see who was in their workspace, when and why.
 */

const OPERATOR = "support-operator";
const OWNER = "support-owner";
const GRANTER = "support-granter";

let workspaceId: string;

const seedUser = async (id: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3) on conflict do nothing",
    [id, id, `${id}@example.com`],
  );
};

const grantOperator = async () => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into instance_operators (user_id, granted_by_user_id) values ($1, $2) on conflict do nothing",
    [OPERATOR, GRANTER],
  );
};

const request = async (reason = "Ticket 4821: check-ins not sending.") => {
  const wb = await workerDb();
  return requestSupportSession(wb.appPool, {
    workspaceId,
    operatorUserId: OPERATOR,
    reason,
  });
};

const grant = async (sessionId: string, over: Record<string, number> = {}) => {
  const wb = await workerDb();
  return grantSupportSession(wb.appPool, {
    workspaceId,
    sessionId,
    grantedByUserId: OWNER,
    ...over,
  });
};

/** What the operator can actually do, asked the way any member is asked. */
const readAsOperator = async () => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human", userId: OPERATOR },
    },
    "workspace.overview",
    {},
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  for (const id of [OPERATOR, OWNER, GRANTER]) {
    await seedUser(id);
  }
  workspaceId = (
    await createWorkspace(wb.appPool, { user: { id: OWNER, name: "Owner" } })
  ).workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("an operator cannot let themselves in", () => {
  it("refuses a request from somebody with no grant", async () => {
    // Not-found, so a caller who is not an operator learns nothing, including
    // whether the workspace exists.
    await expect(request()).rejects.toThrow(/No such workspace/);
  });

  it("refuses a request with no reason", async () => {
    await grantOperator();
    await expect(request("   ")).rejects.toThrow();
  });

  it("grants nothing on its own", async () => {
    // The whole promise. A request is a question, not an answer.
    await grantOperator();
    await request();
    await expect(readAsOperator()).rejects.toThrow();
    await expect(
      liveSupportSession((await workerDb()).appPool, workspaceId),
    ).resolves.toBeUndefined();
  });

  it("refuses a second live request for the same workspace", async () => {
    await grantOperator();
    await request();
    // Two live sessions would make the audit trail ambiguous about which one
    // an action belonged to.
    await expect(request()).rejects.toThrow();
  });
});

describe("the session is a binding, not a bypass", () => {
  it("lets the operator read only once the customer has said yes", async () => {
    await grantOperator();
    const { id } = await request();
    await expect(readAsOperator()).rejects.toThrow();

    await grant(id);
    await expect(readAsOperator()).resolves.toBeTruthy();
  });

  it("creates a guest member rather than a second authorisation path", async () => {
    const wb = await workerDb();
    await grantOperator();
    const { id } = await request();
    await grant(id);

    const { rows } = await wb.admin.query(
      "select kind, status from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, OPERATOR],
    );
    expect(rows).toHaveLength(1);
    // A guest, so `can()` answers for them like anybody else, and so they do
    // not count as a seat.
    expect(rows[0]).toMatchObject({ kind: "guest", status: "active" });
  });

  it("refuses a write when the customer granted only view", async () => {
    const wb = await workerDb();
    await grantOperator();
    const { id } = await request();
    await grant(id, { level: ACCESS_LEVELS.view });

    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human", userId: OPERATOR },
        },
        "workspace.rename",
        { name: "Renamed by support" },
      ),
    ).rejects.toThrow();
  });

  it("refuses a grant at full, however it is asked for", async () => {
    // `full` includes changing who has access, so an operator holding it
    // could extend their own session, and a session that can extend itself
    // has no time box.
    await grantOperator();
    const { id } = await request();
    await expect(grant(id, { level: ACCESS_LEVELS.full })).rejects.toThrow(
      /view, comment or edit/,
    );
  });

  it("refuses more than a day", async () => {
    await grantOperator();
    const { id } = await request();
    await expect(grant(id, { hours: 48 })).rejects.toThrow();
  });
});

describe("expiry is refused at use, not at the next sweep", () => {
  const expire = async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update operator_sessions set expires_at = now() - interval '1 minute' where workspace_id = $1",
      [workspaceId],
    );
  };

  it("stops the operator the moment the time is up, with no sweep in between", async () => {
    await grantOperator();
    const { id } = await request();
    await grant(id);
    await expect(readAsOperator()).resolves.toBeTruthy();

    await expire();

    // No sweep has run. The member row is still active and the session row is
    // still open; the refusal comes from `resolveActor` reading the expiry.
    await expect(readAsOperator()).rejects.toThrow();
  });

  it("is then tidied by the sweep, which suspends the member", async () => {
    const wb = await workerDb();
    await grantOperator();
    const { id } = await request();
    await grant(id);
    await expire();

    await expect(sweepExpiredSessions(wb.appPool)).resolves.toMatchObject({
      ended: 1,
    });

    const { rows } = await wb.admin.query(
      "select status from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, OPERATOR],
    );
    // Suspended, never deleted: everything the operator did is attributed to
    // them, and an author who no longer exists is a falsified record.
    expect(rows[0].status).toBe("suspended");
  });

  it("sweeps nothing twice", async () => {
    const wb = await workerDb();
    await grantOperator();
    const { id } = await request();
    await grant(id);
    await expire();
    await sweepExpiredSessions(wb.appPool);
    await expect(sweepExpiredSessions(wb.appPool)).resolves.toMatchObject({
      ended: 0,
    });
  });

  it("leaves a live session alone", async () => {
    const wb = await workerDb();
    await grantOperator();
    const { id } = await request();
    await grant(id);
    await expect(sweepExpiredSessions(wb.appPool)).resolves.toMatchObject({
      ended: 0,
    });
  });
});

describe("the customer can see who was in their workspace", () => {
  it("shows a live session with its reason and expiry", async () => {
    const wb = await workerDb();
    await grantOperator();
    const { id } = await request("Ticket 4821: check-ins not sending.");
    await grant(id);

    const live = await liveSupportSession(wb.appPool, workspaceId);
    expect(live).toMatchObject({
      operatorUserId: OPERATOR,
      reason: "Ticket 4821: check-ins not sending.",
    });
    expect(live?.expiresAt).toBeInstanceOf(Date);
  });

  it("keeps the record after it ends, with how it ended", async () => {
    const wb = await workerDb();
    await grantOperator();
    const { id } = await request();
    await grant(id);
    await endSupportSession(wb.appPool, {
      workspaceId,
      sessionId: id,
      reason: "revoked",
      endedByUserId: OWNER,
    });

    const all = await listSupportSessions(wb.appPool, workspaceId);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ endedReason: "revoked" });
    // The reason it was asked for survives, so somebody asking six months
    // later reads it rather than a bare timestamp.
    expect(all[0]?.reason).toBeTruthy();
    await expect(
      liveSupportSession(wb.appPool, workspaceId),
    ).resolves.toBeUndefined();
  });

  it("records the grant and the end in the workspace's own audit trail", async () => {
    const wb = await workerDb();
    await grantOperator();
    const { id } = await request();
    await grant(id);
    await endSupportSession(wb.appPool, {
      workspaceId,
      sessionId: id,
      reason: "finished",
      endedByUserId: OWNER,
    });

    const { rows } = await wb.admin.query(
      "select action, payload from audit_events where workspace_id = $1 and action like 'support.%' order by at",
      [workspaceId],
    );
    expect(rows.map((row) => row.action)).toEqual([
      "support.grant",
      "support.end",
    ]);
    expect(rows[0].payload.operatorUserId).toBe(OPERATOR);
  });
});
