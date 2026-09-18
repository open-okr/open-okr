import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { OutboxRelay, PermanentDispatchError } from "../src/relay.ts";

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

  it("dead-letters a row once it reaches the attempt ceiling, and stops retrying it (P1 hardening)", async () => {
    const wb = await workerDb();
    await enqueue(wb.admin, "mail.send", "mail.send:poison");

    let dispatches = 0;
    const deadLettered: string[] = [];
    const relay = new OutboxRelay(wb.admin, {
      backoffSeconds: () => 0,
      maxAttempts: 3,
      dispatch: async () => {
        dispatches++;
        throw new Error("permanently broken");
      },
      onDeadLetter: (record) => deadLettered.push(record.idempotencyKey),
    });

    // Two attempts, each still under the ceiling of 3: fail and stay pending.
    expect(await relay.drainOnce()).toBe(0);
    expect(await relay.drainOnce()).toBe(0);
    expect(dispatches).toBe(2);
    expect(deadLettered).toEqual([]);

    // The third attempt reaches maxAttempts: dead-lettered instead of retried.
    expect(await relay.drainOnce()).toBe(0);
    expect(dispatches).toBe(3);
    expect(deadLettered).toEqual(["mail.send:poison"]);

    const row = await wb.admin.query(
      "select dead_lettered_at, available_at from outbox",
    );
    expect(row.rows[0].dead_lettered_at).toBeInstanceOf(Date);

    // A poisoned row no longer competes for the relay's attention at all:
    // no further dispatch, no matter how many more times it drains.
    const dispatchesBefore = dispatches;
    expect(await relay.drainOnce()).toBe(0);
    expect(dispatches).toBe(dispatchesBefore);
  });

  it("dead-letters a permanent failure on its first attempt, without waiting for the ceiling (P5-T01a)", async () => {
    const wb = await workerDb();
    await enqueue(wb.admin, "nobody.consumes.this", "unhandled:1");

    let dispatches = 0;
    const deadLettered: string[] = [];
    const relay = new OutboxRelay(wb.admin, {
      backoffSeconds: () => 0,
      maxAttempts: 10,
      dispatch: async () => {
        dispatches++;
        throw new PermanentDispatchError("nothing handles this topic");
      },
      onDeadLetter: (record) => deadLettered.push(record.idempotencyKey),
    });

    // One attempt, nine short of the ceiling, and it is already given up on:
    // a topic nobody handles will not start being handled on the second try.
    expect(await relay.drainOnce()).toBe(0);
    expect(dispatches).toBe(1);
    expect(deadLettered).toEqual(["unhandled:1"]);

    const row = await wb.admin.query(
      "select dead_lettered_at, last_error from outbox",
    );
    expect(row.rows[0].dead_lettered_at).toBeInstanceOf(Date);
    expect(row.rows[0].last_error).toContain("nothing handles this topic");

    // And it stops competing for the relay entirely.
    expect(await relay.drainOnce()).toBe(0);
    expect(dispatches).toBe(1);
  });

  it("still retries an ordinary failure, so one permanent case does not make every failure fatal", async () => {
    const wb = await workerDb();
    await enqueue(wb.admin, "mail.send", "transient:1");

    let dispatches = 0;
    const deadLettered: string[] = [];
    const relay = new OutboxRelay(wb.admin, {
      backoffSeconds: () => 0,
      maxAttempts: 10,
      dispatch: async () => {
        dispatches++;
        throw new Error("the provider had a bad minute");
      },
      onDeadLetter: (record) => deadLettered.push(record.idempotencyKey),
    });

    expect(await relay.drainOnce()).toBe(0);
    expect(await relay.drainOnce()).toBe(0);
    expect(dispatches).toBe(2);
    expect(deadLettered).toEqual([]);
  });

  it("surfaces dead-lettered rows through listDeadLettered", async () => {
    const wb = await workerDb();
    await enqueue(wb.admin, "mail.send", "mail.send:dl-1");
    await enqueue(wb.admin, "mail.send", "mail.send:dl-2");

    const relay = new OutboxRelay(wb.admin, {
      backoffSeconds: () => 0,
      maxAttempts: 1,
      dispatch: async () => {
        throw new Error("nope");
      },
    });

    // One drain claims both rows in the same batch; each reaches maxAttempts
    // (1) on its first and only dispatch.
    await relay.drainOnce();

    const dead = await relay.listDeadLettered();
    expect(dead.map((d) => d.idempotencyKey).sort()).toEqual([
      "mail.send:dl-1",
      "mail.send:dl-2",
    ]);
    expect(dead[0]?.lastError).toMatch(/nope/);
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

/**
 * The fair read (P8-T06b). Design: `p8-t01a-tenant-limits.md` §5 and §8
 * criteria 4 and 7.
 *
 * These insert `workspace_id` directly rather than through a tenant
 * transaction, because the column's default reads `app.workspace_id` and
 * this suite talks to the database as the admin. What is under test is the
 * relay's read order, not where the column's value comes from.
 */
const enqueueFor = async (
  admin: { query: (text: string, values?: unknown[]) => Promise<unknown> },
  workspaceId: string | null,
  key: string,
  ageSeconds: number,
) => {
  await admin.query(
    `insert into outbox (topic, payload, idempotency_key, workspace_id, created_at)
     values ('t', '{}'::jsonb, $1, $2::uuid,
             now() - make_interval(secs => $3::double precision))`,
    [key, workspaceId, ageSeconds],
  );
};

const WS_A = "00000000-0000-4000-8000-00000000a001";
const WS_B = "00000000-0000-4000-8000-00000000b002";

describe("the relay is fair between workspaces", () => {
  it("does not put one workspace's nudge behind another's import", async () => {
    // **§8 criterion 4, and the whole reason this change exists.** Workspace
    // A wrote twenty rows, the way an import does. Workspace B then wrote
    // one. Oldest first would deliver all twenty before B's, which is how a
    // nudge arrives after an import that took an hour; not one of those rows
    // exceeded any limit, so no limiter could have helped.
    const wb = await workerDb();
    for (let n = 0; n < 20; n += 1) {
      await enqueueFor(wb.admin, WS_A, `import-${n}`, 600 - n);
    }
    await enqueueFor(wb.admin, WS_B, "nudge", 1);

    const sink = collector();
    const relay = new OutboxRelay(wb.appPool, {
      dispatch: sink.dispatch,
      batchSize: 5,
    });
    await relay.drainOnce();

    // Second in the batch: A's oldest row is rank 1 and B's only row is
    // rank 1 too, and A's is older, so A goes first and B goes next. Before
    // this change B was twenty-first.
    expect(sink.delivered[0]?.idempotencyKey).toBe("import-0");
    expect(sink.delivered[1]?.idempotencyKey).toBe("nudge");
  });

  it("delivers one workspace's rows at full speed when there is nobody to be fair to", async () => {
    // **§8 criterion 7.** Fairness that slowed a single-tenant instance down
    // would be a tax every self-hosted deployment paid for a problem it does
    // not have. With one workspace holding rows every rank is distinct and
    // ascending, so the order is exactly what it was before this change.
    const wb = await workerDb();
    for (let n = 0; n < 6; n += 1) {
      await enqueueFor(wb.admin, WS_A, `only-${n}`, 600 - n);
    }

    const sink = collector();
    const relay = new OutboxRelay(wb.appPool, {
      dispatch: sink.dispatch,
      batchSize: 4,
    });
    await relay.drainOnce();

    expect(sink.delivered.map((one) => one.idempotencyKey)).toEqual([
      "only-0",
      "only-1",
      "only-2",
      "only-3",
    ]);
  });

  it("interleaves three workspaces rather than draining one at a time", async () => {
    const wb = await workerDb();
    for (let n = 0; n < 3; n += 1) {
      await enqueueFor(wb.admin, WS_A, `a-${n}`, 300 - n);
      await enqueueFor(wb.admin, WS_B, `b-${n}`, 200 - n);
      // Null is its own bucket, not a skipped one: a row written outside a
      // tenant-scoped transaction still queues fairly against its own kind.
      await enqueueFor(wb.admin, null, `none-${n}`, 100 - n);
    }

    const sink = collector();
    const relay = new OutboxRelay(wb.appPool, {
      dispatch: sink.dispatch,
      batchSize: 9,
    });
    await relay.drainOnce();

    const order = sink.delivered.map((one) => one.idempotencyKey);
    // Rank 1 of each, then rank 2, then rank 3. Inside a rank, oldest first.
    expect(order).toEqual([
      "a-0",
      "b-0",
      "none-0",
      "a-1",
      "b-1",
      "none-1",
      "a-2",
      "b-2",
      "none-2",
    ]);
  });

  it("gives a second relay draining at the same moment a batch of its own", async () => {
    // **The regression the first version of the fair read shipped with.**
    // The ranking and the claim have to be two statements, and the first
    // version asked the ranking for exactly one batch. Every relay draining
    // at the same moment then proposed the same ids, one locked all of them
    // and the rest claimed nothing: four relays delivered fifteen rows where
    // twenty existed, which the concurrency test above caught by its total.
    // This one names the cause, so a future narrowing of the candidate
    // window fails here saying what it broke rather than looking flaky.
    const wb = await workerDb();
    for (let n = 0; n < 12; n += 1) {
      await enqueueFor(wb.admin, WS_A, `race-${n}`, 600 - n);
    }

    const first = collector();
    const second = collector();
    const relays = [
      new OutboxRelay(wb.appPool, { dispatch: first.dispatch, batchSize: 4 }),
      new OutboxRelay(wb.appPool, { dispatch: second.dispatch, batchSize: 4 }),
    ];
    await Promise.all(relays.map((relay) => relay.drainOnce()));

    // Eight rows between them, no row twice. Which relay got which batch is
    // a race and is not asserted; that both got one is the point.
    const keys = [...first.delivered, ...second.delivered].map(
      (one) => one.idempotencyKey,
    );
    expect(keys).toHaveLength(8);
    expect(new Set(keys).size).toBe(8);
    expect(first.delivered).toHaveLength(4);
    expect(second.delivered).toHaveLength(4);
  });
});
