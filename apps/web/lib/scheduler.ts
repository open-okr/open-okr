/**
 * The scheduler host (P6-G01a).
 *
 * **This is the process that makes the product active.** CLAUDE.md's second
 * differentiator is that two agent members ship with every workspace and that
 * they initiate, escalate and propose. `registerAgentSchedules` has declared
 * the Champion's four cadences since P4-T05a, `agents.runChampion` and
 * `agents.runCoach` have worked since P4-T05b and P4-T06a, and nothing in this
 * repository has ever constructed a `JobQueue`. So no nudge the product can
 * produce had ever been sent by the product: every one of them waited for an
 * administrator to press Run now on `/admin/agents`. The gap audit of
 * 7 September 2026 recorded it as B-01, the first blocker on the list.
 *
 * **In the web process, beside the relay, for the reason P5-T01a already
 * settled.** Next traces only `pg` into the standalone output and compiles the
 * rest into its server chunks, so a separate worker container would mean either
 * shipping the AI, mail and socket dependencies a second time or adding a
 * bundler. Running where every driver is already loaded costs nothing and works
 * in every deployment shape, including one container started by hand.
 *
 * **Several hosts are wasteful rather than dangerous**, which is a weaker
 * guarantee than the relay's and worth stating. pg-boss keeps one schedule per
 * job name however many processes declare it, and hands a queued job to one
 * worker. What several hosts cost is the polling. `OPENOKR_SCHEDULER=off`
 * leaves one instance doing it.
 *
 * **A failing workspace never stops the sweep.** `agents.runChampion` raises
 * `not_found` for a workspace whose Champion is turned off, which is an
 * ordinary state and not an error, and any workspace can fail for its own
 * reasons. Each is run in its own try, and the job reports what it did.
 */
import { PgBossJobQueue } from "@openokr/adapters";
import {
  AGENT_SCHEDULES,
  CHAMPION_CYCLE_JOB,
  CHAMPION_DAILY_JOB,
  CHAMPION_HOURLY_JOB,
  CHAMPION_WEEKLY_JOB,
  COACH_NIGHTLY_JOB,
  COACH_SWEEP_LOCAL_HOUR,
  registerAgentSchedules,
} from "@openokr/agents";
import { type Env, loadEnv } from "@openokr/config";
import { callAction } from "@openokr/core";
import { drafterFor } from "./drafter";
import { getPool } from "./pool";
import { getKeyRing } from "./secrets";

const log = (message: string): void => {
  process.stdout.write(`scheduler: ${message}\n`);
};

const logError = (message: string): void => {
  process.stderr.write(`scheduler: ${message}\n`);
};

const reason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Whether this process runs the recurring work.
 *
 * Read through the validated environment rather than `process.env`, so
 * `OPENOKR_SCHEDULER=of` is a boot error naming the variable rather than a
 * deployment that quietly stops chasing anybody.
 */
export function schedulerEnabled(
  env: Pick<Env, "OPENOKR_SCHEDULER"> = loadEnv(),
): boolean {
  return env.OPENOKR_SCHEDULER !== "off";
}

/** A workspace, as much of it as a scheduled run needs to decide. */
export interface SchedulableWorkspace {
  readonly id: string;
  readonly slug: string;
  /** The workspace's own timezone, `UTC` when it has never set one. */
  readonly timezone: string;
}

/**
 * One recurring run: which job triggers it, and what it does to a workspace.
 *
 * `localHour` is what makes "nightly" mean a workspace's own night. The cron is
 * hourly and the run fires only for workspaces whose local hour matches, so an
 * instance spanning three continents sweeps each of them at two in the morning
 * rather than sweeping two thirds of them during the working day.
 */
export interface ScheduledRun {
  readonly job: string;
  readonly action: "agents.runChampion" | "agents.runCoach";
  readonly cadence?: "hourly" | "daily" | "weekly" | "cycle";
  readonly localHour?: number;
}

/**
 * Every job this host subscribes a worker to.
 *
 * One entry per name in `AGENT_SCHEDULES`, asserted by a test. A cron with no
 * worker is a job that queues forever and looks exactly like a product with
 * nothing to say, which is the failure this whole task exists to end.
 */
export const SCHEDULED_RUNS: readonly ScheduledRun[] = [
  { job: CHAMPION_HOURLY_JOB, action: "agents.runChampion", cadence: "hourly" },
  { job: CHAMPION_DAILY_JOB, action: "agents.runChampion", cadence: "daily" },
  { job: CHAMPION_WEEKLY_JOB, action: "agents.runChampion", cadence: "weekly" },
  { job: CHAMPION_CYCLE_JOB, action: "agents.runChampion", cadence: "cycle" },
  {
    job: COACH_NIGHTLY_JOB,
    action: "agents.runCoach",
    localHour: COACH_SWEEP_LOCAL_HOUR,
  },
];

/**
 * The hour of the clock in a timezone, 0 to 23.
 *
 * `hourCycle: "h23"` on purpose: the default cycle renders midnight as 24 in
 * some locales, which would make a run scheduled for hour 0 never fire.
 * An unknown timezone falls back to UTC rather than throwing, because a bad
 * value in one workspace's settings must not stop every other workspace's run.
 */
export function localHourIn(timezone: string, now: Date): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "numeric",
        hourCycle: "h23",
      }).format(now),
    );
  } catch {
    return now.getUTCHours();
  }
}

export interface SchedulerDeps {
  listWorkspaces(): Promise<readonly SchedulableWorkspace[]>;
  runOne(workspace: SchedulableWorkspace, run: ScheduledRun): Promise<void>;
  now(): Date;
  onWorkspaceError?(
    run: ScheduledRun,
    workspace: SchedulableWorkspace,
    error: unknown,
  ): void;
}

export interface JobOutcome {
  readonly ran: number;
  readonly skipped: number;
  readonly failed: number;
}

/**
 * Runs one scheduled job across every workspace.
 *
 * Sequential rather than parallel. Each run opens a transaction that takes the
 * audit chain's per-workspace advisory lock (P1-T07), and a serving replica
 * doing this in the background has no business opening thirty of them at once.
 */
export async function runScheduledJob(
  run: ScheduledRun,
  deps: SchedulerDeps,
): Promise<JobOutcome> {
  const now = deps.now();
  let ran = 0;
  let skipped = 0;
  let failed = 0;

  for (const workspace of await deps.listWorkspaces()) {
    if (
      run.localHour !== undefined &&
      localHourIn(workspace.timezone, now) !== run.localHour
    ) {
      skipped++;
      continue;
    }
    try {
      await deps.runOne(workspace, run);
      ran++;
    } catch (error) {
      failed++;
      deps.onWorkspaceError?.(run, workspace, error);
    }
  }

  return { ran, skipped, failed };
}

/**
 * Every live workspace with its timezone.
 *
 * A raw read, like `pnpm cadence:sweep` and `pnpm audit:verify` before it: a
 * scheduled job has no acting member, so there is no access getter to go
 * through, and enumerating tenants is the one thing it must do before it can
 * scope anything at all.
 */
async function listWorkspaces(): Promise<readonly SchedulableWorkspace[]> {
  const { rows } = await getPool().query<{
    id: string;
    slug: string;
    timezone: string | null;
  }>(
    `select id, slug, settings->>'timezone' as timezone
       from workspaces
      where deleted_at is null
      order by created_at`,
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    timezone: row.timezone ?? "UTC",
  }));
}

/**
 * Runs one agent for one workspace, as the system.
 *
 * `kind: "system"` is the same principal `pnpm cadence:sweep` uses and resolves
 * to full access with no member id, because a clock is not a person. The audit
 * row still names the action and the workspace, and the agent's own run log
 * still records every rule key that fired.
 */
async function runOne(
  workspace: SchedulableWorkspace,
  run: ScheduledRun,
): Promise<void> {
  const drafter = await drafterFor(workspace.id);
  const context = {
    pool: getPool(),
    workspaceId: workspace.id,
    actor: { kind: "system" as const },
    ring: getKeyRing(),
    ...(drafter ? { drafter } : {}),
  };
  if (run.action === "agents.runCoach") {
    await callAction(context, "agents.runCoach", {});
    return;
  }
  await callAction(context, "agents.runChampion", {
    ...(run.cadence ? { cadence: run.cadence } : {}),
  });
}

const globals = globalThis as typeof globalThis & {
  openokrScheduler?: PgBossJobQueue;
};

/**
 * Starts the scheduler once per process.
 *
 * Idempotent, and cached on `globalThis` for the same reason the pool and the
 * relay are: Next.js reloads modules in development, and a second queue per
 * reload would leave the first one polling forever.
 *
 * Failures are logged rather than fatal, matching the relay. A scheduler that
 * cannot start is a deployment that stops chasing people, and that is worse to
 * discover through a serving outage than through a log line.
 */
export function startScheduler(): PgBossJobQueue | null {
  if (!schedulerEnabled()) {
    log("disabled by OPENOKR_SCHEDULER=off");
    return null;
  }
  if (globals.openokrScheduler) {
    return globals.openokrScheduler;
  }

  const queue = new PgBossJobQueue({
    connectionString: loadEnv().DATABASE_URL,
    onError(error: unknown) {
      logError(`queue error: ${reason(error)}`);
    },
  });
  globals.openokrScheduler = queue;

  void (async () => {
    try {
      await queue.start();
      for (const run of SCHEDULED_RUNS) {
        await queue.work(run.job, async () => {
          const outcome = await runScheduledJob(run, {
            listWorkspaces,
            runOne,
            now: () => new Date(),
            onWorkspaceError(job, workspace, error) {
              logError(
                `${job.job} failed for ${workspace.slug}: ${reason(error)}`,
              );
            },
          });
          log(
            `${run.job} ran ${outcome.ran}, skipped ${outcome.skipped}, ` +
              `failed ${outcome.failed}`,
          );
        });
      }
      await registerAgentSchedules(queue);
      // One line, naming what was registered. A host that says nothing is a
      // host nobody can tell apart from one that never started.
      log(
        `started, ${SCHEDULED_RUNS.length} recurring runs: ` +
          `${AGENT_SCHEDULES.map(([name, cron]) => `${name} (${cron})`).join(", ")}`,
      );
    } catch (error) {
      logError(`could not start: ${reason(error)}`);
    }
  })();

  // Lets a job already running finish rather than orphaning it as an active
  // row that only expires on a timeout.
  const stop = () => {
    void queue.stop();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  return queue;
}
