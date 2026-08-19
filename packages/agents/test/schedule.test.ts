import type { JobHandler, JobOptions, JobQueue } from "@openokr/adapters";
import { describe, expect, it } from "vitest";
import {
  CHAMPION_HOURLY_CRON,
  CHAMPION_HOURLY_JOB,
  registerAgentSchedules,
} from "../src/schedule.ts";

/**
 * The schedule declaration (P4-T05a).
 *
 * A fake queue rather than a driver: the question here is what the product
 * asks for, not whether pg-boss can parse cron. The driver's own test covers
 * that.
 */
class RecordingQueue implements JobQueue {
  readonly scheduled: { name: string; cron: string }[] = [];
  readonly enqueued: string[] = [];

  async enqueue(
    name: string,
    _payload: Record<string, unknown>,
    _options?: JobOptions,
  ): Promise<string | null> {
    this.enqueued.push(name);
    return null;
  }

  async schedule(name: string, cron: string): Promise<void> {
    this.scheduled.push({ name, cron });
  }

  async work<TPayload = unknown>(
    _name: string,
    _handler: JobHandler<TPayload>,
  ): Promise<void> {}

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

describe("the agent schedules", () => {
  it("registers the Champion on the hour", async () => {
    const queue = new RecordingQueue();
    await registerAgentSchedules(queue);
    expect(queue.scheduled).toEqual([
      { name: CHAMPION_HOURLY_JOB, cron: CHAMPION_HOURLY_CRON },
    ]);
  });

  it("declares a recurrence and enqueues nothing", async () => {
    const queue = new RecordingQueue();
    await registerAgentSchedules(queue);
    // The outbox contract: a write path never enqueues, and neither does
    // declaring when something recurs.
    expect(queue.enqueued).toEqual([]);
  });

  it("leaves one schedule behind when a host restarts", async () => {
    const queue = new RecordingQueue();
    await registerAgentSchedules(queue);
    await registerAgentSchedules(queue);
    // Two calls, two `schedule` calls: the port registers or replaces, so the
    // driver holds one. This asserts the product does not try to be clever
    // about it by tracking registration state of its own.
    expect(queue.scheduled).toHaveLength(2);
    expect(new Set(queue.scheduled.map((row) => row.name)).size).toBe(1);
  });
});
