/**
 * One FlowyTeam run (TECHNICAL-PLAN §7.1, P6-T02).
 *
 * Connect read-only, work out which FlowyTeam this is, pick the one company,
 * refuse a workspace that already holds another one, count what is there, and
 * record the run. Nothing is written into the target beyond the run's own row,
 * because the mappers arrive at P6-T03 and P6-T04.
 *
 * **The run row is recorded through the registry, as the member who ran it.**
 * The same two actions the spreadsheet importer uses, so a FlowyTeam run and a
 * spreadsheet run appear in one list and are audited the same way. There is no
 * ambient importer identity here either: `--as` names the person.
 */
import { type ActionCallContext, callAction } from "@openokr/core";
import type { Pool } from "pg";
import { countFor, requireCompany, SUMMARY_TABLES } from "./companies.ts";
import { introspect } from "./introspect.ts";
import { buildReport, type FlowyteamReport } from "./report.ts";
import { openSource, type Source, SourceError } from "./source.ts";

export interface FlowyteamRunOptions {
  readonly pool: Pool;
  readonly workspaceId: string;
  /** The member every write is authorised as. */
  readonly userId: string;
  /** A `mysql://user:password@host:port/database` address. */
  readonly url: string;
  readonly companyId: number | undefined;
  /** Opened for the caller when given, which is how the tests supply one. */
  readonly source?: Source;
}

export interface FlowyteamRunResult {
  readonly report: FlowyteamReport;
  readonly runId: string;
}

export async function runFlowyteamImport(
  options: FlowyteamRunOptions,
): Promise<FlowyteamRunResult> {
  const source = options.source ?? (await openSource({ url: options.url }));
  const ownsSource = options.source === undefined;

  const context: ActionCallContext = {
    pool: options.pool,
    workspaceId: options.workspaceId,
    actor: { kind: "human", userId: options.userId },
    // One bulk load: the feed records it and nobody is notified.
    bulk: true,
  };

  try {
    const introspection = await introspect(source);
    const company = await requireCompany(source, options.companyId);
    await guardCompany(context, company.id);

    // Only the tables this instance has. Counting a table that is not there
    // would fail the summary whose whole job is to say what is there.
    const present = SUMMARY_TABLES.filter(
      (table) => !missingTables(introspection).has(table),
    );
    const counts = await countFor(source, company.id, present);

    const report = buildReport({
      connectedTo: source.describe,
      introspection,
      company,
      counts,
      mode: "dry_run",
    });

    const { id: runId } = await callAction(context, "imports.startRun", {
      source: "flowyteam",
      mode: "dry_run",
      filename: source.describe,
    });
    await callAction(context, "imports.finishRun", {
      id: runId,
      status: "completed",
      rowsRead: Object.values(counts).reduce((sum, n) => sum + n, 0),
      rowsWritten: 0,
      rowsSkipped: 0,
      report: report as unknown as Record<string, unknown>,
    });

    return { report, runId };
  } finally {
    if (ownsSource) {
      await source.close();
    }
  }
}

/** As much of a run row as the guard reads. */
export interface PriorRun {
  readonly source: string;
  readonly status: string;
  readonly report: Record<string, unknown>;
}

/**
 * The company this workspace already holds, or null.
 *
 * Pure, and separate from the fetch, because the decision is the part worth
 * testing and the fetch is one line. It reads what earlier runs recorded rather
 * than a column added for it: the company is in each run's own report, which is
 * where a person looking for it would also go.
 *
 * A run that failed is ignored. A run that died before it recorded a company
 * says nothing about which company this workspace holds, and refusing on it
 * would mean one crashed run locking a workspace out of every company for good.
 */
export function companyAlreadyImported(
  runs: readonly PriorRun[],
  companyId: number,
): number | null {
  for (const run of runs) {
    if (run.source !== "flowyteam" || run.status !== "completed") {
      continue;
    }
    const before = run.report.companyId;
    if (typeof before === "number" && before !== companyId) {
      return before;
    }
  }
  return null;
}

/**
 * A workspace holds one company, for good.
 *
 * Two companies in one workspace would share its spaces, members and cycles,
 * and nothing afterwards could tell them apart. There is no undo for that, so
 * the check is before the first row rather than after.
 */
export async function guardCompany(
  context: ActionCallContext,
  companyId: number,
): Promise<void> {
  const { runs } = await callAction(context, "imports.listRuns", {
    limit: 100,
  });
  const before = companyAlreadyImported(runs, companyId);
  if (before !== null) {
    throw new SourceError(
      `This workspace already holds FlowyTeam company ${before}. A workspace holds one company, because two would share its spaces, members and cycles and nothing afterwards could tell them apart. Import company ${companyId} into a workspace of its own.`,
    );
  }
}

function missingTables(
  introspection: Awaited<ReturnType<typeof introspect>>,
): ReadonlySet<string> {
  return new Set(Object.values(introspection.domains).flat());
}
