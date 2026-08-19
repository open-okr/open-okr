/**
 * When the agents run, declared through the jobs port (P4-T05a).
 *
 * AI-NATIVE-PLAN.md §6.2 gives the Champion an hourly nudge queue. This is
 * where that hour is written down, once, as a cron expression a driver
 * understands.
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
  await queue.schedule(CHAMPION_HOURLY_JOB, CHAMPION_HOURLY_CRON);
}
