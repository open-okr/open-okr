/**
 * What `pnpm db:change` does, apart from connecting (plan 0.8.0 H10c).
 *
 * Kept out of `bin/data-change.ts` so the exit codes and what is printed can
 * be tested against a real database without starting a process. The command
 * itself only reads the environment, connects and exits with what this
 * returns.
 *
 * | Arguments | Does | Exit |
 * |---|---|---|
 * | none, or `run` | Every script not yet complete, to the end, waiting for another run's lock | 0, or 1 when a script fails |
 * | `--status` | Nothing. Names each script not yet complete | 0 |
 * | `--max-seconds <n>` | The same run, stopped between batches once `n` seconds have passed, and nothing at all when another run holds the lock. Ends with what `--status` says | 0, or 1 when a script fails |
 *
 * A usage error is 2 and is decided before anything connects.
 *
 * **`run` is accepted as the name of the default** (plan 0.8.1 U1). Early
 * versions needed it and 0.7.0 ignored anything it did not know, so an
 * operator's upgrade script could pass it for years. 0.8.0 refused it as an
 * unknown argument, and the demo server's upgrade stopped halfway on exactly
 * that. A refusal in the middle of an upgrade costs more than a lenient word.
 */
import {
  type DataChangeClient,
  type DataChangeOutcome,
  type DataChangeScript,
  type DataChangeStatus,
  dataChangeStatus,
  runDataChanges,
  runDataChangesWithin,
} from "./data-change.ts";

export type DataChangeCommand =
  | { readonly status: true }
  | { readonly status: false; readonly maxSeconds?: number };

const USAGE =
  "Usage: data-change.ts [run] [--status | --max-seconds <whole seconds, 1 or more>]";

/** The command line, or why it is not one. */
export function parseDataChangeArgs(
  argv: readonly string[],
): DataChangeCommand | { readonly usage: string } {
  let status = false;
  let run = false;
  let maxSeconds: number | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (arg === "run" && index === 0) {
      run = true;
      continue;
    }
    if (arg === "--status") {
      status = true;
      continue;
    }
    if (arg === "--max-seconds" || arg.startsWith("--max-seconds=")) {
      const value = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : argv[++index];
      if (value === undefined || !/^\d+$/.test(value) || Number(value) < 1) {
        return {
          usage: `--max-seconds takes a whole number of seconds, 1 or more.\n${USAGE}`,
        };
      }
      maxSeconds = Number(value);
      continue;
    }
    return { usage: `Unknown argument ${arg}.\n${USAGE}` };
  }
  if (status && maxSeconds !== undefined) {
    return { usage: `--status runs nothing, so it takes no budget.\n${USAGE}` };
  }
  if (status && run) {
    return { usage: `run and --status ask for opposite things.\n${USAGE}` };
  }
  return status
    ? { status: true }
    : { status: false, ...(maxSeconds !== undefined ? { maxSeconds } : {}) };
}

export interface DataChangeCommandIo {
  out(text: string): void;
  err(text: string): void;
}

/** Runs the command. Returns the exit code. */
export async function dataChangeCommand(
  client: DataChangeClient,
  scripts: readonly DataChangeScript[],
  command: DataChangeCommand,
  io: DataChangeCommandIo,
): Promise<0 | 1> {
  if (command.status) {
    io.out(describeStatus(await dataChangeStatus(client, scripts)));
    return 0;
  }

  try {
    if (command.maxSeconds === undefined) {
      const outcomes = await runDataChanges(client, { scripts });
      io.out(
        outcomes.length === 0
          ? "Nothing to run. Every registered script is already complete.\n"
          : describeOutcomes(outcomes),
      );
      return 0;
    }

    const run = await runDataChangesWithin(client, {
      scripts,
      maxSeconds: command.maxSeconds,
    });
    if (!run.ran) {
      io.out(
        "Another data-change run holds the lock, so this one runs nothing. " +
          "That run finishes what is pending.\n",
      );
    } else {
      io.out(
        run.outcomes.length === 0
          ? "Nothing to run.\n"
          : describeOutcomes(run.outcomes),
      );
      if (run.stopped) {
        io.out(
          `Stopped at the ${command.maxSeconds}-second budget, between two ` +
            "batches. Nothing is lost: the next run resumes where this one stopped.\n",
        );
      }
    }
    io.out(describeStatus(await dataChangeStatus(client, scripts)));
    return 0;
  } catch (error) {
    // The runner's message names the script and the batch, and says the
    // committed batches are kept. The cause's message says why; never its
    // detail, which can carry a row's values.
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? ` ${error.cause.message}`
        : "";
    io.err(
      `Data change failed: ${error instanceof Error ? error.message : String(error)}${cause}\n`,
    );
    return 1;
  }
}

function describeOutcomes(outcomes: readonly DataChangeOutcome[]): string {
  return `Ran ${outcomes.length} script(s):\n${outcomes
    .map(
      (outcome) =>
        `  ${outcome.name}: ${outcome.batches} batch(es), ${outcome.rowsChanged} row(s) changed` +
        (outcome.rowsSkipped ? `, ${outcome.rowsSkipped} skipped` : ""),
    )
    .join("\n")}\n`;
}

/** What `--status` prints, and what a run inside a budget ends with. */
function describeStatus(status: readonly DataChangeStatus[]): string {
  const open = status.filter((one) => one.state !== "complete");
  if (open.length === 0) {
    return `Data changes: all ${status.length} complete.\n`;
  }
  return (
    `Data changes: ${open.length} of ${status.length} not complete. ` +
    "Run them with `pnpm db:change`, or `./openokr data-change` on Docker " +
    "Compose. On Kubernetes the next `helm upgrade` runs them, or " +
    "docs/install/kubernetes.md says how to now.\n" +
    `${open.map((one) => `  ${one.name}: ${one.state}. ${one.summary}`).join("\n")}\n`
  );
}
