import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { OutboxRelay } from "../src/relay.ts";

/**
 * The outbox relay (TECHNICAL-PLAN §5, "the outbox contract").
 *
 * The acceptance criterion for P1-T04 lives here: a rolled back write
 * delivers nothing, a committed one is delivered exactly once per
 * idempotency key across relay retries.
 */

const enqueue = async (
  admin: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  topic: string,
  key: string,
  payload: Record<string, unknown> = {},
  /** Seconds to subtract from now, so a test can order rows deliberately.
   * Rows inserted back to back can share a `created_at`, and the relay makes
   * no promise about the order of rows created in the same instant. */
  ageSeconds?: number,
) => {
  await admin.query(
    `insert into outbox (topic, payload, idempotency_key, created_at)
     values ($1, $2::jsonb, $3, now() - make_interval(secs => $4::double precision))`,
    [topic, JSON.stringify(payload), key, ageSeconds ?? 0],
  );
};

interface Delivered {
  readonly topic: string;
  readonly idempotencyKey: string;
}

const collector = () => {
  const delivered: Delivered[] = [];
  return {
    delivered,
    dispatch: async (message: { topic: string; idempotencyKey: string }) => {
      delivered.push({
        topic: message.topic,
        idempotencyKey: message.idempotencyKey,
      });
    },
  };
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("OutboxRelay", () => {
  it("delivers a committed row exactly once, even when drained repeatedly", async () => {
    const wb = await workerDb();
    await enqueue(wb.admin, "goal.published", "goal.published:g1");

    const sink = collector();
    const relay = new OutboxRelay(wb.admin, { dispatch: sink.dispatch });

    expect(await relay.drainOnce()).toBe(1);
    expect(await relay.drainOnce()).toBe(0);
    expect(await relay.drainOnce()).toBe(0);

    expect(sink.delivered).toEqual([
      { topic: "goal.published", idempotencyKey: "goal.published:g1" },
    ]);

    const row = await wb.admin.query(
      "select delivered_at, attempts from outbox",
    );
    expect(row.rows[0].delivered_at).toBeInstanceOf(Date);
    expect(row.rows[0].attempts).toBe(1);
  });

  it("delivers nothing for a write that rolled back", async () => {
    const wb = await workerDb();
    const client = await wb.admin.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into outbox (topic, payload, idempotency_key) values ($1, '{}'::jsonb, $2)",
        ["goal.published", "goal.published:rolled-back"],
      );
      await client.query("rollback");
    } finally {
      client.release();
    }

    const sink = collector();
    const relay = new OutboxRelay(wb.admin, { dispatch: sink.dispatch });

    expect(await relay.drainOnce()).toBe(0);
    expect(sink.delivered).toEqual([]);
  });

  it("does not deliver a row while its transaction is still open", async () => {
    const wb = await workerDb();
    const client = await wb.admin.connect();
    const sink = collector();
    const relay = new OutboxRelay(wb.admin, { dispatch: sink.dispatch });
    try {
      await client.query("begin");
      await client.query(
        "insert into outbox (topic, payload, idempotency_key) values ($1, '{}'::jsonb, $2)",
        ["goal.published", "goal.published:uncommitted"],
      );

      // The row exists, but only inside the open transaction.
      expect(await relay.drainOnce()).toBe(0);
      expect(sink.delivered).toEqual([]);

      await client.query("commit");
    } finally {
      client.release();
    }

    // Once committed, the same relay picks it up.
    expect(await relay.drainOnce()).toBe(1);
    expect(sink.delivered).toHaveLength(1);
  });

  it("keeps a failed row pending and retries it later", async () => {
    const wb = await workerDb();
    await enqueue(wb.admin, "mail.send", "mail.send:1");

    let attempt = 0;
    const relay = new OutboxRelay(wb.admin, {
      // Zero backoff so the retry is due immediately in the test.
      backoffSeconds: () => 0,
      dispatch: async () => {
        attempt++;
        if (attempt === 1) {
          throw new Error("the provider was unreachable");
        }
      },
    });

    expect(await relay.drainOnce()).toBe(0);

    const pending = await wb.admin.query(
      "select delivered_at, attempts, last_error from outbox",
    );
    expect(pending.rows[0].delivered_at).toBeNull();
    expect(pending.rows[0].attempts).toBe(1);
    expect(pending.rows[0].last_error).toMatch(/unreachable/);

    expect(await relay.drainOnce()).toBe(1);
    const done = await wb.admin.query(
      "select delivered_at, attempts from outbox",
    );
    expect(done.rows[0].delivered_at).toBeInstanceOf(Date);
    expect(done.rows[0].attempts).toBe(2);
  });

  it("holds a failed row back until its backoff expires", async () => {
    const wb = await workerDb();
    await enqueue(wb.admin, "mail.send", "mail.send:backoff");

    const relay = new OutboxRelay(wb.admin, {
      backoffSeconds: () => 3600,
      dispatch: async () => {
        throw new Error("still failing");
      },
    });

    expect(await relay.drainOnce()).toBe(0);
    // Second drain finds nothing due: the row is parked for an hour.
    expect(await relay.drainOnce()).toBe(0);
    const row = await wb.admin.query("select attempts from outbox");
    expect(row.rows[0].attempts).toBe(1);
  });

  it("delivers each row once when several relays drain concurrently", async () => {
    const wb = await workerDb();
    for (let i = 0; i < 20; i++) {
      await enqueue(wb.admin, "goal.published", `goal.published:g${i}`);
    }

    const sink = collector();
    const relays = Array.from(
      { length: 4 },
      () =>
        new OutboxRelay(wb.admin, { dispatch: sink.dispatch, batchSize: 5 }),
    );

    // Drain repeatedly and concurrently: rows are claimed with FOR UPDATE
    // SKIP LOCKED, so no row may be handed to two relays.
    for (let round = 0; round < 3; round++) {
      await Promise.all(relays.map((relay) => relay.drainOnce()));
    }

    const keys = sink.delivered.map((d) => d.idempotencyKey).sort();
    expect(keys).toHaveLength(20);
    expect(new Set(keys).size).toBe(20);
  });

  it("drains in batches, oldest first", async () => {
    const wb = await workerDb();
    // Explicit ages, so this asserts the ordering rule rather than the
    // accident of three inserts landing in different microseconds.
    await enqueue(wb.admin, "t", "first", {}, 30);
    await enqueue(wb.admin, "t", "second", {}, 20);
    await enqueue(wb.admin, "t", "third", {}, 10);

    const sink = collector();
    const relay = new OutboxRelay(wb.admin, {
      dispatch: sink.dispatch,
      batchSize: 2,
    });

    expect(await relay.drainOnce()).toBe(2);
    expect(sink.delivered.map((d) => d.idempotencyKey)).toEqual([
      "first",
      "second",
    ]);
    expect(await relay.drainOnce()).toBe(1);
    expect(sink.delivered.map((d) => d.idempotencyKey)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("passes the topic and payload through to the dispatcher", async () => {
    const wb = await workerDb();
    await enqueue(wb.admin, "notification.queued", "n:1", {
      memberId: "m1",
      count: 3,
    });

    const seen: Record<string, unknown>[] = [];
    const relay = new OutboxRelay(wb.admin, {
      dispatch: async (message) => {
        seen.push({
          topic: message.topic,
          payload: message.payload,
          id: message.id,
        });
      },
    });
    await relay.drainOnce();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      topic: "notification.queued",
      payload: { memberId: "m1", count: 3 },
    });
    expect(seen[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("start and stop drive the drain loop without overlapping runs", async () => {
    const wb = await workerDb();
    await enqueue(wb.admin, "t", "loop-1");

    const sink = collector();
    const relay = new OutboxRelay(wb.admin, {
      dispatch: sink.dispatch,
      pollIntervalMs: 10,
    });

    relay.start();
    await new Promise((resolve) => setTimeout(resolve, 120));
    await relay.stop();

    expect(sink.delivered).toHaveLength(1);

    // Stopped means stopped: a new row is not picked up.
    await enqueue(wb.admin, "t", "loop-2");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(sink.delivered).toHaveLength(1);
  });
});
