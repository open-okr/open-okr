#!/usr/bin/env node
import { readFile } from "node:fs/promises";
/**
 * `pnpm import:csv`: a spreadsheet into a workspace (TECHNICAL-PLAN §7, P6-T01a).
 *
 * **A dry run unless told otherwise.** CLAUDE.md's own line for this command
 * says "dry-run by default", and it is the right default for the one command in
 * this product that writes a thousand rows on one keystroke. `--write` is the
 * word that makes it real.
 *
 * **`--as` names the person the import acts as, and there is no way around
 * it.** Every write goes through the Operation pipeline, which resolves an
 * acting member and authorises against their bindings; a command that invented
 * an ambient administrator would be the one service account with no owner that
 * CLAUDE.md forbids. The audit rows name whoever ran it.
 *
 * Exit codes follow `pnpm okr`: 2 for a usage error decided before anything is
 * sent, 1 for the instance refusing.
 */
import { loadEnv } from "@openokr/config";
import {
  activeOnly,
  users,
  withWorkspace,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { parseMappingFile } from "../mapping.ts";
import { READABLE_EXTENSIONS } from "../readers/index.ts";
import { runImport } from "../run.ts";
import { ENTITIES } from "../templates/index.ts";

interface Args {
  readonly entity?: string;
  readonly file?: string;
  readonly workspace?: string;
  readonly as?: string;
  readonly map?: string;
  readonly write: boolean;
}

const USAGE = `pnpm import:csv --entity <${ENTITIES.join("|")}> --file <path> --workspace <slug> --as <email> [--map <mapping.json>] [--write]

Reads ${READABLE_EXTENSIONS.join(" and ")} files. A dry run unless --write is given: it
reports every row it would create, update or skip, and writes nothing.`;

function parseArgs(argv: readonly string[]): Args {
  const values: Record<string, string> = {};
  let write = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--dry-run") {
      // Accepted and redundant: §7 spells the flag, and a person who types it
      // should not be told it does not exist.
      continue;
    }
    if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split("=", 2);
      const next = inline ?? argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`${arg} needs a value.`);
      }
      values[name as string] = next;
      if (inline === undefined) {
        index += 1;
      }
      continue;
    }
    throw new UsageError(`I do not know what "${arg}" is.`);
  }
  return {
    ...(values.entity ? { entity: values.entity } : {}),
    ...(values.file ? { file: values.file } : {}),
    ...(values.workspace ? { workspace: values.workspace } : {}),
    ...(values.as ? { as: values.as } : {}),
    ...(values.map ? { map: values.map } : {}),
    write,
  };
}

class UsageError extends Error {}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const args = parseArgs(argv);
  for (const required of ["entity", "file", "workspace", "as"] as const) {
    if (!args[required]) {
      throw new UsageError(`--${required} is required.\n\n${USAGE}`);
    }
  }
  if (!ENTITIES.includes(args.entity as string)) {
    throw new UsageError(
      `--entity is one of: ${ENTITIES.join(", ")}. It says "${args.entity}".`,
    );
  }

  const mapping = args.map
    ? parseMappingFile(await readFile(args.map, "utf8"), args.map)
    : undefined;
  if (mapping?.entity && mapping.entity !== args.entity) {
    throw new UsageError(
      `That mapping is for ${mapping.entity} and this run is for ${args.entity}.`,
    );
  }

  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const db = drizzle(pool);
    const [workspace] = await db
      .select({ id: workspaces.id, name: workspaces.name })
      // openokr:allow-raw-read: resolving which workspace the run is for
      // happens before there is a tenant scope to read inside, the same
      // shape `pnpm cadence:sweep` and `pnpm audit:verify` already have.
      .from(workspaces)
      .where(
        activeOnly(workspaces, eq(workspaces.slug, args.workspace as string)),
      )
      .limit(1);
    if (!workspace) {
      throw new Error(`No workspace has the slug "${args.workspace}".`);
    }

    const userId = await withWorkspace(db, workspace.id, async (tx) => {
      const [row] = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.workspaceId, workspace.id),
            eq(workspaceMembers.status, "active"),
            eq(users.email, (args.as as string).toLowerCase()),
          ),
        )
        .limit(1);
      return row?.userId ?? undefined;
    });
    if (!userId) {
      throw new Error(
        `"${args.as}" is not an active member of ${workspace.name}, so the import has nobody to run as.`,
      );
    }

    const { report, runId } = await runImport({
      pool,
      workspaceId: workspace.id,
      userId,
      entity: args.entity as string,
      file: args.file as string,
      ...(mapping ? { mapping } : {}),
      dryRun: !args.write,
    });

    process.stdout.write(`${render(report, runId)}\n`);
    if (report.skipped > 0) {
      // A file that partly imported is not a success, and a script wrapping
      // this command should be able to tell without parsing the report.
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

function render(
  report: Awaited<ReturnType<typeof runImport>>["report"],
  runId: string,
): string {
  const lines: string[] = [];
  lines.push(
    report.mode === "dry_run"
      ? `Dry run of ${report.file} as ${report.entity}. Nothing was written.`
      : `Imported ${report.file} as ${report.entity}.`,
  );
  lines.push(
    `${report.rowsRead} row(s) read: ${report.created} to create, ${report.updated} to update, ${report.skipped} skipped.`.replace(
      "to create",
      report.mode === "dry_run" ? "to create" : "created",
    ),
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

try {
  await main();
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
