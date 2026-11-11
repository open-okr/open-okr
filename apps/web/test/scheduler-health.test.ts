import { describe, expect, test } from "vitest";
import { judgeScheduler, type SchedulerReading } from "../lib/scheduler-health";

// Plan 0.8.0 H12: pg-boss hands each scheduled job to one pod, so behind a
// load balancer the pod that answered /api/status had often run nothing, and
// a healthy scheduler read as degraded.

const MINUTE = 60_000;
const NOW = Date.parse("2026-11-10T12:00:00Z");

const reading = (patch: Partial<SchedulerReading>): SchedulerReading => ({
  mode: "on",
  failedHere: false,
  localLastRun: null,
  sharedLastRun: null,
  sharedUnreadable: false,
  bootedAt: NOW - 400 * MINUTE,
  processStartedAt: NOW - 400 * MINUTE,
  now: NOW,
  degradedSeconds: 7200,
  unavailableSeconds: 14400,
  ...patch,
});

describe("judgeScheduler", () => {
  test("a pod that ran nothing reads the run another pod recorded", () => {
    expect(judgeScheduler(reading({ sharedLastRun: NOW - 5 * MINUTE }))).toBe(
      "operational",
    );
  });

  test("the newer of the two readings is the one judged", () => {
    expect(
      judgeScheduler(
        reading({
          localLastRun: NOW - 300 * MINUTE,
          sharedLastRun: NOW - 5 * MINUTE,
        }),
      ),
    ).toBe("operational");
    expect(
      judgeScheduler(
        reading({
          localLastRun: NOW - 5 * MINUTE,
          sharedLastRun: null,
        }),
      ),
    ).toBe("operational");
  });

  test("stale everywhere is degraded, then unavailable", () => {
    expect(judgeScheduler(reading({ sharedLastRun: NOW - 150 * MINUTE }))).toBe(
      "degraded",
    );
    expect(judgeScheduler(reading({ sharedLastRun: NOW - 300 * MINUTE }))).toBe(
      "unavailable",
    );
  });

  test("a failed start here is fine while another pod's scheduler runs", () => {
    expect(
      judgeScheduler(
        reading({ failedHere: true, sharedLastRun: NOW - 5 * MINUTE }),
      ),
    ).toBe("operational");
    expect(
      judgeScheduler(
        reading({ failedHere: true, sharedLastRun: NOW - 150 * MINUTE }),
      ),
    ).toBe("unavailable");
    expect(judgeScheduler(reading({ failedHere: true }))).toBe("unavailable");
  });

  test("before any run, a fresh boot has its grace", () => {
    expect(judgeScheduler(reading({ bootedAt: NOW - 5 * MINUTE }))).toBe(
      "operational",
    );
  });

  test("a pod with the scheduler off answers operational, as before", () => {
    expect(
      judgeScheduler(
        reading({ mode: "off", sharedLastRun: NOW - 300 * MINUTE }),
      ),
    ).toBe("operational");
  });
});

// docs/design/worker-deployment.md §1.3, plan 0.8.0 H10d: a pod whose
// scheduler runs on the worker judges the stamp the worker writes.
describe("judgeScheduler, with the scheduler elsewhere", () => {
  const elsewhere = (patch: Partial<SchedulerReading>): SchedulerReading =>
    reading({ mode: "elsewhere", bootedAt: null, ...patch });

  test("judges the shared stamp by its age", () => {
    expect(judgeScheduler(elsewhere({ sharedLastRun: NOW - MINUTE }))).toBe(
      "operational",
    );
    expect(
      judgeScheduler(elsewhere({ sharedLastRun: NOW - 180 * MINUTE })),
    ).toBe("degraded");
    expect(
      judgeScheduler(elsewhere({ sharedLastRun: NOW - 300 * MINUTE })),
    ).toBe("unavailable");
  });

  test("with no stamp yet, grace runs from this process's start", () => {
    expect(
      judgeScheduler(elsewhere({ processStartedAt: NOW - 10 * MINUTE })),
    ).toBe("operational");
    expect(
      judgeScheduler(elsewhere({ processStartedAt: NOW - 300 * MINUTE })),
    ).toBe("unavailable");
  });

  test("a stamp that cannot be read is unavailable", () => {
    expect(
      judgeScheduler(
        elsewhere({ sharedUnreadable: true, processStartedAt: NOW - MINUTE }),
      ),
    ).toBe("unavailable");
  });

  test("off still answers operational whatever the stamp", () => {
    expect(
      judgeScheduler(
        reading({
          mode: "off",
          sharedUnreadable: true,
          processStartedAt: NOW - 300 * MINUTE,
        }),
      ),
    ).toBe("operational");
  });
});
