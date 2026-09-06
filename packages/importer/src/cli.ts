/**
 * The command's own logic, with no input and no output (P6-T01a, moved here at
 * P6-T01b).
 *
 * Argument parsing and report rendering are the two things a command gets wrong
 * in ways nobody notices, and both are pure functions of their arguments. They
 * live here so they can be tested without a database, a file or a process: the
 * entry point in `bin/` is what opens the pool and writes to a stream.
 */
import { ENTITIES, READABLE_EXTENSIONS, type RunReport } from "@openokr/core";

/** A refusal decided before anything is sent. Exit 2, as `pnpm okr` uses it. */
export class UsageError extends Error {}

export interface Args {
  readonly entity: string;
  readonly file: string;
  readonly workspace: string;
  readonly as: string;
  readonly map?: string;
  /** False is a dry run, which is the default. */
  readonly write: boolean;
}

export const USAGE = `pnpm import:csv --entity <${ENTITIES.join("|")}> --file <path> --workspace <slug> --as <email> [--map <mapping.json>] [--write]

Reads ${READABLE_EXTENSIONS.join(" and ")} files. A dry run unless --write is given: it
reports every row it would create, update or skip, and writes nothing.`;

/**
 * The arguments, or a refusal naming what is wrong with them.
 *
 * `--flag value` and `--flag=value` both work, because both are what people
 * type. An unknown argument is refused rather than ignored: a misspelled
 * `--entty` that silently did nothing would look like the command ignoring the
 * file.
 */
export function parseArgs(argv: readonly string[]): Args {
  const values: Record<string, string> = {};
  let write = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--dry-run") {
      // Accepted and redundant: TECHNICAL-PLAN §7 spells this flag, and a
      // person who types it should not be told it does not exist.
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new UsageError(`I do not know what "${arg}" is.`);
    }
    const [name, inline] = arg.slice(2).split("=", 2);
    const next = inline ?? argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new UsageError(`${arg} needs a value.`);
    }
    values[name as string] = next;
    if (inline === undefined) {
      index += 1;
    }
  }

  for (const required of ["entity", "file", "workspace", "as"] as const) {
    if (!values[required]) {
      throw new UsageError(`--${required} is required.\n\n${USAGE}`);
    }
  }
  if (!ENTITIES.includes(values.entity as string)) {
    throw new UsageError(
      `--entity is one of: ${ENTITIES.join(", ")}. It says "${values.entity}".`,
    );
  }

  return {
    entity: values.entity as string,
    file: values.file as string,
    workspace: values.workspace as string,
    as: values.as as string,
    ...(values.map ? { map: values.map } : {}),
    write,
  };
}

/**
 * The report as the lines a person reads.
 *
 * Skips are listed and successes are counted, because a hundred lines saying a
 * row was created is not a report, and the two rows that were not are.
 */
export function render(report: RunReport, runId: string): string {
  const lines: string[] = [];
  lines.push(
    report.mode === "dry_run"
      ? `Dry run of ${report.file} as ${report.entity}. Nothing was written.`
      : `Imported ${report.file} as ${report.entity}.`,
  );
  lines.push(
    report.mode === "dry_run"
      ? `${report.rowsRead} row(s) read: ${report.created} to create, ${report.updated} to update, ${report.skipped} skipped.`
      : `${report.rowsRead} row(s) read: ${report.created} created, ${report.updated} updated, ${report.skipped} skipped.`,
  );
  if (report.unmappedHeaders.length > 0) {
    lines.push(
      `Columns nothing claimed: ${report.unmappedHeaders.join(", ")}. Supply --map to name them.`,
    );
  }
  for (const row of report.rows) {
    if (row.outcome === "skipped") {
      lines.push(`  line ${row.line}: skipped. ${row.reason}`);
    }
  }
  lines.push(`Run ${runId}.`);
  return lines.join("\n");
}
