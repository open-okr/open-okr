/**
 * `pnpm import:flowyteam`'s own arguments (P6-T02).
 *
 * Its own file rather than a branch in the spreadsheet command's parser: the
 * two commands share no flag but `--workspace` and `--as`, and a parser that
 * served both would spend most of itself deciding which command it was in.
 */
import { DOMAIN_KEYS, selectDomains, UnknownDomainError } from "@openokr/core";
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
  /**
   * Which domains to import (P6-T04d). Absent means all of them.
   *
   * A domain named here brings its own prerequisites and the report says so,
   * because naming `objectives` has not said "skip the people the objectives
   * are championed by".
   */
  readonly only: readonly string[] | undefined;
  /**
   * Confirms that KPIs with restricted visibility in FlowyTeam may become visible
   * to all workspace members in OpenOKR.
   */
  readonly acceptBroaderVisibility: boolean;
}

export const FLOWYTEAM_USAGE = `pnpm import:flowyteam --source <mysql://user:password@host:3306/database> --company <id> --workspace <slug> --as <email> [--only <domains>] [--files-root <path>] [--accept-broader-visibility] [--dry-run]

Reads a FlowyTeam MySQL database and never writes to it. A dry run unless
--write is given: it reports which FlowyTeam the source is, which company was
selected, and what a real run would create in the workspace.

It imports people, spaces, space membership, cycles, objectives, key results,
key result history, check-ins, KPI categories, KPIs and their records,
initiatives, tasks, checklists, task comments and watchers. The tables it does
not read, such as discussions, KPI sharing and points, are counted and named in
every report instead.

--only <domains> is a comma-separated list, and the default is all of them:
${DOMAIN_KEYS.join(", ")}.
A domain brings whatever it depends on: --only objectives runs the organisation
first and says so, because an objective names a champion, a reviewer, a cycle
and a space.

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
  let acceptBroaderVisibility = false;

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
    if (arg === "--accept-broader-visibility") {
      acceptBroaderVisibility = true;
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

  const result: FlowyteamArgs = {
    source: values.source as string,
    company: company === undefined ? undefined : Number(company),
    workspace: values.workspace as string,
    as: values.as as string,
    write,
    acceptBroaderVisibility,
    filesRoot: values["files-root"],
    only: onlyFrom(values.only),
  };

  if (result.filesRoot === undefined) {
    delete (result as unknown as Record<string, unknown>).filesRoot;
  }
  if (result.only === undefined) {
    delete (result as unknown as Record<string, unknown>).only;
  }
  if (!result.acceptBroaderVisibility) {
    delete (result as unknown as Record<string, unknown>)
      .acceptBroaderVisibility;
  }

  return result;
}

/**
 * The `--only` list, checked before anything connects.
 *
 * A typo here is a usage error and not a quiet smaller import: somebody who
 * types `--only objetives` has asked for objectives, and importing nothing
 * while reporting success is the worst answer available.
 */
function onlyFrom(value: string | undefined): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const keys = value
    .split(",")
    .map((key) => key.trim().toLowerCase())
    .filter((key) => key !== "");
  if (keys.length === 0) {
    throw new UsageError("--only needs at least one domain.");
  }
  try {
    selectDomains(keys);
  } catch (error) {
    if (error instanceof UnknownDomainError) {
      throw new UsageError(error.message);
    }
    throw error;
  }
  return keys;
}
