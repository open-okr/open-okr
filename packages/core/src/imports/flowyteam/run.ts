/**
 * One FlowyTeam run (TECHNICAL-PLAN §7.1, P6-T02).
 *
 * The engine part, in core since flowyteam-connect card C2 so the web
 * application and the scheduler can run it. The caller opens the source and
 * hands it in; `packages/importer` does that for the command line over MySQL.
 *
 * Work out which FlowyTeam this is, pick the one company,
 * refuse a workspace that already holds another one, count what is there, and
 * record the run. Nothing is written into the target beyond the run's own row,
 * because the mappers arrive at P6-T03 and P6-T04.
 *
 * **The run row is recorded through the registry, as the member who ran it.**
 * The same two actions the spreadsheet importer uses, so a FlowyTeam run and a
 * spreadsheet run appear in one list and are audited the same way. There is no
 * ambient importer identity here either: `--as` names the person.
 */

import type { Pool } from "pg";
import type { ActionCallContext } from "../../actions/define.ts";
import { callAction } from "../../actions/registry.ts";
import { resolveActingMemberId } from "../target.ts";
import { countFor, requireCompany, SUMMARY_TABLES } from "./companies.ts";
import { selectDomains } from "./domains.ts";
import type { BlobStorage, SourceFileReader } from "./files.ts";
import { introspect } from "./introspect.ts";
import type { DomainReconciliation } from "./mappers/reconcile.ts";
import { resolverFor } from "./mappers/resolve.ts";
import { buildReport, type FlowyteamReport } from "./report.ts";
import { type Source, SourceError } from "./source.ts";
import { countUnread } from "./unread.ts";

export interface FlowyteamEngineOptions {
  readonly pool: Pool;
  readonly workspaceId: string;
  /** The member every write is authorised as. */
  readonly userId: string;
  readonly companyId: number | undefined;
  /** Opened and closed by the caller. */
  readonly source: Source;
  /**
   * False reports what a real run would do and writes nothing (P6-T03a).
   *
   * A dry run still resolves every source id against the target, so its counts
   * are what a real run would actually write rather than what the source holds.
   * That is the whole difference between a preview and a guess.
   */
  readonly write?: boolean;
  /**
   * Where this instance keeps its own bytes (P6-T04c). Built by the entry
   * point from `OPENOKR_STORAGE_ROOT`, and supplied directly by the tests.
   * Without it no blob is written, which is what a dry run wants.
   */
  readonly storage?: BlobStorage;
  /** Reads the source's files; `--files-root` on the command line. */
  readonly files?: SourceFileReader;
  /**
   * Which domains to import, from `--only` (P6-T04d).
   *
   * Absent means all of them. A domain named here brings its own
   * prerequisites, because `objectives` on its own has not said "skip the
   * people the objectives are championed by"; `domains.ts` holds the order
   * and the reasons.
   */
  readonly only?: readonly string[];
  /**
   * Confirms that KPIs with restricted visibility in FlowyTeam may become visible
   * to all workspace members in OpenOKR.
   */
  readonly acceptBroaderVisibility?: boolean;
  /**
   * The run row a caller already recorded, so the engine does not start a
   * second one. The browser import records it before the first read, so a
   * run FlowyTeam refuses still has a row saying why (flowyteam-connect C4).
   */
  readonly runId?: string;
  /** How the source was reached, kept on the report: `export` over HTTP. */
  readonly via?: "export" | "mysql";
  /**
   * Resume a real run at this domain, with what the earlier part reported.
   * Every domain is idempotent, so a domain repeated after an expiry
   * writes nothing twice.
   */
  readonly startAt?: string;
  readonly carried?: FlowyteamCarried;
  /**
   * Epoch milliseconds after which a real run stops between two domains and
   * returns `paused`, so a follow-up job continues before the job expires.
   * Ignored for a dry run, whose planned rows live only in this process.
   */
  readonly deadline?: number;
  /** Told before each domain runs, for progress. */
  readonly onDomain?: (key: string, index: number, total: number) => void;
  readonly now?: () => number;
}

/** What the domains already run reported, handed to the next part of a run. */
export interface FlowyteamCarried {
  readonly reconciliation: readonly DomainReconciliation[];
  readonly notes: readonly string[];
}

export interface FlowyteamRunResult {
  readonly report: FlowyteamReport;
  readonly runId: string;
  /** Set when the run stopped at its deadline: where to continue. */
  readonly paused?: { readonly next: string } & FlowyteamCarried;
}

export async function runFlowyteamEngine(
  options: FlowyteamEngineOptions,
): Promise<FlowyteamRunResult> {
  const { source } = options;

  const context: ActionCallContext = {
    pool: options.pool,
    workspaceId: options.workspaceId,
    actor: { kind: "human", userId: options.userId },
    // One bulk load: the feed records it and nobody is notified.
    bulk: true,
  };

  const introspection = await introspect(source);
  const company = await requireCompany(source, options.companyId);
  await guardCompany(context, company.id);

  // Only the tables this instance has. Counting a table that is not there
  // would fail the summary whose whole job is to say what is there.
  const present = SUMMARY_TABLES.filter(
    (table) => !missingTables(introspection).has(table),
  );
  const counts = await countFor(source, company.id, present);
  // Every run, whatever `--only` names: no domain reads these tables, so a
  // run that left them out of its report would be dropping them silently
  // (completeness review M-16).
  const unread = await countUnread(source, company.id);

  const write = options.write ?? false;
  // Recorded before the first row, so a run that dies halfway leaves a row
  // saying it was running rather than no row at all.
  const runId =
    options.runId ??
    (
      await callAction(context, "imports.startRun", {
        source: "flowyteam",
        mode: write ? "real" : "dry_run",
        filename: source.describe,
      })
    ).id;

  const mapper = {
    source,
    context,
    companyId: company.id,
    // One resolver for the whole run: an objective names a champion, a
    // reviewer, a cycle and a space, and every one of those was written by
    // the mapper before it.
    resolver: resolverFor({
      pool: options.pool,
      workspaceId: options.workspaceId,
    }),
    actingMemberId: await resolveActingMemberId(
      options.pool,
      options.workspaceId,
      options.userId,
    ),
    write,
    ...(options.storage && write ? { storage: options.storage } : {}),
    ...(options.files ? { files: options.files } : {}),
  };
  // Which domains, in which order, and why each one needs the last: all of
  // that lives in `domains.ts` now, so `--only` reads the same rules a full
  // run does rather than a second copy of them.
  const selection = selectDomains(options.only);

  if (
    write &&
    selection.domains.some((d) => d.key === "kpis" || d.key === "kpi-shares")
  ) {
    const hasIndicatorAccesses =
      !missingTables(introspection).has("indicator_accesses");
    if (hasIndicatorAccesses) {
      const flagged = await source.read<{ id: number }>(
        "kpis.flaggedAccess",
        [],
        company.id,
      );
      if (flagged.length > 0 && !options.acceptBroaderVisibility) {
        throw new Error(
          "Refusing to write: flagged KPIs exist that may lead to broader visibility for all workspace members. Re-run with --accept-broader-visibility to proceed.",
        );
      }
    }
  }

  const reconciliation: DomainReconciliation[] = [
    ...(options.carried?.reconciliation ?? []),
  ];
  const notes: string[] = [...(options.carried?.notes ?? [])];
  const start =
    options.startAt === undefined
      ? 0
      : selection.domains.findIndex((d) => d.key === options.startAt);
  if (start < 0) {
    throw new SourceError(`"${options.startAt}" is not a domain of this run.`);
  }
  const now = options.now ?? Date.now;
  for (let index = start; index < selection.domains.length; index += 1) {
    const domain = selection.domains[index];
    if (!domain) {
      break;
    }
    if (
      write &&
      index > start &&
      options.deadline !== undefined &&
      now() >= options.deadline
    ) {
      return {
        runId,
        report: buildReport({
          connectedTo: source.describe,
          introspection,
          company,
          counts,
          mode: "real",
          reconciliation,
          selected: selection.domains.map((d) => d.key),
          addedForDependencies: selection.added,
          unread,
          extraNotes: notes,
        }),
        paused: { next: domain.key, reconciliation, notes },
      };
    }
    options.onDomain?.(domain.key, index, selection.domains.length);
    const outcome = await domain.run(mapper);
    reconciliation.push(...outcome.domains);
    notes.push(...outcome.notes);
  }

  const report = buildReport({
    connectedTo: source.describe,
    introspection,
    company,
    counts,
    mode: write ? "real" : "dry_run",
    reconciliation,
    selected: selection.domains.map((domain) => domain.key),
    addedForDependencies: selection.added,
    unread,
    extraNotes: notes,
    ...(options.via ? { via: options.via } : {}),
  });

  await callAction(context, "imports.finishRun", {
    id: runId,
    status: "completed",
    rowsRead: report.reconciliation.reduce(
      (sum, domain) => sum + domain.read,
      0,
    ),
    rowsWritten: report.written,
    rowsSkipped: report.skipped,
    report: report as unknown as Record<string, unknown>,
  });

  return { report, runId };
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
async function guardCompany(
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
