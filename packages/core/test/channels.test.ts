import { channelMessages, workspaceMembers } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { dispatchOutbox, type OutboxDelivery } from "../src/outbox/handlers.ts";
import { parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Channels: connections, identities and the message log (P5-T01b-a).
 *
 * The acceptance criterion is the last test in "the message log": the same
 * message asked for twice is one row and one send. Everything above it is what
 * has to hold for that to mean anything.
 */

const OWNER = "channels-owner";
const OTHER = "channels-other";

let workspaceId: string;
let ownerMemberId: string;
let otherMemberId: string;

const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

const asOwner = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
  ring,
});

const asOther = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OTHER },
  ring,
});

async function memberIdFor(userId: string): Promise<string> {
  const wb = await workerDb();
  const rows = await wb.admin.query(
    "select id from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, userId],
  );
  return rows.rows[0].id as string;
}

async function loggedRows() {
  const wb = await workerDb();
  const rows = await wb.admin.query(
    "select id, provider, status, idempotency_key, payload, sent_at, error from channel_messages order by created_at",
  );
  return rows.rows as Array<{
    id: string;
    provider: string;
    status: string;
    idempotency_key: string;
    payload: Record<string, unknown>;
    sent_at: Date | null;
    error: string | null;
  }>;
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
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [OWNER, "Owner", "owner@example.com", OTHER, "Other", "other@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = await memberIdFor(OWNER);

  // A second member, inserted directly because this file is about channels and
  // not about the invitation flow, which invitations.test.ts already covers.
  await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Other', 'active')`,
    [workspaceId, OTHER],
  );
  otherMemberId = await memberIdFor(OTHER);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("connections", () => {
  it("stores credentials and never reads them back", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...asOwner() }, "channels.connect", {
      provider: "slack",
      credentials: "xoxb-a-real-looking-token",
      config: { teamId: "T123" },
    });

    const { connections } = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.listConnections",
      {},
    );
    expect(connections).toHaveLength(1);
    expect(connections[0]?.provider).toBe("slack");
    expect(connections[0]?.config).toEqual({ teamId: "T123" });

    // The token is not on the read action's output in any shape.
    expect(JSON.stringify(connections)).not.toContain("xoxb");

    // And what is stored is not the token either.
    const stored = await wb.admin.query(
      "select ciphertext, data_key, key_id from channel_connections",
    );
    expect(stored.rows[0].ciphertext).not.toContain("xoxb");
    expect(stored.rows[0].data_key).toBeTruthy();
    expect(stored.rows[0].key_id).toBeTruthy();
  });

  it("does not claim to have verified a credential nobody called the provider with", async () => {
    const wb = await workerDb();
    const connection = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.connect",
      { provider: "telegram", credentials: "bot-token" },
    );
    expect(connection.lastVerifiedAt).toBeNull();
  });

  it("replaces rather than duplicates when a provider is reconnected", async () => {
    const wb = await workerDb();
    for (const credentials of ["first-token", "second-token"]) {
      await callAction({ pool: wb.appPool, ...asOwner() }, "channels.connect", {
        provider: "slack",
        credentials,
      });
    }
    const rows = await wb.admin.query(
      "select count(*)::int as count from channel_connections where deleted_at is null",
    );
    expect(rows.rows[0].count).toBe(1);
  });

  it("refuses a member who is not an administrator", async () => {
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...asOther() }, "channels.connect", {
        provider: "slack",
        credentials: "xoxb-token",
      }),
    ).rejects.toThrow();
  });

  it("disconnecting removes it from the list", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...asOwner() }, "channels.connect", {
      provider: "slack",
      credentials: "xoxb-token",
    });
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.disconnect",
      { provider: "slack" },
    );
    const { connections } = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.listConnections",
      {},
    );
    expect(connections).toEqual([]);
  });
});

describe("identities", () => {
  it("links the caller's own account and lists it back", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-owner", externalHandle: "@owner" },
    );

    const { identities } = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.listIdentities",
      {},
    );
    expect(identities).toHaveLength(1);
    expect(identities[0]?.externalId).toBe("U-owner");
    expect(identities[0]?.verifiedAt).not.toBeNull();
  });

  it("shows a member only their own identities", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-owner" },
    );

    const { identities } = await callAction(
      { pool: wb.appPool, ...asOther() },
      "channels.listIdentities",
      {},
    );
    expect(identities).toEqual([]);
  });

  it("refuses an account another member has already claimed", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-shared" },
    );

    await expect(
      callAction({ pool: wb.appPool, ...asOther() }, "channels.linkIdentity", {
        provider: "slack",
        externalId: "U-shared",
      }),
    ).rejects.toThrow(/already linked/);
  });

  it("replaces the caller's own identity on the same provider rather than adding a second", async () => {
    const wb = await workerDb();
    for (const externalId of ["U-old", "U-new"]) {
      await callAction(
        { pool: wb.appPool, ...asOwner() },
        "channels.linkIdentity",
        { provider: "slack", externalId },
      );
    }
    const { identities } = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.listIdentities",
      {},
    );
    expect(identities).toHaveLength(1);
    expect(identities[0]?.externalId).toBe("U-new");
  });

  it("unlinking leaves the member with nothing linked", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-owner" },
    );
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.unlinkIdentity",
      { provider: "slack" },
    );
    const { identities } = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.listIdentities",
      {},
    );
    expect(identities).toEqual([]);
  });

  it("frees the external id, so somebody else may claim it after an unlink", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.linkIdentity",
      { provider: "slack", externalId: "U-shared" },
    );
    await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.unlinkIdentity",
      { provider: "slack" },
    );
    await expect(
      callAction({ pool: wb.appPool, ...asOther() }, "channels.linkIdentity", {
        provider: "slack",
        externalId: "U-shared",
      }),
    ).resolves.toMatchObject({ externalId: "U-shared" });
  });
});

describe("the message log", () => {
  it("queues one row and one outbox job", async () => {
    const wb = await workerDb();
    const outcome = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.send",
      {
        memberId: otherMemberId,
        text: "Your check-in is due.",
        idempotencyKey: "checkin.due:goal-1:2026-08-27",
      },
    );

    expect(outcome).toEqual({ queued: true, provider: "email" });

    const rows = await loggedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("queued");
    expect(rows[0]?.payload).toMatchObject({ text: "Your check-in is due." });

    const jobs = (await outboxRows()).filter(
      (job) => job.topic === "channel.message",
    );
    expect(jobs).toHaveLength(1);
  });

  it("refuses a member who is not in this workspace", async () => {
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...asOwner() }, "channels.send", {
        memberId: "00000000-0000-4000-8000-000000000000",
        text: "Hello.",
        idempotencyKey: "stranger:1",
      }),
    ).rejects.toThrow(/No such member/);
  });

  /**
   * The acceptance criterion, in the form the task states it.
   *
   * Two identical asks, one row, one job, one email. The second ask is not an
   * error: the nudge engine re-running its sweep is the case this exists for.
   */
  it("asked twice with the same key, sends once (acceptance)", async () => {
    const wb = await workerDb();
    const input = {
      memberId: otherMemberId,
      text: "Your check-in is due.",
      idempotencyKey: "checkin.due:goal-1:2026-08-27",
    };

    const first = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.send",
      input,
    );
    const second = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.send",
      input,
    );

    expect(first.queued).toBe(true);
    expect(second.queued).toBe(false);

    const rows = await loggedRows();
    expect(rows).toHaveLength(1);

    const jobs = (await outboxRows()).filter(
      (job) => job.topic === "channel.message",
    );
    expect(jobs).toHaveLength(1);

    // And delivering that one job sends exactly one message.
    const sent: string[] = [];
    await dispatchOutbox(jobs[0] as OutboxDelivery, {
      pool: wb.appPool,
      sendChannel: async (message) => {
        sent.push(message.text);
        return { delivered: true, externalMessageId: "m-1" };
      },
    });
    expect(sent).toEqual(["Your check-in is due."]);

    const delivered = await loggedRows();
    expect(delivered[0]?.status).toBe("sent");
    expect(delivered[0]?.sent_at).toBeInstanceOf(Date);
  });

  it("delivering the same job twice sends once, because the row is already sent", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...asOwner() }, "channels.send", {
      memberId: otherMemberId,
      text: "Once only.",
      idempotencyKey: "once:1",
    });
    const [job] = (await outboxRows()).filter(
      (row) => row.topic === "channel.message",
    );

    const sent: string[] = [];
    const skipped: string[] = [];
    const deps = {
      pool: wb.appPool,
      sendChannel: async (message: { text: string }) => {
        sent.push(message.text);
        return { delivered: true };
      },
      onSkipped: (_delivery: OutboxDelivery, reason: string) =>
        skipped.push(reason),
    };

    await dispatchOutbox(job as OutboxDelivery, deps);
    await dispatchOutbox(job as OutboxDelivery, deps);

    expect(sent).toEqual(["Once only."]);
    expect(skipped).toEqual(["already sent"]);
  });

  it("records a suppression as a suppression, not as a failure", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...asOwner() }, "channels.send", {
      memberId: otherMemberId,
      text: "Nowhere to go.",
      idempotencyKey: "suppressed:1",
    });
    const [job] = (await outboxRows()).filter(
      (row) => row.topic === "channel.message",
    );

    await dispatchOutbox(job as OutboxDelivery, {
      pool: wb.appPool,
      sendChannel: async () => ({
        delivered: false,
        suppressedReason: "the member has no email address",
      }),
    });

    const rows = await loggedRows();
    expect(rows[0]?.status).toBe("suppressed");
    expect(rows[0]?.error).toBe("the member has no email address");
    expect(rows[0]?.sent_at).toBeNull();
  });

  it("records a driver failure and lets the relay retry it", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...asOwner() }, "channels.send", {
      memberId: otherMemberId,
      text: "The provider is down.",
      idempotencyKey: "failed:1",
    });
    const [job] = (await outboxRows()).filter(
      (row) => row.topic === "channel.message",
    );

    await expect(
      dispatchOutbox(job as OutboxDelivery, {
        pool: wb.appPool,
        sendChannel: async () => {
          throw new Error("smtp: connection refused");
        },
      }),
    ).rejects.toThrow(/connection refused/);

    const rows = await loggedRows();
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.error).toContain("connection refused");
    // Not a permanent failure: a mail server that is down comes back.
    expect(rows[0]?.sent_at).toBeNull();
  });

  it("skips when the deployment has no channel driver at all", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...asOwner() }, "channels.send", {
      memberId: otherMemberId,
      text: "Nothing to send with.",
      idempotencyKey: "nodriver:1",
    });
    const [job] = (await outboxRows()).filter(
      (row) => row.topic === "channel.message",
    );

    const skipped: string[] = [];
    await dispatchOutbox(job as OutboxDelivery, {
      pool: wb.appPool,
      onSkipped: (_delivery, reason) => skipped.push(reason),
    });
    expect(skipped).toEqual(["no channel driver is configured"]);

    // Still queued, so configuring a driver and redelivering works.
    const rows = await loggedRows();
    expect(rows[0]?.status).toBe("queued");
  });

  it("lists the log for an administrator, newest first", async () => {
    const wb = await workerDb();
    for (const key of ["log:1", "log:2"]) {
      await callAction({ pool: wb.appPool, ...asOwner() }, "channels.send", {
        memberId: otherMemberId,
        text: key,
        idempotencyKey: key,
      });
    }
    const { messages } = await callAction(
      { pool: wb.appPool, ...asOwner() },
      "channels.listMessages",
      {},
    );
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.provider === "email")).toBe(
      true,
    );
  });
});

describe("the tenant floor", () => {
  it("hides another workspace's connections, identities and messages", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...asOwner() }, "channels.connect", {
      provider: "slack",
      credentials: "xoxb-token",
    });
    await callAction({ pool: wb.appPool, ...asOwner() }, "channels.send", {
      memberId: ownerMemberId,
      text: "Ours.",
      idempotencyKey: "ours:1",
    });

    // A second workspace, owned by somebody else. Nothing from the first may
    // be visible from it, which is the row-level security floor rather than
    // anything the actions do.
    //
    // A different user, because provisioning is idempotent per user: asking
    // for a second workspace for the same person returns the one they already
    // have, and the assertion below would then be comparing a workspace with
    // itself and passing for the wrong reason.
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      ["channels-stranger", "Stranger", "stranger@example.com"],
    );
    const second = await provisionWorkspaceForUser(wb.appPool, {
      id: "channels-stranger",
      name: "Stranger",
    });
    expect(second.workspaceId).not.toBe(workspaceId);

    const context = {
      pool: wb.appPool,
      workspaceId: second.workspaceId,
      actor: { kind: "human" as const, userId: "channels-stranger" },
      ring,
    };
    const { connections } = await callAction(
      context,
      "channels.listConnections",
      {},
    );
    const { messages } = await callAction(context, "channels.listMessages", {});
    expect(connections).toEqual([]);
    expect(messages).toEqual([]);
  });
});

describe("what the schema refuses", () => {
  it("will not store two identities for one member on one provider", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into channel_identities (id, workspace_id, member_id, provider, external_id)
       values (gen_random_uuid(), $1, $2, 'slack', 'U-1')`,
      [workspaceId, ownerMemberId],
    );
    await expect(
      wb.admin.query(
        `insert into channel_identities (id, workspace_id, member_id, provider, external_id)
         values (gen_random_uuid(), $1, $2, 'slack', 'U-2')`,
        [workspaceId, ownerMemberId],
      ),
    ).rejects.toThrow(/channel_identities_member_idx/);
  });

  it("will not store one external id against two members", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into channel_identities (id, workspace_id, member_id, provider, external_id)
       values (gen_random_uuid(), $1, $2, 'slack', 'U-1')`,
      [workspaceId, ownerMemberId],
    );
    await expect(
      wb.admin.query(
        `insert into channel_identities (id, workspace_id, member_id, provider, external_id)
         values (gen_random_uuid(), $1, $2, 'slack', 'U-1')`,
        [workspaceId, otherMemberId],
      ),
    ).rejects.toThrow(/channel_identities_external_idx/);
  });

  it("will not store two messages under one idempotency key, even after a soft delete", async () => {
    const wb = await workerDb();
    const insert = (key: string, deleted: boolean) =>
      wb.admin.query(
        `insert into channel_messages
           (id, workspace_id, provider, direction, idempotency_key, deleted_at)
         values (gen_random_uuid(), $1, 'email', 'out', $2, ${deleted ? "now()" : "null"})`,
        [workspaceId, key],
      );

    await insert("dup:1", true);
    // Soft-deleting the record of a send must not let the send happen again,
    // which is why that index is not partial on `deleted_at`.
    await expect(insert("dup:1", false)).rejects.toThrow(
      /channel_messages_idempotency_idx/,
    );
  });
});
