import { workspaces } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  AuditVisibilityError,
  canEnumerateWorkspaces,
  verifyAllChains,
  verifyWorkspaceChain,
} from "../src/audit/verify.ts";
import { OperationError, runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The Operation pipeline (TECHNICAL-PLAN §8.1 layer 3).
 *
 * The acceptance criterion: given any committed mutation, the audit chain
 * verifies, and a mutation without its audit row is impossible by
 * construction. These tests drive that from both sides. The happy path leaves
 * exactly one audit row, one activity row and one outbox row; the failing path
 * leaves none of them, including no audit row for work that did not happen.
 */

const USER = "pipeline-user";

let workspaceId: string;
let memberId: string;

const seedUser = async (id: string, email: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [id, id, email],
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await seedUser(USER, "pipeline@example.com");
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: USER,
    name: "Pipeline User",
  });
  workspaceId = provisioned.workspaceId;
  memberId = provisioned.memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

/** A minimal operation that renames the workspace. */
const rename = async (to: string, options: { fail?: boolean } = {}) => {
  const wb = await workerDb();
  return runOperation(
    { pool: wb.appPool },
    {
      action: "workspace.rename",
      workspaceId,
      actor: { kind: "human", userId: USER },
      async execute({ tx }) {
        const [updated] = await tx
          .update(workspaces)
          .set({ name: to })
          .where(eq(workspaces.id, workspaceId))
          .returning({ id: workspaces.id, name: workspaces.name });

        if (options.fail) {
          throw new Error("deliberate failure after the change");
        }

        return {
          result: updated,
          activity: {
            kind: "workspace.renamed",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: { to },
          },
          audit: {
            action: "workspace.rename",
            targetType: "workspace",
            targetId: workspaceId,
            payload: { to },
          },
          outbox: [
            {
              topic: "workspace.renamed",
              payload: { workspaceId, to },
              idempotencyKey: `workspace.renamed:${workspaceId}:${to}`,
            },
          ],
        };
      },
    },
  );
};

const counts = async () => {
  const wb = await workerDb();
  const result = await wb.admin.query(
    `select (select count(*) from audit_events)::int as audit,
            (select count(*) from activities)::int as activity,
            (select count(*) from outbox)::int as outbox`,
  );
  return result.rows[0] as {
    audit: number;
    activity: number;
    outbox: number;
  };
};

describe("a committed mutation", () => {
  it("leaves exactly one audit, one activity and one outbox row", async () => {
    // Provisioning is itself an operation, so start from its baseline.
    const before = await counts();
    await rename("Renamed");
    const after = await counts();

    expect(after.audit - before.audit).toBe(1);
    expect(after.activity - before.activity).toBe(1);
    expect(after.outbox - before.outbox).toBe(1);
  });

  it("applies the change itself", async () => {
    const wb = await workerDb();
    await rename("Renamed");
    const workspace = await wb.admin.query(
      "select name from workspaces where id = $1",
      [workspaceId],
    );
    expect(workspace.rows[0]?.name).toBe("Renamed");
  });

  it("records the acting member and the action", async () => {
    const wb = await workerDb();
    await rename("Renamed");
    const audit = await wb.admin.query(
      "select actor_member_id, actor_kind, action, target_type, payload from audit_events order by seq desc limit 1",
    );
    expect(audit.rows[0]).toMatchObject({
      actor_member_id: memberId,
      actor_kind: "human",
      action: "workspace.rename",
      target_type: "workspace",
    });
  });

  it("keeps the chain verifiable", async () => {
    const wb = await workerDb();
    await rename("One");
    await rename("Two");
    await rename("Three");
    const verdict = await verifyWorkspaceChain(wb.appPool, workspaceId);
    expect(verdict.ok).toBe(true);
    expect(verdict.checked).toBeGreaterThanOrEqual(4);
  });
});

describe("a rolled-back mutation", () => {
  it("leaves no audit row, no activity and no outbox row", async () => {
    const before = await counts();
    await expect(rename("Doomed", { fail: true })).rejects.toThrow(
      /deliberate failure/,
    );
    expect(await counts()).toEqual(before);
  });

  it("leaves the change itself undone", async () => {
    const wb = await workerDb();
    const original = await wb.admin.query(
      "select name from workspaces where id = $1",
      [workspaceId],
    );
    await expect(rename("Doomed", { fail: true })).rejects.toThrow();
    const after = await wb.admin.query(
      "select name from workspaces where id = $1",
      [workspaceId],
    );
    expect(after.rows[0]?.name).toBe(original.rows[0]?.name);
  });

  it("does not consume a sequence number, so the chain stays contiguous", async () => {
    const wb = await workerDb();
    await rename("One");
    await expect(rename("Doomed", { fail: true })).rejects.toThrow();
    await rename("Two");

    const rows = await wb.admin.query(
      "select seq from audit_events where workspace_id = $1 order by seq",
      [workspaceId],
    );
    expect(rows.rows.map((row) => Number(row.seq))).toEqual([1, 2, 3]);
    expect((await verifyWorkspaceChain(wb.appPool, workspaceId)).ok).toBe(true);
  });
});

describe("authorisation", () => {
  it("refuses somebody who is not a member of the workspace", async () => {
    const wb = await workerDb();
    await seedUser("outsider", "outsider@example.com");

    await expect(
      runOperation(
        { pool: wb.appPool },
        {
          action: "workspace.rename",
          workspaceId,
          actor: { kind: "human", userId: "outsider" },
          execute: async () => {
            throw new Error("must not run");
          },
        },
      ),
    ).rejects.toThrow(OperationError);
  });

  it("refuses a suspended member", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended', suspended_at = now() where id = $1",
      [memberId],
    );
    await expect(rename("Nope")).rejects.toThrow(OperationError);
  });

  it("writes nothing when it refuses", async () => {
    const wb = await workerDb();
    const before = await counts();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [memberId],
    );
    await expect(rename("Nope")).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });
});

describe("the audit table is append-only", () => {
  it("refuses an update from the application role", async () => {
    const wb = await workerDb();
    await rename("Renamed");

    const failure = await wb.appPool
      .query("update audit_events set action = 'forged'")
      .then(
        () => undefined,
        (error: unknown) => error as Error,
      );

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toMatch(/permission denied|append-only/i);
  });

  it("refuses a delete from the application role", async () => {
    const wb = await workerDb();
    await rename("Renamed");

    const failure = await wb.appPool.query("delete from audit_events").then(
      () => undefined,
      (error: unknown) => error as Error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toMatch(/permission denied|append-only/i);
  });

  it("refuses an update even from a superuser, because grants are not the only guard", async () => {
    // Revoked grants stop the application role. A trigger stops everybody,
    // including whoever holds the owner or superuser connection, so history
    // cannot be quietly rewritten by someone with a psql prompt.
    const wb = await workerDb();
    await rename("Renamed");

    const failure = await wb.admin
      .query("update audit_events set action = 'forged'")
      .then(
        () => undefined,
        (error: unknown) => error as Error,
      );

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toMatch(/append-only/i);
  });

  it("refuses a delete even from a superuser", async () => {
    const wb = await workerDb();
    await rename("Renamed");

    const failure = await wb.admin.query("delete from audit_events").then(
      () => undefined,
      (error: unknown) => error as Error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toMatch(/append-only/i);
  });
});

describe("tenant isolation of the audit trail", () => {
  it("shows a workspace only its own audit rows", async () => {
    const wb = await workerDb();
    await seedUser("other", "other@example.com");
    const other = await provisionWorkspaceForUser(wb.appPool, {
      id: "other",
      name: "Other Person",
    });
    await rename("Renamed");

    const client = await wb.appPool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.workspace_id', $1, true)", [
        other.workspaceId,
      ]);
      const rows = await client.query<{ workspace_id: string }>(
        "select workspace_id from audit_events",
      );
      expect(
        rows.rows.every((row) => row.workspace_id === other.workspaceId),
      ).toBe(true);
      await client.query("commit");
    } finally {
      client.release();
    }
  });

  it("keeps each workspace's sequence independent", async () => {
    const wb = await workerDb();
    await seedUser("other", "other@example.com");
    const other = await provisionWorkspaceForUser(wb.appPool, {
      id: "other",
      name: "Other Person",
    });

    const seqs = await wb.admin.query(
      "select workspace_id, min(seq)::int as first from audit_events group by workspace_id",
    );
    expect(seqs.rows).toHaveLength(2);
    expect(seqs.rows.every((row) => row.first === 1)).toBe(true);
    expect((await verifyWorkspaceChain(wb.appPool, other.workspaceId)).ok).toBe(
      true,
    );
  });
});

describe("concurrent writes in one workspace", () => {
  it("produce a contiguous, verifiable chain", async () => {
    // The chain is only meaningful if two writes cannot claim the same
    // predecessor. This is what the per-workspace lock is for.
    const wb = await workerDb();
    await Promise.all([
      rename("A"),
      rename("B"),
      rename("C"),
      rename("D"),
      rename("E"),
    ]);

    const rows = await wb.admin.query(
      "select seq from audit_events where workspace_id = $1 order by seq",
      [workspaceId],
    );
    expect(rows.rows.map((row) => Number(row.seq))).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await verifyWorkspaceChain(wb.appPool, workspaceId)).ok).toBe(true);
  });
});

describe("the verification tool refuses to pass while blind", () => {
  it("cannot enumerate workspaces as the application role", async () => {
    // The tenant floor hides workspaces from any connection with no workspace
    // setting, and forced row-level security applies that to the table owner
    // too. Only an elevated role can list tenants.
    const wb = await workerDb();
    expect(await canEnumerateWorkspaces(wb.appPool)).toBe(false);
  });

  it("raises rather than reporting every chain intact", async () => {
    // The bug this pins: verifyAllChains used to return an empty list here and
    // the command printed "0 chain(s) intact", which reads as a pass. A
    // verifier that cannot see anything must say so.
    const wb = await workerDb();
    await expect(verifyAllChains(wb.appPool)).rejects.toThrow(
      AuditVisibilityError,
    );
  });

  it("still verifies a named workspace as the application role", async () => {
    // Naming the workspace supplies the tenant setting, so an ordinary role
    // can check its own chain without any elevation.
    const wb = await workerDb();
    await rename("Renamed");
    expect((await verifyWorkspaceChain(wb.appPool, workspaceId)).ok).toBe(true);
  });

  it("enumerates and verifies every chain with an elevated connection", async () => {
    const wb = await workerDb();
    expect(await canEnumerateWorkspaces(wb.admin)).toBe(true);
    const results = await verifyAllChains(wb.admin);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((entry) => entry.verdict.ok)).toBe(true);
  });
});

describe("tampering that defeats the trigger is still caught", () => {
  it("reports the sequence where the chain stops adding up", async () => {
    // Somebody with a superuser prompt can disable the trigger. They cannot
    // recompute the chain, which is the point of having one.
    const wb = await workerDb();
    await rename("One");
    await rename("Two");

    await wb.admin.query(
      "alter table audit_events disable trigger audit_events_no_update",
    );
    await wb.admin.query(
      'update audit_events set payload = \'{"to":"Forged"}\'::jsonb where seq = 2 and workspace_id = $1',
      [workspaceId],
    );
    await wb.admin.query(
      "alter table audit_events enable trigger audit_events_no_update",
    );

    const verdict = await verifyWorkspaceChain(wb.appPool, workspaceId);
    expect(verdict.ok).toBe(false);
    expect(verdict.brokenAtSeq).toBe(2);
  });
});
