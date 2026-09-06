import type { JobHandler, JobOptions, JobQueue } from "@openokr/adapters";
import { describe, expect, it } from "vitest";
import {
  AGENT_SCHEDULES,
  CHAMPION_CYCLE_CRON,
  CHAMPION_CYCLE_JOB,
  CHAMPION_DAILY_CRON,
  CHAMPION_DAILY_JOB,
  CHAMPION_HOURLY_CRON,
  CHAMPION_HOURLY_JOB,
  CHAMPION_WEEKLY_CRON,
  CHAMPION_WEEKLY_JOB,
  COACH_NIGHTLY_CRON,
  COACH_NIGHTLY_JOB,
  COACH_SWEEP_LOCAL_HOUR,
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
  it("registers all four of §6.2's Champion cadences", async () => {
    const queue = new RecordingQueue();
    await registerAgentSchedules(queue);
    expect(queue.scheduled.slice(0, 4)).toEqual([
      { name: CHAMPION_HOURLY_JOB, cron: CHAMPION_HOURLY_CRON },
      { name: CHAMPION_DAILY_JOB, cron: CHAMPION_DAILY_CRON },
      { name: CHAMPION_WEEKLY_JOB, cron: CHAMPION_WEEKLY_CRON },
      { name: CHAMPION_CYCLE_JOB, cron: CHAMPION_CYCLE_CRON },
    ]);
  });

  it("registers §6.1's nightly Coach sweep, which is the Coach's only clock", async () => {
    // §6.1 gives the Coach four modes: continuously on every write, at each
    // phase transition, nightly, and on demand. Only the third is a schedule,
    // and it had none until P6-G01a.
    const queue = new RecordingQueue();
    await registerAgentSchedules(queue);
    expect(queue.scheduled).toContainEqual({
      name: COACH_NIGHTLY_JOB,
      cron: COACH_NIGHTLY_CRON,
    });
  });

  it("sweeps at a local hour, because a workspace's night is its own", async () => {
    // The cron is hourly and the host skips a workspace whose local hour is
    // not this one, which is how "nightly" stays true for an instance spanning
    // three continents. A cron pinned to one host's small hours would sweep
    // half the instance in the middle of a working afternoon.
    expect(COACH_NIGHTLY_CRON.split(" ")[1]).toBe("*");
    expect(COACH_SWEEP_LOCAL_HOUR).toBeGreaterThanOrEqual(0);
    expect(COACH_SWEEP_LOCAL_HOUR).toBeLessThan(24);
  });

  it("gives each cadence its own minute, so no two runs contend", async () => {
    // Not cosmetic: two schedules on the same minute would open two
    // transactions against the same workspace, and a run log read by minute
    // could not say which clock spoke.
    const minutes = AGENT_SCHEDULES.map(([, cron]) => cron.split(" ")[0]);
    expect(new Set(minutes).size).toBe(AGENT_SCHEDULES.length);
  });

  it("declares every schedule through the one list a host reads", async () => {
    // `AGENT_SCHEDULES` is what the host subscribes workers to. A cadence
    // added to `registerAgentSchedules` without being added here would be a
    // cron whose job queues forever with nothing to run it.
    const queue = new RecordingQueue();
    await registerAgentSchedules(queue);
    expect(queue.scheduled).toEqual(
      AGENT_SCHEDULES.map(([name, cron]) => ({ name, cron })),
    );
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
    expect(queue.scheduled).toHaveLength(AGENT_SCHEDULES.length * 2);
    expect(new Set(queue.scheduled.map((row) => row.name)).size).toBe(
      AGENT_SCHEDULES.length,
    );
  });
});
