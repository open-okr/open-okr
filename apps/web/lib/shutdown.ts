/**
 * How this process stops (plan 0.8.0 H10a, docs/design/worker-deployment.md
 * D4, D5 and §1.1).
 *
 * **Next's own handler exits without waiting for anything.** On SIGTERM it
 * closes the HTTP server, closes itself and calls `process.exit`, and it
 * cannot be told to wait. The relay and the scheduler each registered their
 * own `process.once("SIGTERM")` promising to finish the work in flight, and
 * both promises were dropped: the process was gone within milliseconds, or,
 * with a live stream open, at the orchestrator's SIGKILL.
 *
 * So the server owns the signal. The image sets `NEXT_MANUAL_SIG_HANDLE`,
 * which makes Next register nothing, and this module installs one handler
 * for SIGTERM and SIGINT. The relay, the scheduler, error reporting and the
 * meter each register a step here instead of a listener of their own. On a
 * signal the drain steps run together, bounded by `OPENOKR_SHUTDOWN_SECONDS`;
 * then the flush steps send what is held in memory; then one line says what
 * was waited for and what was left, and the process exits 0.
 *
 * Without the variable (`pnpm dev`, `next start`) Next's handler is still
 * there and exits when it is ready. The steps run all the same, as the old
 * listeners did, and the exit stays Next's.
 *
 * **Light on purpose.** It is installed first in `register()`, before the
 * environment is checked, because a Node process that is PID 1 ignores
 * SIGTERM unless something handles it. So it imports the environment
 * schema and nothing else.
 */
import { loadEnv } from "@openokr/config";

/**
 * Drain steps finish work in flight and share the budget. Flush steps send
 * what is held in memory, after every drain step is done, so what the drain
 * reported is sent too.
 */
type ShutdownPhase = "drain" | "flush";

export interface ShutdownStep {
  /** Names the step in the log line when it fails or runs past the bound. */
  readonly name: string;
  readonly phase: ShutdownPhase;
  /**
   * Stops the work. Resolves with what happened in a few words, which the
   * `stopped` line joins with the others. `deadline` is when the coordinator
   * stops waiting, in `Date.now()` milliseconds.
   */
  readonly stop: (deadline: number) => Promise<string>;
}

export interface ShutdownReport {
  readonly seconds: number;
  readonly outcomes: readonly string[];
}

/** D8's default, used if the environment cannot be read when a signal comes. */
const DEFAULT_SECONDS = 20;

/**
 * How long the flush steps may take together. The error reports' own bound is
 * two seconds and the span exporter's five, and they run side by side; the
 * chart's grace period leaves fifteen seconds after the drain for this (D9).
 */
const FLUSH_MS = 10_000;

/** How often the wait for actions looks again. */
const ACTION_POLL_MS = 50;

interface Coordinator {
  /** By name, so a step registered again (a reload in development) replaces the first. */
  readonly steps: Map<string, ShutdownStep>;
  installed: boolean;
  stopping?: Promise<void>;
}

/**
 * On `globalThis` for the reason `lib/telemetry.ts` gives: Next bundles
 * `instrumentation.ts` apart from route code, and a module variable would
 * give each bundle a coordinator of its own.
 */
const globals = globalThis as typeof globalThis & {
  openokrShutdown?: Coordinator;
};

function coordinator(): Coordinator {
  globals.openokrShutdown ??= { steps: new Map(), installed: false };
  return globals.openokrShutdown;
}

/** Adds a step to what a stop runs. */
export function onShutdown(step: ShutdownStep): void {
  coordinator().steps.set(step.name, step);
}

/**
 * Takes SIGTERM and SIGINT for this process. Once per process; a second call
 * does nothing.
 */
export function installShutdown(): void {
  const current = coordinator();
  if (current.installed) {
    return;
  }
  current.installed = true;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      void stopProcess(signal);
    });
  }
}

/**
 * Whether this process exits itself. Next registers its handler unless
 * `NEXT_MANUAL_SIG_HANDLE` is set to anything at all (its test is
 * `!process.env.NEXT_MANUAL_SIG_HANDLE`), so this reads it the same way:
 * whenever Next registered nothing, something here has to exit.
 */
function exitsItself(): boolean {
  return Boolean(process.env.NEXT_MANUAL_SIG_HANDLE);
}

/** The drain's bound, in seconds. */
function budgetSeconds(): number {
  try {
    return loadEnv().OPENOKR_SHUTDOWN_SECONDS;
  } catch {
    // A boot with a bad environment has already said so and exited; this is
    // a signal arriving before that check ran, which must still stop.
    return DEFAULT_SECONDS;
  }
}

/**
 * What one signal does: the steps, the log lines, and the exit when Next is
 * not doing it. A second signal while stopping joins the first stop rather
 * than starting another.
 */
export function stopProcess(signal: "SIGTERM" | "SIGINT"): Promise<void> {
  const current = coordinator();
  current.stopping ??= (async () => {
    const seconds = budgetSeconds();
    process.stdout.write(
      `shutdown: ${signal}, draining for up to ${seconds}s\n`,
    );
    const report = await runShutdown([...current.steps.values()], {
      budgetMs: seconds * 1000,
    });
    const outcomes =
      report.outcomes.length > 0
        ? report.outcomes.join(", ")
        : "nothing to stop";
    process.stdout.write(
      `shutdown: stopped after ${report.seconds.toFixed(1)}s: ${outcomes}\n`,
    );
    if (exitsItself()) {
      // 0, not 128 plus the signal: this process was asked to stop and did,
      // and an orchestrator reading the code should see a clean stop.
      process.exit(0);
    }
  })();
  return current.stopping;
}

/**
 * Runs the steps: every drain step at once, bounded by `budgetMs`, then
 * every flush step at once, bounded by `flushMs`. A step that throws is named
 * with its reason and a step still going at its bound is named as left;
 * neither stops the others.
 */
export async function runShutdown(
  steps: readonly ShutdownStep[],
  options: { readonly budgetMs: number; readonly flushMs?: number },
): Promise<ShutdownReport> {
  const started = Date.now();
  const drained = await Promise.all(
    steps
      .filter((step) => step.phase === "drain")
      .map((step) => within(step, started + options.budgetMs)),
  );
  const flushFrom = Date.now();
  const flushed = await Promise.all(
    steps
      .filter((step) => step.phase === "flush")
      .map((step) => within(step, flushFrom + (options.flushMs ?? FLUSH_MS))),
  );
  return {
    seconds: (Date.now() - started) / 1000,
    outcomes: [...drained, ...flushed],
  };
}

async function within(step: ShutdownStep, deadline: number): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<string>((resolve) => {
    timer = setTimeout(
      () => resolve(`${step.name} still running at the bound`),
      Math.max(0, deadline - Date.now()),
    );
  });
  const stopped = (async () => {
    try {
      return await step.stop(deadline);
    } catch (error) {
      return `${step.name} failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  try {
    return await Promise.race([stopped, bound]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Waits for the actions in flight to reach none (§1.1): a request still
 * writing, or a step of the relay's or the scheduler's work. `inFlight` is
 * this process's count, `currentConcurrentActions()` in `@openokr/core`.
 */
export function waitForActions(inFlight: () => number): ShutdownStep {
  return {
    name: "actions",
    phase: "drain",
    async stop(deadline) {
      for (;;) {
        const count = inFlight();
        if (count === 0) {
          return "actions in flight: 0";
        }
        if (Date.now() + ACTION_POLL_MS >= deadline) {
          // A count, never an inflected word (no-english-plurals.test.ts).
          return `actions still in flight: ${count}`;
        }
        await new Promise((resolve) => setTimeout(resolve, ACTION_POLL_MS));
      }
    },
  };
}

/** Test seam. Never call this from application code. */
export function resetShutdown(): void {
  globals.openokrShutdown = undefined;
}
