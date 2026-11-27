import { PgBossJobQueue } from "@openokr/adapters";
import { loadEnv } from "@openokr/config";
import { onShutdown } from "./shutdown";

/**
 * The jobs port for queuing, from the relay (docs/design/flowyteam-connect.md
 * Q4).
 *
 * A process that runs the scheduler already holds a queue, and that one is
 * used. A relay with the scheduler elsewhere gets a send-only queue on first
 * use: two connections at most, and no maintenance, cron or migration, which
 * stay the scheduler's.
 */
const globals = globalThis as typeof globalThis & {
  openokrScheduler?: PgBossJobQueue;
  openokrJobSender?: Promise<PgBossJobQueue>;
};

export function jobQueueForSending(): Promise<PgBossJobQueue> {
  if (globals.openokrScheduler) {
    return Promise.resolve(globals.openokrScheduler);
  }
  if (!globals.openokrJobSender) {
    globals.openokrJobSender = (async () => {
      const queue = new PgBossJobQueue({
        connectionString: loadEnv().DATABASE_URL,
        createSchema: false,
        max: 2,
        sendOnly: true,
        onError(error: unknown) {
          console.error(
            `[job-sender] ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      });
      await queue.start();
      onShutdown({
        name: "job-sender",
        phase: "drain",
        async stop() {
          await queue.stop();
          return "job sender closed";
        },
      });
      return queue;
    })().catch((error: unknown) => {
      // The next row tries again rather than inheriting a failed start.
      globals.openokrJobSender = undefined;
      throw error;
    });
  }
  return globals.openokrJobSender;
}
