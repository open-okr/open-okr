import { testDbEnv, workerDb } from "@openokr/test-support/db";
import { afterAll, describe, expect, it } from "vitest";
import { PgBossJobQueue } from "../src/drivers/jobs/pg-boss.ts";

/**
 * The pg-boss driver contract. Slower than the other drivers because pg-boss
 * builds its own schema on first start, so the cases are combined into one
 * lifecycle rather than paying that cost per assertion.
 */

let queue: PgBossJobQueue | undefined;

afterAll(async () => {
  await queue?.stop();
  const wb = await workerDb();
  await wb.close();
});

const waitFor = async <T>(
  get: () => T | undefined,
  timeoutMs = 20_000,
): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = get();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for a job.");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe("PgBossJobQueue", () => {
  it("runs a queued job and deduplicates on the idempotency key", async () => {
    const wb = await workerDb();
    const connectionString =
      `postgres://${testDbEnv.superuser}:${testDbEnv.password}` +
      `@${testDbEnv.host}:${testDbEnv.port}/${wb.databaseName}`;

    queue = new PgBossJobQueue({ connectionString });
    await queue.start();

    const first = await queue.enqueue(
      "recompute.goal",
      { goalId: "g1" },
      { idempotencyKey: "recompute.goal:g1" },
    );
    expect(first).toMatch(/.+/);

    // The same key while the first is still waiting to run is one job, which
    // is what makes the relay's at-least-once delivery safe to retry. The
    // worker is registered only afterwards, so the first job is provably
    // still pending here rather than by luck of the polling interval; once a
    // job has run, the same key may legitimately be queued again.
    const duplicate = await queue.enqueue(
      "recompute.goal",
      { goalId: "g1" },
      { idempotencyKey: "recompute.goal:g1" },
    );
    expect(duplicate).toBeNull();

    const handled: unknown[] = [];
    await queue.work<{ goalId: string }>("recompute.goal", async (payload) => {
      handled.push(payload);
    });

    await waitFor(() => (handled.length > 0 ? handled : undefined));
    expect(handled[0]).toMatchObject({ goalId: "g1" });

    // A different key is a different job.
    await queue.enqueue(
      "recompute.goal",
      { goalId: "g2" },
      { idempotencyKey: "recompute.goal:g2" },
    );
    await waitFor(() => (handled.length > 1 ? handled : undefined));
    expect(handled).toHaveLength(2);
  });

  it("registers a cron schedule without running it immediately", async () => {
    // The queue from the previous case is still started.
    expect(queue).toBeDefined();
    await expect(
      queue?.schedule("digest.daily", "0 9 * * *", { scope: "workspace" }),
    ).resolves.toBeUndefined();
  });

  it("start and stop are idempotent", async () => {
    await expect(queue?.start()).resolves.toBeUndefined();
    await expect(queue?.stop()).resolves.toBeUndefined();
    await expect(queue?.stop()).resolves.toBeUndefined();
    queue = undefined;
  });

  /**
   * A stop inside the drain's budget (plan 0.8.0 H10a,
   * docs/design/worker-deployment.md D7). A job still running when the
   * timeout passes is handed back as failed, so another scheduler retries it
   * at once rather than finding it `active` for the fifteen minutes it takes
   * to expire.
   */
  it("hands a job still running at the timeout back, and another queue runs it", async () => {
    const wb = await workerDb();
    const connectionString =
      `postgres://${testDbEnv.superuser}:${testDbEnv.password}` +
      `@${testDbEnv.host}:${testDbEnv.port}/${wb.databaseName}`;

    const stopping = new PgBossJobQueue({ connectionString });
    const taking = new PgBossJobQueue({ connectionString });
    try {
      await stopping.start();
      let entered = false;
      // Never settles: the job outlives the stop's timeout.
      await stopping.work("slow.run", async () => {
        entered = true;
        await new Promise(() => undefined);
      });
      const id = await stopping.enqueue("slow.run", { run: 1 });
      await waitFor(() => (entered ? true : undefined));
      expect(stopping.running).toBe(1);

      const began = Date.now();
      await stopping.stop({ timeoutMs: 1_000 });
      expect(Date.now() - began).toBeLessThan(10_000);
      // Still running in memory, and no longer this queue's: handed back.
      expect(stopping.running).toBe(1);

      const state = await wb.admin.query(
        "select state from pgboss.job where id = $1",
        [id],
      );
      expect(state.rows[0]?.state).toBe("retry");

      await taking.start();
      const ran: unknown[] = [];
      await taking.work("slow.run", async (payload) => {
        ran.push(payload);
      });
      await waitFor(() => (ran.length > 0 ? ran : undefined));
      expect(ran[0]).toMatchObject({ run: 1 });
    } finally {
      await taking.stop();
      await stopping.stop();
    }
  });
});
