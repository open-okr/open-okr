import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  bindGroup,
  ensureContext,
  ensureMemberGroup,
} from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { callAction } from "../src/actions/registry.ts";
import { digestItemsFor } from "../src/notifications/digest.ts";
import { DIGEST_TOPIC } from "../src/notifications/drain.ts";
import { renderDigest } from "../src/notifications/templates.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The notification batch drain and the digest it sends (P6-G01b).
 *
 * **No batch had ever been delivered.** P2-T06 built the coalescing, the
 * settings and the template, and said so in its own file: "nothing dispatches a
 * `pending` batch or an unsent immediate row yet". Nothing did, for four months
 * and nine tasks, and `renderDigest` had no caller outside the package barrel.
 * A member who set a thirty-minute window received nothing at all. The gap
 * audit recorded it as the second half of B-01.
 *
 * The acceptance criterion is the second test here: four notifications inside
 * one window deliver as one digest listing four items, and the batch is marked
 * sent exactly once.
 */

const OWNER = "digest-owner";
const BASE = "https://okr.example.com";

let workspaceId: string;
let ownerMemberId: string;

function context(userId: string) {
  return { workspaceId, actor: { kind: "human" as const, userId } };
}

async function pool() {
  return (await workerDb()).appPool;
}

async function withTx<T>(fn: (tx: never) => Promise<T>): Promise<T> {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, fn as never);
}

/**
 * A batch whose window closed `minutesAgo` minutes ago.
 *
 * Plain `now()` rather than `now() at time zone 'UTC'`, and the difference is
 * not cosmetic. `send_at` is `timestamptz`; `at time zone 'UTC'` produces a
 * timestamp *without* a zone, which the column then reads in the server's own
 * zone. On a machine at UTC+7 that moves the value seven hours earlier, so a
 * batch written twenty minutes in the future arrived six hours in the past and
 * the drain claimed it. Caught by the one test here that asserts a window is
 * left alone.
 */
async function openBatch(minutesAgo: number): Promise<string> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ id: string }>(
    `insert into notification_batches
       (id, workspace_id, member_id, channel, status, window_minutes, send_at)
     values (gen_random_uuid(), $1, $2, 'email', 'pending', 10,
             now() - ($3 || ' minutes')::interval)
     returning id`,
    [workspaceId, ownerMemberId, String(minutesAgo)],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("insert into notification_batches returned no row");
  }
  return row.id;
}

async function addToBatch(
  batchId: string | null,
  input: {
    subjectType: string | null;
    subjectId: string | null;
    reason: string;
  },
): Promise<string> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ id: string }>(
    `insert into notifications
       (id, workspace_id, recipient_member_id, batch_id, subject_type,
        subject_id, reason, channel)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'email')
     returning id`,
    [
      workspaceId,
      ownerMemberId,
      batchId,
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

/** A blob context, granted to whoever is named. "blob" because it is real. */
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

async function outboxRows(): Promise<
  readonly { topic: string; idempotency_key: string }[]
> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    topic: string;
    idempotency_key: string;
  }>("select topic, idempotency_key from outbox order by created_at");
  return rows;
}

async function batchStatus(id: string): Promise<string> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ status: string }>(
    "select status from notification_batches where id = $1",
    [id],
  );
  return rows[0]?.status ?? "missing";
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Digest Owner", "digest-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Digest Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("notifications.drainBatches", () => {
  it("leaves a window that has not closed alone", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into notification_batches
         (id, workspace_id, member_id, channel, status, window_minutes, send_at)
       values (gen_random_uuid(), $1, $2, 'email', 'pending', 30,
               now() + interval '20 minutes')`,
      [workspaceId, ownerMemberId],
    );

    const result = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.drainBatches",
      {},
    );

    expect(result.claimed).toBe(0);
    expect(result.waiting).toBe(1);
    expect(
      (await outboxRows()).filter((row) => row.topic === DIGEST_TOPIC),
    ).toEqual([]);
  });

  it("claims a closed window once and enqueues one digest", async () => {
    // The acceptance criterion. Four notifications, one window, one digest.
    const batchId = await openBatch(1);
    const subjectId = "11111111-1111-4111-8111-111111111111";
    await grantOnNewBlob(ownerMemberId, subjectId);
    for (let index = 0; index < 4; index++) {
      await addToBatch(batchId, {
        subjectType: "blob",
        subjectId,
        reason: "mentioned",
      });
    }

    const first = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.drainBatches",
      {},
    );
    expect(first.claimed).toBe(1);
    expect(first.waiting).toBe(0);
    expect(await batchStatus(batchId)).toBe("sent");

    const enqueued = (await outboxRows()).filter(
      (row) => row.topic === DIGEST_TOPIC,
    );
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.idempotency_key).toBe(`${DIGEST_TOPIC}:${batchId}`);

    // The four items are what the handler will render, and they are four.
    const contents = await withTx((tx) =>
      digestItemsFor(tx, {
        workspaceId,
        memberId: ownerMemberId,
        batchId,
        baseUrl: BASE,
      }),
    );
    expect(contents.items).toHaveLength(4);
    expect(renderDigest({ items: contents.items }).subject).toBe("4 updates");
  });

  it("a second pass claims nothing, which is what two hosts do", async () => {
    // The whole of the idempotence. The claim is a conditional update from
    // pending, so the second caller matches no row rather than sending a
    // second copy. Two passes in sequence is the same statement two hosts
    // race on.
    const batchId = await openBatch(1);
    await addToBatch(batchId, {
      subjectType: null,
      subjectId: null,
      reason: "joined",
    });

    const first = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.drainBatches",
      {},
    );
    const second = await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.drainBatches",
      {},
    );

    expect(first.claimed).toBe(1);
    expect(second.claimed).toBe(0);
    expect(
      (await outboxRows()).filter((row) => row.topic === DIGEST_TOPIC),
    ).toHaveLength(1);
    expect(await batchStatus(batchId)).toBe("sent");
  });
});

describe("digestItemsFor", () => {
  it("leaves out an item the reader can no longer reach", async () => {
    // A batch enqueued while somebody could see a subject, read after they
    // could not. The digest is mail: once it is out, the title is out.
    const batchId = await openBatch(1);
    const reachable = "22222222-2222-4222-8222-222222222222";
    const unreachable = "33333333-3333-4333-8333-333333333333";
    await grantOnNewBlob(ownerMemberId, reachable);
    const wb = await workerDb();
    const other = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, name, kind, status)
       values (gen_random_uuid(), $1, 'Other', 'human', 'active')
       returning id`,
      [workspaceId],
    );
    await grantOnNewBlob(other.rows[0]?.id as string, unreachable);
    await addToBatch(batchId, {
      subjectType: "blob",
      subjectId: reachable,
      reason: "mentioned",
    });
    await addToBatch(batchId, {
      subjectType: "blob",
      subjectId: unreachable,
      reason: "mentioned",
    });

    const contents = await withTx((tx) =>
      digestItemsFor(tx, {
        workspaceId,
        memberId: ownerMemberId,
        batchId,
        baseUrl: BASE,
      }),
    );

    expect(contents.items).toHaveLength(1);
    // A blob has no page of its own, so the surviving line falls back to the
    // workspace root rather than being dropped or pointed at a 404.
    expect(contents.items[0]?.link).toBe(`${BASE}/`);
  });

  it("links each item to its own subject", async () => {
    const batchId = await openBatch(1);
    // A session rather than a goal, and the reason is worth writing down. The
    // first draft used a goal id that named no goal, and the access filter
    // correctly dropped the row: `goal` has a resolver, so an id that resolves
    // to nothing is indistinguishable from one the reader may not see. A
    // session has no resolver, so the workspace floor decides and the row
    // survives, which is what makes this a test of the link and not of the
    // filter.
    const sessionId = "44444444-4444-4444-8444-444444444444";
    await addToBatch(batchId, {
      subjectType: "session",
      subjectId: sessionId,
      reason: "check_in",
    });

    const contents = await withTx((tx) =>
      digestItemsFor(tx, {
        workspaceId,
        memberId: ownerMemberId,
        batchId,
        baseUrl: `${BASE}/`,
      }),
    );

    // The trailing slash on the base is trimmed rather than doubled, which is
    // the failure that would have shipped in every mail the product sends.
    expect(contents.items[0]?.link).toBe(`${BASE}/session/${sessionId}`);
    expect(contents.items[0]?.summary).toBe("A reminder is waiting for you.");
  });

  it("caps the list and says how many it left", async () => {
    const batchId = await openBatch(1);
    for (let index = 0; index < 23; index++) {
      await addToBatch(batchId, {
        subjectType: null,
        subjectId: null,
        reason: "joined",
      });
    }

    const contents = await withTx((tx) =>
      digestItemsFor(tx, {
        workspaceId,
        memberId: ownerMemberId,
        batchId,
        baseUrl: BASE,
        limit: 20,
      }),
    );

    expect(contents.items).toHaveLength(20);
    // One more than the limit is read, so this says "there is more" rather
    // than the exact remainder. A digest that promised a precise count would
    // need a second query for a number nobody acts on.
    expect(contents.omitted).toBeGreaterThan(0);
  });

  it("takes the member's unread rows when no batch is named", async () => {
    // The daily summary's source. Same builder, different collection.
    const read = await addToBatch(null, {
      subjectType: null,
      subjectId: null,
      reason: "joined",
    });
    await addToBatch(null, {
      subjectType: null,
      subjectId: null,
      reason: "mentioned",
    });
    await callAction(
      { pool: await pool(), ...context(OWNER) },
      "notifications.markRead",
      { notificationId: read },
    );

    const contents = await withTx((tx) =>
      digestItemsFor(tx, {
        workspaceId,
        memberId: ownerMemberId,
        unreadOnly: true,
        baseUrl: BASE,
      }),
    );

    expect(contents.items).toHaveLength(1);
    expect(contents.items[0]?.summary).toBe("You were mentioned.");
  });
});
