import {
  connectionOptions,
  testDbEnv,
  workerDb,
} from "@openokr/test-support/db";
import pg from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { PostgresRealtime } from "../src/drivers/realtime/postgres.ts";
import { EventTooLargeError, MAX_EVENT_BYTES } from "../src/ports/realtime.ts";

/**
 * The realtime driver: Postgres listen/notify carrying compact typed events.
 *
 * Two rules the task calls out are tested here: an event over the notify
 * payload guard raises rather than being silently truncated, and a
 * subscriber does not receive back what it published itself.
 */

const instances: PostgresRealtime[] = [];

const realtime = async (): Promise<PostgresRealtime> => {
  const wb = await workerDb();
  const instance = new PostgresRealtime({
    connectionOptions: connectionOptions(wb.databaseName, testDbEnv.superuser),
  });
  instances.push(instance);
  return instance;
};

/** Waits for a condition the notify listener will satisfy, or gives up. */
const eventually = async (
  check: () => boolean,
  timeoutMs = 5000,
): Promise<void> => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for a realtime event.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.stop()));
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("PostgresRealtime", () => {
  it("delivers a published event to a subscriber on the same channel", async () => {
    const bus = await realtime();
    const received: unknown[] = [];
    await bus.subscribe("workspace:w1:goal:g1", (event) =>
      received.push(event),
    );

    await bus.publish("workspace:w1:goal:g1", {
      name: "goal.updated",
      data: { goalId: "g1" },
    });

    await eventually(() => received.length === 1);
    expect(received[0]).toMatchObject({
      name: "goal.updated",
      data: { goalId: "g1" },
    });
    expect((received[0] as { at: string }).at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("keeps channels separate", async () => {
    const bus = await realtime();
    const goal: unknown[] = [];
    const other: unknown[] = [];
    await bus.subscribe("workspace:w1:goal:g1", (event) => goal.push(event));
    await bus.subscribe("workspace:w1:goal:g2", (event) => other.push(event));

    await bus.publish("workspace:w1:goal:g1", {
      name: "goal.updated",
      data: {},
    });

    await eventually(() => goal.length === 1);
    expect(other).toEqual([]);
  });

  it("works with channel names far longer than a Postgres identifier", async () => {
    const bus = await realtime();
    // Real channels carry two UUIDs, well past the 63-byte identifier limit.
    const channel =
      "workspace:11111111-1111-4111-8111-111111111111:key-result:22222222-2222-4222-8222-222222222222";
    const received: unknown[] = [];
    await bus.subscribe(channel, (event) => received.push(event));

    await bus.publish(channel, { name: "key_result.checked_in", data: {} });

    await eventually(() => received.length === 1);
    expect(received).toHaveLength(1);
  });

  it("suppresses the echo back to the origin that published it", async () => {
    const bus = await realtime();
    const mine: unknown[] = [];
    const theirs: unknown[] = [];
    await bus.subscribe("workspace:w1:goals", (event) => mine.push(event), {
      origin: "tab-a",
    });
    await bus.subscribe("workspace:w1:goals", (event) => theirs.push(event), {
      origin: "tab-b",
    });

    await bus.publish("workspace:w1:goals", {
      name: "goal.created",
      data: { goalId: "g9" },
      origin: "tab-a",
    });

    await eventually(() => theirs.length === 1);
    // The publisher's own subscription stays silent: it already has the change.
    expect(mine).toEqual([]);
  });

  it("delivers to every subscriber when no origin is set", async () => {
    const bus = await realtime();
    const first: unknown[] = [];
    const second: unknown[] = [];
    await bus.subscribe("workspace:w1:feed", (event) => first.push(event));
    await bus.subscribe("workspace:w1:feed", (event) => second.push(event));

    await bus.publish("workspace:w1:feed", {
      name: "activity.added",
      data: {},
    });

    await eventually(() => first.length === 1 && second.length === 1);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it("raises rather than truncating an event over the notify guard", async () => {
    const bus = await realtime();
    const oversized = {
      name: "goal.updated",
      data: { blob: "x".repeat(MAX_EVENT_BYTES) },
    };

    await expect(
      bus.publish("workspace:w1:goals", oversized),
    ).rejects.toBeInstanceOf(EventTooLargeError);
    // The message names the limit so the fix is obvious: send an identifier,
    // not the content.
    await expect(bus.publish("workspace:w1:goals", oversized)).rejects.toThrow(
      /8000 byte/,
    );
  });

  it("stops delivering after unsubscribe", async () => {
    const bus = await realtime();
    const received: unknown[] = [];
    const subscription = await bus.subscribe("workspace:w1:goals", (event) =>
      received.push(event),
    );

    await bus.publish("workspace:w1:goals", { name: "goal.updated", data: {} });
    await eventually(() => received.length === 1);

    await subscription.unsubscribe();
    await bus.publish("workspace:w1:goals", { name: "goal.updated", data: {} });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(received).toHaveLength(1);
  });

  it("does not poison later calls after one failed connect (P1 hardening)", async () => {
    // Before the fix, a rejected #connecting promise stayed assigned
    // forever: `??=` only replaces `undefined`, so one failed connect
    // poisoned every later publish and subscribe for the life of the
    // process, even once the underlying problem was gone. Simulated here by
    // failing pg.Client.connect exactly once and letting it succeed after.
    const realConnect = pg.Client.prototype.connect;
    const spy = vi
      .spyOn(pg.Client.prototype, "connect")
      .mockImplementationOnce(() => {
        throw new Error("simulated connect failure");
      })
      .mockImplementation(function (this: pg.Client, ...args: unknown[]) {
        // biome-ignore lint/suspicious/noExplicitAny: delegating to the real overload set
        return (realConnect as any).apply(this, args);
      });

    const bus = await realtime();
    await expect(
      bus.publish("workspace:w1:reconnect", { name: "x", data: {} }),
    ).rejects.toThrow(/simulated connect failure/);

    // The same instance, no new options: this only succeeds if the failed
    // attempt did not leave #connecting permanently rejected.
    const received: unknown[] = [];
    await bus.subscribe("workspace:w1:reconnect", (event) =>
      received.push(event),
    );
    await bus.publish("workspace:w1:reconnect", {
      name: "goal.updated",
      data: {},
    });
    await eventually(() => received.length === 1);

    spy.mockRestore();
  });

  it("carries events between two separate connections", async () => {
    const publisher = await realtime();
    const subscriber = await realtime();
    const received: unknown[] = [];
    await subscriber.subscribe("workspace:w1:sessions", (event) =>
      received.push(event),
    );

    await publisher.publish("workspace:w1:sessions", {
      name: "session.stage_changed",
      data: { stage: "voting" },
    });

    await eventually(() => received.length === 1);
    expect(received[0]).toMatchObject({ data: { stage: "voting" } });
  });
});
