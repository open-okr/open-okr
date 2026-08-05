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

    const handled: unknown[] = [];
    await queue.work<{ goalId: string }>("recompute.goal", async (payload) => {
      handled.push(payload);
    });

    const first = await queue.enqueue(
      "recompute.goal",
      { goalId: "g1" },
      { idempotencyKey: "recompute.goal:g1" },
    );
    expect(first).toMatch(/.+/);

    // The same key while the first is still pending is one job, which is what
    // makes the relay's at-least-once delivery safe.
    const duplicate = await queue.enqueue(
      "recompute.goal",
      { goalId: "g1" },
      { idempotencyKey: "recompute.goal:g1" },
    );
    expect(duplicate).toBeNull();

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
});
