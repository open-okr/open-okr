/**
 * The wizard's connection tests (P1-T09).
 *
 * The wizard is specified to test the database, mail, channel and AI
 * connections live. Two of those have drivers today; channels arrive in Phase 5
 * and the AI providers in Phase 6. So the framework is here in full and each
 * port reports one of three outcomes:
 *
 *   ok           tested, and it worked
 *   failed       tested, and here is what went wrong
 *   unavailable  not tested, because this build has no driver for it
 *
 * `unavailable` exists so a wizard never shows a green tick for something it
 * did not test. A stub that always passes would be the same fail-open shape
 * that has already bitten this repository twice: a gate reporting success
 * while inspecting nothing.
 */

export type ConnectionOutcome = "ok" | "failed" | "unavailable";

export interface ConnectionTest {
  /** The port under test: 'database', 'mail', 'channel' or 'ai'. */
  readonly port: string;
  readonly outcome: ConnectionOutcome;
  /** Shown to the operator. Never contains a credential. */
  readonly detail: string;
  /** How long the check took, for the wizard's own budget reporting. */
  readonly milliseconds?: number;
}

export interface ConnectionProbe {
  readonly port: string;
  run(): Promise<Omit<ConnectionTest, "port" | "milliseconds">>;
}

/**
 * Runs probes and times them.
 *
 * A probe that throws is reported as a failure rather than taking the wizard
 * down: the operator is midway through setup, and losing the page because a
 * mail server refused a connection would cost them everything they typed.
 */
export async function runConnectionTests(
  probes: readonly ConnectionProbe[],
  now: () => number = () => Date.now(),
): Promise<readonly ConnectionTest[]> {
  const results: ConnectionTest[] = [];

  for (const probe of probes) {
    const started = now();
    try {
      const outcome = await probe.run();
      results.push({
        port: probe.port,
        ...outcome,
        milliseconds: now() - started,
      });
    } catch (error) {
      results.push({
        port: probe.port,
        outcome: "failed",
        detail:
          error instanceof Error
            ? error.message.split("\n")[0] || error.name
            : "The check failed for an unknown reason.",
        milliseconds: now() - started,
      });
    }
  }

  return results;
}

/**
 * Does anything block finishing setup?
 *
 * Only a failing database does. Mail, channels and AI are all optional by
 * §4.2: with no mail, delivery stays in the in-app inbox; with no AI key, AI
 * is off; with no channel, email and the inbox carry everything. None of them
 * blocks registration or use, so none of them blocks the wizard either. An
 * operator who cannot reach their mail server should still get a working
 * instance and fix mail afterwards.
 */
export function blockingFailures(
  tests: readonly ConnectionTest[],
): readonly ConnectionTest[] {
  return tests.filter(
    (test) => test.port === "database" && test.outcome === "failed",
  );
}
