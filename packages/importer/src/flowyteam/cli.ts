/**
 * `pnpm import:flowyteam`'s own arguments (P6-T02).
 *
 * Its own file rather than a branch in the spreadsheet command's parser: the
 * two commands share no flag but `--workspace` and `--as`, and a parser that
 * served both would spend most of itself deciding which command it was in.
 */
import { UsageError } from "../cli.ts";

export interface FlowyteamArgs {
  readonly source: string;
  readonly company: number | undefined;
  readonly workspace: string;
  readonly as: string;
  /** False is a dry run, which is the default. */
  readonly write: boolean;
  /**
   * The FlowyTeam server's storage directory (P6-T04c).
   *
   * `task_files` names a file on that server's own disk, and a read-only
   * MySQL connection cannot reach the bytes, so without this every local file
   * is a named line in the report rather than a blob with nothing behind it.
   */
  readonly filesRoot: string | undefined;
}

export const FLOWYTEAM_USAGE = `pnpm import:flowyteam --source <mysql://user:password@host:3306/database> --company <id> --workspace <slug> --as <email> [--files-root <path>] [--dry-run]

Reads a FlowyTeam MySQL database and never writes to it. A dry run unless
--write is given: it reports which FlowyTeam the source is, which company was
selected, and what a real run would create in the workspace.

It imports people, spaces, space membership, cycles, objectives, key results,
key result history, check-ins, KPI categories, KPIs and their records,
initiatives, tasks, checklists, task comments and watchers.

--files-root <path> points at the FlowyTeam server's storage directory. Task
files live on that server's own disk rather than in MySQL, so without it every
local file is reported by name instead of copied.

Run without --company to see the companies the source holds.`;

/**
 * The arguments, or a refusal naming what is wrong with them.
 *
 * `--company` is deliberately optional here and required by the run, because a
 * run without it is how somebody asks the source what companies it has. The
 * refusal that follows lists them, which a parser has no way to do.
 */
export function parseFlowyteamArgs(argv: readonly string[]): FlowyteamArgs {
  const values: Record<string, string> = {};
  let write = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === "--dry-run") {
      // Accepted and redundant: it is the only mode there is, and a person who
      // types what TECHNICAL-PLAN §7 spells should not be told it is not a flag.
      continue;
    }
    if (arg === "--write") {
      write = true;
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

  if (values.only !== undefined) {
    throw new UsageError(
      "--only selects which domains to import, and there are no mappers to select between yet. It arrives with them at P6-T03.",
    );
  }

  for (const required of ["source", "workspace", "as"] as const) {
    if (!values[required]) {
      throw new UsageError(`--${required} is required.\n\n${FLOWYTEAM_USAGE}`);
    }
  }

  const company = values.company;
  if (company !== undefined && !/^\d+$/.test(company)) {
    throw new UsageError(
      `--company is a FlowyTeam company id, which is a number. It says "${company}".`,
    );
  }

  return {
    source: values.source as string,
    company: company === undefined ? undefined : Number(company),
    workspace: values.workspace as string,
    as: values.as as string,
    write,
    filesRoot: values["files-root"],
  };
}
