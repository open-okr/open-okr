/**
 * When the agents run, declared through the jobs port (P4-T05a, P4-T05b).
 *
 * AI-NATIVE-PLAN.md §6.2 gives the Champion four cadences. This is where each
 * one is written down, once, as a cron expression a driver understands.
 *
 * **Nothing runs this today, and that is not an oversight to work around.**
 * The repository has no relay host and no worker process: the outbox is written
 * correctly by every write path and nothing drains it, which
 * `packages/core/src/scoring/recompute.ts` and three other files already
 * record. A host that starts a queue calls `registerAgentSchedules` once at
 * boot and the schedule begins. Until then the same run is reachable through
 * the `agents.runChampion` action, which is what the tests drive and what an
 * administrator can call.
 *
 * Registering a schedule is not enqueuing a job, so this does not break the
 * outbox contract: no write path calls it, and it declares a recurrence rather
 * than causing a side effect.
 */
import type { JobQueue } from "@openokr/adapters";

/** The job name the hourly Champion run is registered under. */
export const CHAMPION_HOURLY_JOB = "agents.champion.hourly";

/**
 * On the hour, every hour.
 *
 * Not "every sixty minutes from boot": a run at :00 means a check-in due today
 * is chased at a predictable minute, and two hosts restarting at different
 * times do not drift into nudging the same person twice an hour apart. The
 * deduplication rules would hold the second one, but the run log would still
 * show a product that could not say when it speaks.
 */
export const CHAMPION_HOURLY_CRON = "0 * * * *";

/** The other three of §6.2's cadences (P4-T05b). */
export const CHAMPION_DAILY_JOB = "agents.champion.daily";
export const CHAMPION_WEEKLY_JOB = "agents.champion.weekly";
export const CHAMPION_CYCLE_JOB = "agents.champion.cycle";

/**
 * All three check hourly, and none of them is misnamed for it.
 *
 * Every one of these fires on a **local** moment: the morning summary at 08:00
 * in each member's own timezone, a session at the hour it was booked, a
 * countdown on a date in the workspace calendar. A workspace spanning three
 * continents has no single hour at which "daily" happens, so a job that ran
 * once a day in the host's timezone would reach a third of its members at the
 * wrong time and miss the rest.
 *
 * What makes them daily is not the cron, it is the run: each reader fires only
 * for rows whose local moment has arrived, and the nudge engine's deduplication
 * window holds any repeat inside the same day. That is the same mechanism that
 * lets the hourly queue chase a check-in without sending twenty-four reminders.
 *
 * They sit at different minutes so four runs never contend for the same
 * transaction, and so a run log read by minute says which clock spoke.
 */
export const CHAMPION_DAILY_CRON = "15 * * * *";
export const CHAMPION_WEEKLY_CRON = "30 * * * *";
export const CHAMPION_CYCLE_CRON = "45 * * * *";

/**
 * Declares every agent schedule on a queue.
 *
 * Idempotent by the port's own contract: `schedule` registers or replaces, so
 * a host that restarts twice a minute leaves one schedule behind, not two.
 */
export async function registerAgentSchedules(queue: JobQueue): Promise<void> {
  // openokr:allow-side-effect: this is boot-time configuration, not a write
  // path. `schedule` declares when a job recurs; it enqueues nothing, runs in
  // no transaction, and has no domain change to be atomic with. The rule it is
  // marked against exists so a write cannot fire a side effect that outlives a
  // rollback, and there is no write here to roll back. A test asserts this
  // function enqueues nothing.
  // The marker is per call site, so each of the four carries it. Repeating it
  // beats one comment covering a block, because a fifth call added later would
  // otherwise inherit an exemption nobody reread.
  for (const [job, cron] of [
    [CHAMPION_HOURLY_JOB, CHAMPION_HOURLY_CRON],
    [CHAMPION_DAILY_JOB, CHAMPION_DAILY_CRON],
    [CHAMPION_WEEKLY_JOB, CHAMPION_WEEKLY_CRON],
    [CHAMPION_CYCLE_JOB, CHAMPION_CYCLE_CRON],
  ] as const) {
    // openokr:allow-side-effect: same reason as above.
    await queue.schedule(job, cron);
  }
}
