import { type WorkspaceTx, withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  bindGroup,
  ensureContext,
  ensureMemberGroup,
} from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { ensurePendingBatch } from "../src/notifications/batching.ts";
import { notifyRecipients } from "../src/notifications/create.ts";
import { resolveRecipients } from "../src/notifications/recipients.ts";
import { getOrCreateNotificationSettings } from "../src/notifications/settings.ts";
import {
  ensureSubscriptionList,
  listSubscribers,
  reconcileMentions,
  subscribeMember,
} from "../src/notifications/subscriptions.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Subscriptions and the notification spine (P2-T06 test plan,
 * TECHNICAL-PLAN §4.10, §4.11).
 *
 * A mention delivers immediately when opted; three rapid batch requests for
 * the same member and channel coalesce into one row even issued
 * concurrently; a recipient who has lost access is excluded at resolution
 * time; un-mentioning on edit stops that one subscription while a watcher
 * subscribed for a different reason keeps theirs; and the suppression flag
 * silences a bulk operation outright.
 */

const OWNER = "notif-owner";

let workspaceId: string;

async function withReadTx<T>(fn: (tx: WorkspaceTx) => Promise<T>): Promise<T> {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, fn);
}

async function addMember(name: string): Promise<string> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, 'human', 'active')
     returning id`,
    [workspaceId, name],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("insert into workspace_members returned no row");
  }
  return row.id;
}

/** Gives a member view access to a fresh context, so resolveRecipients keeps them. */
async function grantViewOnNewContext(
  memberId: string,
  resourceId: string,
): Promise<string> {
  const wb = await workerDb();
  return runOperation(
    { pool: wb.appPool },
    {
      action: "test.grant-view",
      workspaceId,
      actor: { kind: "human", userId: OWNER },
      async execute({ tx }) {
        const contextId = await ensureContext(tx, {
          workspaceId,
          resourceType: "test-aggregate",
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
            subjectType: "test-aggregate",
            subjectId: resourceId,
          },
          audit: { action: "test.grant-view", targetType: "test-aggregate" },
        };
      },
    },
  );
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Notif Owner", "notif-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Notif Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("notification settings default to TECHNICAL-PLAN §11's worked example", () => {
  it("resolves mention-immediate, a thirty-minute batch window and an 08:00 daily summary with no row ever written first", async () => {
    const member = await addMember("Member");
    const settings = await withReadTx((tx) =>
      getOrCreateNotificationSettings(tx, workspaceId, member),
    );
    expect(settings.mentionImmediate).toBe(true);
    expect(settings.batchWindowMinutes).toBe(30);
    expect(settings.dailySummary).toBe(true);
    expect(settings.dailySummaryTime).toBe("08:00");
  });
});

describe("a mention delivers immediately when opted", () => {
  it("creates an unbatched notification row for a mentioned, subscribed, access-holding member", async () => {
    const member = await addMember("Member");
    await grantViewOnNewContext(member, "doc-1");

    const wb = await workerDb();
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.notify",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const listId = await ensureSubscriptionList(tx, {
            workspaceId,
            subjectType: "test-aggregate",
            subjectId: "doc-1",
          });
          await subscribeMember(tx, {
            workspaceId,
            listId,
            memberId: member,
            reason: "mentioned",
          });
          const recipients = await resolveRecipients(tx, {
            workspaceId,
            subjectType: "test-aggregate",
            subjectId: "doc-1",
          });
          const outcome = await notifyRecipients(tx, {
            workspaceId,
            subjectType: "test-aggregate",
            subjectId: "doc-1",
            recipients,
          });
          return {
            result: outcome,
            activity: {
              kind: "test.notify",
              subjectType: "test-aggregate",
              subjectId: "doc-1",
            },
            audit: { action: "test.notify", targetType: "test-aggregate" },
          };
        },
      },
    );

    const rows = await wb.admin.query(
      "select reason, batch_id from notifications where recipient_member_id = $1",
      [member],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].reason).toBe("mentioned");
    expect(rows.rows[0].batch_id).toBeNull();
  });
});

describe("batching coalesces bursts without duplicating under concurrency", () => {
  it("returns the same batch for three concurrent requests for the same member and channel", async () => {
    const member = await addMember("Member");

    // Three separate transactions, not three calls sharing one: a shared
    // transaction would see its own uncommitted insert on the second and
    // third call and never actually race the unique index. Separate
    // transactions are what "found or created under a row lock" is
    // actually claiming to survive.
    const attempt = () =>
      withReadTx((tx) =>
        ensurePendingBatch(tx, {
          workspaceId,
          memberId: member,
          channel: "email",
          windowMinutes: 30,
        }),
      );
    const results = await Promise.all([attempt(), attempt(), attempt()]);

    expect(new Set(results).size).toBe(1);

    const wb = await workerDb();
    const rows = await wb.admin.query(
      "select count(*)::int as n from notification_batches where member_id = $1 and status = 'pending'",
      [member],
    );
    expect(rows.rows[0].n).toBe(1);
  });
});

describe("recipient resolution excludes a member who has lost access", () => {
  it("keeps a subscriber with access and drops one without", async () => {
    const withAccess = await addMember("With Access");
    const withoutAccess = await addMember("Without Access");
    await grantViewOnNewContext(withAccess, "doc-2");
    // withoutAccess is never granted a binding on doc-2's context.

    const wb = await workerDb();
    const recipients = await runOperation(
      { pool: wb.appPool },
      {
        action: "test.subscribe-both",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const listId = await ensureSubscriptionList(tx, {
            workspaceId,
            subjectType: "test-aggregate",
            subjectId: "doc-2",
          });
          await subscribeMember(tx, {
            workspaceId,
            listId,
            memberId: withAccess,
            reason: "joined",
          });
          await subscribeMember(tx, {
            workspaceId,
            listId,
            memberId: withoutAccess,
            reason: "joined",
          });
          const resolved = await resolveRecipients(tx, {
            workspaceId,
            subjectType: "test-aggregate",
            subjectId: "doc-2",
          });
          return {
            result: resolved,
            activity: {
              kind: "test.subscribe-both",
              subjectType: "test-aggregate",
              subjectId: "doc-2",
            },
            audit: {
              action: "test.subscribe-both",
              targetType: "test-aggregate",
            },
          };
        },
      },
    );

    expect(recipients.map((r) => r.memberId)).toEqual([withAccess]);
  });

  it("never includes the excluded author, even when they are subscribed", async () => {
    const author = await addMember("Author");
    await grantViewOnNewContext(author, "doc-3");

    const wb = await workerDb();
    const recipients = await runOperation(
      { pool: wb.appPool },
      {
        action: "test.subscribe-author",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const listId = await ensureSubscriptionList(tx, {
            workspaceId,
            subjectType: "test-aggregate",
            subjectId: "doc-3",
          });
          await subscribeMember(tx, {
            workspaceId,
            listId,
            memberId: author,
            reason: "joined",
          });
          const resolved = await resolveRecipients(tx, {
            workspaceId,
            subjectType: "test-aggregate",
            subjectId: "doc-3",
            excludeMemberId: author,
          });
          return {
            result: resolved,
            activity: {
              kind: "test.subscribe-author",
              subjectType: "test-aggregate",
              subjectId: "doc-3",
            },
            audit: {
              action: "test.subscribe-author",
              targetType: "test-aggregate",
            },
          };
        },
      },
    );

    expect(recipients).toEqual([]);
  });
});

describe("re-diffing mentions on edit", () => {
  it("stops a removed mention's subscription but keeps an unrelated watcher's", async () => {
    const mentionedA = await addMember("Mentioned A");
    const mentionedB = await addMember("Mentioned B");
    const watcher = await addMember("Watcher");

    const wb = await workerDb();
    const listId = await runOperation(
      { pool: wb.appPool },
      {
        action: "test.mention-setup",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const list = await ensureSubscriptionList(tx, {
            workspaceId,
            subjectType: "test-aggregate",
            subjectId: "doc-4",
          });
          await reconcileMentions(tx, {
            workspaceId,
            listId: list,
            mentionedMemberIds: [mentionedA, mentionedB],
          });
          await subscribeMember(tx, {
            workspaceId,
            listId: list,
            memberId: watcher,
            reason: "joined",
          });
          return {
            result: list,
            activity: {
              kind: "test.mention-setup",
              subjectType: "test-aggregate",
              subjectId: "doc-4",
            },
            audit: {
              action: "test.mention-setup",
              targetType: "test-aggregate",
            },
          };
        },
      },
    );

    const before = await withReadTx((tx) =>
      listSubscribers(tx, workspaceId, listId),
    );
    expect(before.map((s) => s.memberId).sort()).toEqual(
      [mentionedA, mentionedB, watcher].sort(),
    );

    // Edit removes B from the content, leaving only A mentioned.
    await withReadTx((tx) =>
      reconcileMentions(tx, {
        workspaceId,
        listId,
        mentionedMemberIds: [mentionedA],
      }),
    );

    const after = await withReadTx((tx) =>
      listSubscribers(tx, workspaceId, listId),
    );
    const afterIds = after.map((s) => s.memberId).sort();
    expect(afterIds).toEqual([mentionedA, watcher].sort());
  });
});

describe("the bulk-suppression flag", () => {
  it("creates nothing when suppress is set, regardless of how many recipients resolved", async () => {
    const member = await addMember("Member");
    await grantViewOnNewContext(member, "doc-5");

    const wb = await workerDb();
    const outcome = await runOperation(
      { pool: wb.appPool },
      {
        action: "test.suppressed-notify",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const listId = await ensureSubscriptionList(tx, {
            workspaceId,
            subjectType: "test-aggregate",
            subjectId: "doc-5",
          });
          await subscribeMember(tx, {
            workspaceId,
            listId,
            memberId: member,
            reason: "joined",
          });
          const recipients = await resolveRecipients(tx, {
            workspaceId,
            subjectType: "test-aggregate",
            subjectId: "doc-5",
          });
          const result = await notifyRecipients(tx, {
            workspaceId,
            subjectType: "test-aggregate",
            subjectId: "doc-5",
            recipients,
            suppress: true,
          });
          return {
            result,
            activity: {
              kind: "test.suppressed-notify",
              subjectType: "test-aggregate",
              subjectId: "doc-5",
            },
            audit: {
              action: "test.suppressed-notify",
              targetType: "test-aggregate",
            },
          };
        },
      },
    );

    expect(outcome).toEqual({ created: 0, immediate: 0, batched: 0 });
    const rows = await wb.admin.query(
      "select count(*)::int as n from notifications where recipient_member_id = $1",
      [member],
    );
    expect(rows.rows[0].n).toBe(0);
  });
});

describe("auto-subscribe excludes suspended, placeholder and agent members", () => {
  it("silently skips a suspended member rather than subscribing or erroring", async () => {
    const member = await addMember("Soon Suspended");
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [member],
    );

    const listId = await withReadTx((tx) =>
      ensureSubscriptionList(tx, {
        workspaceId,
        subjectType: "test-aggregate",
        subjectId: "doc-6",
      }),
    );
    await withReadTx((tx) =>
      subscribeMember(tx, {
        workspaceId,
        listId,
        memberId: member,
        reason: "joined",
      }),
    );

    const subscribers = await withReadTx((tx) =>
      listSubscribers(tx, workspaceId, listId),
    );
    expect(subscribers).toEqual([]);
  });
});
