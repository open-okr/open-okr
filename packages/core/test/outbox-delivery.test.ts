import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { dispatchOutbox, type OutboxDelivery } from "../src/outbox/handlers.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Write to delivery, over a real database (P5-T01a).
 *
 * The other outbox tests prove the row is written and that the relay claims it.
 * This one proves the middle: that what the invitation action puts on the row
 * is what the invitation handler needs. Those two have been written eight
 * months apart by different tasks and nothing has ever run them together,
 * which is how "no invitation email has ever been sent" survived this long
 * (PLAN.md §12 R10).
 *
 * `OutboxRelay` itself is deliberately absent: it lives in
 * `packages/adapters`, which `packages/core` may not import. The relay's own
 * suite covers claiming and retrying; this covers the payload contract.
 */

const OWNER = "outbox-delivery-owner";

let workspaceId: string;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Owner", "owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const pendingRows = async (): Promise<OutboxDelivery[]> => {
  const wb = await workerDb();
  const result = await wb.admin.query(
    "select topic, payload, idempotency_key, attempts from outbox order by created_at",
  );
  return result.rows.map((row) => ({
    topic: row.topic as string,
    payload: row.payload as Record<string, unknown>,
    idempotencyKey: row.idempotency_key as string,
    attempts: row.attempts as number,
  }));
};

it("turns an invitation into the email a member would receive", async () => {
  const wb = await workerDb();
  const link = await callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human", userId: OWNER },
    },
    "invitations.createPersonalLink",
    { email: "newcomer@example.com" },
  );

  const rows = await pendingRows();
  const invitation = rows.find((row) => row.topic === "invitation.email");
  expect(invitation).toBeDefined();

  const sent: Array<{ to: string; subject: string; text: string }> = [];
  await dispatchOutbox(invitation as OutboxDelivery, {
    pool: wb.appPool,
    baseUrl: "https://okr.example.com",
    sendMail: async (message) => {
      sent.push({ ...message });
    },
  });

  expect(sent).toHaveLength(1);
  expect(sent[0]?.to).toBe("newcomer@example.com");
  // The same token the action returned to the inviter, which is the one thing
  // the recipient needs and the one thing the database only holds as a hash.
  expect(sent[0]?.text).toContain(`/join/${link.token}`);
});

it("delivers every row a first workspace produces, with nothing left unhandled", async () => {
  const wb = await workerDb();
  await callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human", userId: OWNER },
    },
    "invitations.createPersonalLink",
    { email: "newcomer@example.com" },
  );

  const rows = await pendingRows();
  expect(rows.length).toBeGreaterThan(0);

  const skipped: string[] = [];
  for (const row of rows) {
    // No mail, no realtime, no embedding: the shape of a plain self-hosted
    // instance on its first day. Every row must resolve, and none of them may
    // throw, or that install starts collecting dead letters immediately.
    await dispatchOutbox(row, {
      pool: wb.appPool,
      onSkipped: (delivery, reason) =>
        skipped.push(`${delivery.topic}: ${reason}`),
    });
  }

  expect(skipped).toContain(
    "invitation.email: no mail transport is configured",
  );
});
