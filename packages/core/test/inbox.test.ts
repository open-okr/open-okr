import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  bindGroup,
  ensureContext,
  ensureMemberGroup,
} from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { callAction } from "../src/actions/registry.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The in-app inbox read (screen S-03, P6-G07a).
 *
 * **What this file is really testing is that a row can say what it is about.**
 * `notifications.list` returned an id, a reason, a channel and three
 * timestamps, so nothing could be grouped by entity or linked to its target,
 * and the screen S-03 describes could not be drawn from it. The subject reached
 * `notifyRecipients` and was thrown away; migration 0074 stores it.
 *
 * Four things are asserted, and each one was a defect before it was a test: the
 * subject survives the write, a subject the reader cannot reach is not listed,
 * a subject type the access getter has never heard of is listed rather than
 * hidden, and all six reasons parse.
 */

const OWNER = "inbox-owner";
const OTHER = "inbox-other";

let workspaceId: string;
let ownerMemberId: string;

function context(userId: string) {
  return { workspaceId, actor: { kind: "human" as const, userId } };
}

async function pool() {
  return (await workerDb()).appPool;
}

/** A notification addressed to a member, about a subject, written directly. */
async function writeNotification(input: {
  readonly recipientMemberId: string;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly reason: string;
}): Promise<string> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ id: string }>(
    `insert into notifications
       (id, workspace_id, recipient_member_id, subject_type, subject_id,
        reason, channel)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, 'app')
     returning id`,
    [
      workspaceId,
      input.recipientMemberId,
      input.subjectType,
      input.subjectId,
      input.reason,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("insert into notifications returned no row");
  }
  return row.id;
}

/**
 * A blob context the owner can reach and nobody else can.
 *
 * "blob" rather than a synthetic type for the reason `notifications.test.ts`
 * records at length: `SUBJECT_RESOLVERS` is exhaustive and fail-closed, so an
 * unregistered type would make every access check answer "no" and this file
 * would pass for the wrong reason.
 */
async function grantOnNewBlob(
  memberId: string,
  resourceId: string,
): Promise<void> {
  const wb = await workerDb();
  await runOperation(
    { pool: wb.appPool },
    {
      action: "test.grant-view",
      workspaceId,
      actor: { kind: "human", userId: OWNER },
      async execute({ tx }) {
        const contextId = await ensureContext(tx, {
          workspaceId,
          resourceType: "blob",
          resourceId,
        });
        const groupId = await ensureMemberGroup(tx, { workspaceId, memberId });
        await bindGroup(tx, {
          workspaceId,
          groupId,
          contextId,
          level: ACCESS_LEVELS.view,
        });
        return {
          result: contextId,
          activity: {
            kind: "test.grant-view",
            subjectType: "blob",
            subjectId: resourceId,
          },
          audit: { action: "test.grant-view", targetType: "blob" },
        };
      },
    },
  );
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Inbox Owner",
      "inbox-owner@example.com",
      OTHER,
      "Inbox Other",
      "inbox-other@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Inbox Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("notifications.list", () => {
  it("carries the subject the row was written with", async () => {
    const subjectId = "11111111-1111-4111-8111-111111111111";
    await grantOnNewBlob(ownerMemberId, subjectId);
    await writeNotification({
      recipientMemberId: ownerMemberId,
      subjectType: "blob",
      subjectId,
      reason: "mentioned",
    });

    const rows = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.list",
      {},
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.subjectType).toBe("blob");
    expect(rows[0]?.subjectId).toBe(subjectId);
  });

  it("does not list a subject the reader cannot reach", async () => {
    // The leak this closes: a notification outlives the access that produced
    // it, so somebody removed from a space keeps rows naming its goals.
    const reachable = "22222222-2222-4222-8222-222222222222";
    const unreachable = "33333333-3333-4333-8333-333333333333";
    await grantOnNewBlob(ownerMemberId, reachable);
    // A context exists for the second blob and the owner holds nothing on it.
    await grantOnNewBlob(await addOtherMember(), unreachable);
    await writeNotification({
      recipientMemberId: ownerMemberId,
      subjectType: "blob",
      subjectId: reachable,
      reason: "mentioned",
    });
    await writeNotification({
      recipientMemberId: ownerMemberId,
      subjectType: "blob",
      subjectId: unreachable,
      reason: "mentioned",
    });

    const rows = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.list",
      {},
    );

    expect(rows.map((row) => row.subjectId)).toEqual([reachable]);
  });

  it("lists a subject type the access getter has never heard of", async () => {
    // Every nudge in the product is about one of these: a check-in, a blocker,
    // a KPI, a session, a cycle or the member themselves. None has a context of
    // its own, so `resolveSubjectContext` raises for all six. Failing closed
    // there would empty the inbox of the product's own proactive messages,
    // which is the opposite of what this screen is for.
    await writeNotification({
      recipientMemberId: ownerMemberId,
      subjectType: "check_in",
      subjectId: "44444444-4444-4444-8444-444444444444",
      reason: "check_in",
    });

    const rows = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.list",
      {},
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.subjectType).toBe("check_in");
  });

  it("parses every reason the table allows", async () => {
    // The output schema listed four of the six until P6-G07a. Nothing
    // validated it, so a `review` or `check_in` row passed through a schema
    // that did not describe it and any client that did validate would have
    // rejected the two reasons that matter most.
    const reasons = [
      "invited",
      "joined",
      "mentioned",
      "role",
      "review",
      "check_in",
    ];
    for (const reason of reasons) {
      await writeNotification({
        recipientMemberId: ownerMemberId,
        subjectType: null,
        subjectId: null,
        reason,
      });
    }

    const rows = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.list",
      {},
    );

    expect(rows).toHaveLength(reasons.length);
    expect([...rows.map((row) => row.reason)].sort()).toEqual(
      [...reasons].sort(),
    );
  });

  it("filters by one reason", async () => {
    await writeNotification({
      recipientMemberId: ownerMemberId,
      subjectType: null,
      subjectId: null,
      reason: "mentioned",
    });
    await writeNotification({
      recipientMemberId: ownerMemberId,
      subjectType: null,
      subjectId: null,
      reason: "review",
    });

    const rows = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.list",
      { reason: "review" },
    );

    expect(rows.map((row) => row.reason)).toEqual(["review"]);
  });

  it("says whether the reader is watching the subject", async () => {
    const subjectId = "55555555-5555-4555-8555-555555555555";
    await grantOnNewBlob(ownerMemberId, subjectId);
    await writeNotification({
      recipientMemberId: ownerMemberId,
      subjectType: "blob",
      subjectId,
      reason: "mentioned",
    });

    const before = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.list",
      {},
    );
    expect(before[0]?.watching).toBe(false);

    await callAction(
      { pool: await pool(), ...context(OWNER) },
      "subscriptions.toggle",
      { subjectType: "blob", subjectId, subscribe: true },
    );

    const after = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.list",
      {},
    );
    expect(after[0]?.watching).toBe(true);

    // Mute cancels rather than deletes, so the row stays and stops being
    // watched. Both halves matter: a mute that removed the history would be
    // deleting what happened, not stopping what is next.
    await callAction(
      { pool: await pool(), ...context(OWNER) },
      "subscriptions.toggle",
      { subjectType: "blob", subjectId, subscribe: false },
    );
    const muted = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.list",
      {},
    );
    expect(muted).toHaveLength(1);
    expect(muted[0]?.watching).toBe(false);
  });

  it("hides a snoozed row and keeps it out of the badge", async () => {
    const id = await writeNotification({
      recipientMemberId: ownerMemberId,
      subjectType: null,
      subjectId: null,
      reason: "mentioned",
    });

    const before = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.unreadCount",
      {},
    );
    expect(before.unread).toBe(1);

    await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.snooze",
      { notificationId: id, untilMinutes: 60 },
    );

    const rows = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.list",
      {},
    );
    expect(rows).toEqual([]);

    const after = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.unreadCount",
      {},
    );
    expect(after.unread).toBe(0);
  });
});

describe("notifications.unreadCount", () => {
  it("clears when the row is read", async () => {
    const id = await writeNotification({
      recipientMemberId: ownerMemberId,
      subjectType: null,
      subjectId: null,
      reason: "mentioned",
    });

    await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.markRead",
      { notificationId: id },
    );

    const { unread } = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.unreadCount",
      {},
    );
    expect(unread).toBe(0);
  });

  it("counts nothing for somebody who is not a member", async () => {
    const { unread } = await callAction(
      { pool: await pool(), ...context(OTHER) },
      "notifications.unreadCount",
      {},
    );
    expect(unread).toBe(0);
  });
});

/** A second member, so a context can be granted to somebody who is not OWNER. */
async function addOtherMember(): Promise<string> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, 'Inbox Other', 'human', 'active')
     returning id`,
    [workspaceId, OTHER],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("insert into workspace_members returned no row");
  }
  return row.id;
}
