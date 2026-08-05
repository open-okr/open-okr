import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueOutbox } from "../src/outbox.ts";
import { withWorkspace } from "../src/tenant.ts";

/**
 * The outbox insert helper (TECHNICAL-PLAN §5, "the outbox contract").
 *
 * The property that matters is atomicity with the caller's write: a rolled
 * back transaction must leave no trace, so a side effect can never fire for
 * a change that did not happen.
 */

const WORKSPACE = "55555555-5555-4555-8555-555555555555";

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("enqueueOutbox", () => {
  it("writes a pending row inside the caller's transaction", async () => {
    const wb = await workerDb();
    await withWorkspace(wb.db, WORKSPACE, async (tx) => {
      await enqueueOutbox(tx, {
        topic: "goal.published",
        payload: { goalId: "g1" },
        idempotencyKey: "goal.published:g1",
      });
    });

    const rows = await wb.admin.query("select * from outbox");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      topic: "goal.published",
      payload: { goalId: "g1" },
      idempotency_key: "goal.published:g1",
      delivered_at: null,
      attempts: 0,
    });
  });

  it("leaves nothing behind when the caller's transaction rolls back", async () => {
    const wb = await workerDb();
    await expect(
      withWorkspace(wb.db, WORKSPACE, async (tx) => {
        await enqueueOutbox(tx, {
          topic: "goal.published",
          payload: { goalId: "g1" },
          idempotencyKey: "goal.published:g1",
        });
        throw new Error("the write failed after enqueueing");
      }),
    ).rejects.toThrow("the write failed after enqueueing");

    const rows = await wb.admin.query("select count(*)::int as n from outbox");
    expect(rows.rows[0].n).toBe(0);
  });

  it("refuses a duplicate idempotency key", async () => {
    const wb = await workerDb();
    const enqueue = () =>
      withWorkspace(wb.db, WORKSPACE, (tx) =>
        enqueueOutbox(tx, {
          topic: "goal.published",
          payload: {},
          idempotencyKey: "same-key",
        }),
      );

    await enqueue();
    await expect(enqueue()).rejects.toThrow();

    const rows = await wb.admin.query("select count(*)::int as n from outbox");
    expect(rows.rows[0].n).toBe(1);
  });

  it("enqueues several side effects in one transaction", async () => {
    const wb = await workerDb();
    await withWorkspace(wb.db, WORKSPACE, async (tx) => {
      await enqueueOutbox(tx, {
        topic: "goal.published",
        payload: {},
        idempotencyKey: "a",
      });
      await enqueueOutbox(tx, {
        topic: "notification.queued",
        payload: {},
        idempotencyKey: "b",
      });
    });

    const rows = await wb.admin.query(
      "select topic from outbox order by topic",
    );
    expect(rows.rows.map((r) => r.topic)).toEqual([
      "goal.published",
      "notification.queued",
    ]);
  });

  it("rejects an empty topic or idempotency key before touching the database", async () => {
    const wb = await workerDb();
    await expect(
      withWorkspace(wb.db, WORKSPACE, (tx) =>
        enqueueOutbox(tx, { topic: "  ", payload: {}, idempotencyKey: "k" }),
      ),
    ).rejects.toThrow(/topic/i);

    await expect(
      withWorkspace(wb.db, WORKSPACE, (tx) =>
        enqueueOutbox(tx, { topic: "t", payload: {}, idempotencyKey: "" }),
      ),
    ).rejects.toThrow(/idempotency/i);
  });

  it("returns the row id so a caller can correlate it", async () => {
    const wb = await workerDb();
    const id = await withWorkspace(wb.db, WORKSPACE, (tx) =>
      enqueueOutbox(tx, { topic: "t", payload: {}, idempotencyKey: "k" }),
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
