import { AGENT_SCHEDULES } from "@openokr/agents";
import { resetEnvCache } from "@openokr/config";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  localHourIn,
  runScheduledJob,
  SCHEDULED_RUNS,
  type SchedulableWorkspace,
  type ScheduledRun,
  schedulerEnabled,
} from "../lib/scheduler";

/**
 * The scheduler host (P6-G01a).
 *
 * The toggle matters less than the default. A deployment that schedules nothing
 * never chases a check-in, never sends a morning summary, never ages a blocker
 * and never flips a neglected goal to outdated, and that was the state of every
 * deployment this product has ever had: `registerAgentSchedules` declared four
 * crons from P4-T05a and nothing ever constructed a queue to hold them. So
 * "unset" has to mean "on".
 */

const original = { ...process.env };

beforeEach(() => {
  resetEnvCache();
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
});

afterEach(() => {
  process.env = { ...original };
  resetEnvCache();
});

describe("the toggle", () => {
  test("an unconfigured deployment schedules", () => {
    process.env.OPENOKR_SCHEDULER = "";
    expect(schedulerEnabled()).toBe(true);
  });

  test("off means off, for the replicas that should not poll", () => {
    expect(schedulerEnabled({ OPENOKR_SCHEDULER: "off" })).toBe(false);
  });

  test("a misspelt value is a boot error, not a silent stop", () => {
    process.env.OPENOKR_SCHEDULER = "of";
    expect(() => schedulerEnabled()).toThrow(/OPENOKR_SCHEDULER/);
  });
});

describe("the run table", () => {
  test("has exactly one worker per declared schedule", () => {
    // The invariant this task exists for. A cron with no worker queues a job
    // that nothing ever runs, which looks identical to a product with nothing
    // to say, and that is what four months of this repository looked like.
    expect(SCHEDULED_RUNS.map((run) => run.job).sort()).toEqual(
      AGENT_SCHEDULES.map(([name]) => name).sort(),
    );
  });

  test("names a real action for every run", () => {
    for (const run of SCHEDULED_RUNS) {
      expect(["agents.runChampion", "agents.runCoach"]).toContain(run.action);
    }
  });

  test("gives every Champion run one of §6.2's four cadences", () => {
    const champion = SCHEDULED_RUNS.filter(
      (run) => run.action === "agents.runChampion",
    );
    expect(champion.map((run) => run.cadence).sort()).toEqual([
      "cycle",
      "daily",
      "hourly",
      "weekly",
    ]);
  });
});

describe("local hours", () => {
  const midnightUtc = new Date("2026-09-07T00:00:00Z");

  test("reads midnight as 0 rather than 24", () => {
    // The default hour cycle renders midnight as 24 in some locales, which
    // would make any run scheduled for hour 0 never fire at all.
    expect(localHourIn("UTC", midnightUtc)).toBe(0);
  });

  test("gives a workspace its own hour", () => {
    expect(localHourIn("Asia/Kuala_Lumpur", midnightUtc)).toBe(8);
    expect(localHourIn("America/New_York", midnightUtc)).toBe(20);
  });

  test("falls back to UTC for a timezone nobody recognises", () => {
    // A bad value in one workspace's settings must not stop every other
    // workspace's run, so this cannot throw.
    expect(localHourIn("Mars/Olympus_Mons", midnightUtc)).toBe(0);
  });
});

describe("running a job across every workspace", () => {
  const workspaces: SchedulableWorkspace[] = [
    { id: "w1", slug: "kl", timezone: "Asia/Kuala_Lumpur" },
    { id: "w2", slug: "berlin", timezone: "Europe/Berlin" },
    { id: "w3", slug: "utc", timezone: "UTC" },
  ];

  const hourly: ScheduledRun = {
    job: "agents.champion.hourly",
    action: "agents.runChampion",
    cadence: "hourly",
  };

  test("runs every workspace when the run has no local hour", async () => {
    const seen: string[] = [];
    const outcome = await runScheduledJob(hourly, {
      listWorkspaces: async () => workspaces,
      runOne: async (workspace) => {
        seen.push(workspace.id);
      },
      now: () => new Date("2026-09-07T09:00:00Z"),
    });
    expect(seen).toEqual(["w1", "w2", "w3"]);
    expect(outcome).toEqual({ ran: 3, skipped: 0, failed: 0 });
  });

  test("a nightly run fires only where it is that hour locally", async () => {
    // 18:00 UTC is 02:00 the next day in Kuala Lumpur and 20:00 in Berlin, so
    // one workspace sweeps and two wait for their own night. This is what makes
    // "nightly" true for an instance spanning three continents.
    const nightly: ScheduledRun = {
      job: "agents.coach.nightly",
      action: "agents.runCoach",
      localHour: 2,
    };
    const seen: string[] = [];
    const outcome = await runScheduledJob(nightly, {
      listWorkspaces: async () => workspaces,
      runOne: async (workspace) => {
        seen.push(workspace.id);
      },
      now: () => new Date("2026-09-07T18:00:00Z"),
    });
    expect(seen).toEqual(["w1"]);
    expect(outcome).toEqual({ ran: 1, skipped: 2, failed: 0 });
  });

  test("one workspace failing never stops the others", async () => {
    // `agents.runChampion` raises not_found when a workspace's Champion is
    // turned off, which is an ordinary state rather than an error. A sweep that
    // aborted on the first one would leave every workspace after it unchased,
    // and the order is the creation order, so it would always be the same ones.
    const seen: string[] = [];
    const errors: string[] = [];
    const outcome = await runScheduledJob(hourly, {
      listWorkspaces: async () => workspaces,
      runOne: async (workspace) => {
        if (workspace.id === "w1") {
          throw new Error("This workspace has no Champion.");
        }
        seen.push(workspace.id);
      },
      now: () => new Date("2026-09-07T09:00:00Z"),
      onWorkspaceError: (_run, workspace) => {
        errors.push(workspace.slug);
      },
    });
    expect(seen).toEqual(["w2", "w3"]);
    expect(errors).toEqual(["kl"]);
    expect(outcome).toEqual({ ran: 2, skipped: 0, failed: 1 });
  });

  test("an instance with no workspaces does nothing and says so", async () => {
    const outcome = await runScheduledJob(hourly, {
      listWorkspaces: async () => [],
      runOne: async () => {
        throw new Error("never called");
      },
      now: () => new Date(),
    });
    expect(outcome).toEqual({ ran: 0, skipped: 0, failed: 0 });
  });
});
