/**
 * The FlowyTeam report (TECHNICAL-PLAN §7.1 step 7, P6-T02).
 *
 * **The report is a value, and rendering it is a separate function.** The
 * command prints it, the `import_runs` row stores it as jsonb, and P6-T03 will
 * add per-domain reconciliation to the same object. A report built as a string
 * would have to be parsed back to be stored, which is how the stored version
 * and the printed version come to disagree.
 *
 * **A dry run at this task produces an empty report, and that is the acceptance
 * criterion rather than a shortfall.** The connector's job is to prove it can
 * read the source, tell which FlowyTeam this is, name the company and read
 * nothing else. The mappers arrive at P6-T03 and P6-T04 and fill the counts
 * that are zero here.
 */
import type { Company, CompanyCounts } from "./companies.ts";
import type { Introspection } from "./introspect.ts";
import type { DomainReconciliation } from "./mappers/reconcile.ts";
import { describeDomain } from "./mappers/reconcile.ts";

/** What §7.2 records as out of scope, so the report says it rather than a plan. */
export const NOT_IMPORTED = [
  "webhooks and Zapier resthooks",
  "the universal search cache",
  "notification rows",
  "attendance and human-resources modules",
] as const;

export interface FlowyteamReport {
  readonly source: "flowyteam";
  /** The address with the password removed. */
  readonly connectedTo: string;
  readonly database: string;
  readonly mode: "dry_run" | "real";
  readonly companyId: number;
  readonly companyName: string;
  readonly version: Introspection["version"];
  readonly tableCount: number;
  /** Per domain, the expected tables this instance does not have. */
  readonly missingByDomain: Readonly<Record<string, readonly string[]>>;
  /** What the company holds, per source table. */
  readonly counts: CompanyCounts;
  /** Rows written into the target. Zero until the mappers land. */
  readonly written: number;
  readonly skipped: number;
  /** Rows that imported and carry a decision somebody has to make. */
  readonly flagged: number;
  /** One row per domain this run touched (P6-T03a). Empty for a run that read only. */
  readonly reconciliation: readonly DomainReconciliation[];
  readonly notImported: readonly string[];
  /** Anything a person has to know, in the words they should read. */
  readonly notes: readonly string[];
}

export function buildReport(input: {
  readonly connectedTo: string;
  readonly introspection: Introspection;
  readonly company: Company;
  readonly counts: CompanyCounts;
  readonly mode: "dry_run" | "real";
  readonly reconciliation?: readonly DomainReconciliation[];
  readonly extraNotes?: readonly string[];
}): FlowyteamReport {
  const missing = Object.entries(input.introspection.domains).filter(
    ([, tables]) => tables.length > 0,
  );

  const reconciliation = input.reconciliation ?? [];
  const written = reconciliation.reduce(
    (sum, domain) => sum + domain.created,
    0,
  );
  const skipped = reconciliation.reduce(
    (sum, domain) => sum + domain.skipped.length,
    0,
  );
  const flagged = reconciliation.reduce(
    (sum, domain) => sum + domain.flags.length,
    0,
  );

  return {
    source: "flowyteam",
    connectedTo: input.connectedTo,
    database: input.introspection.database,
    mode: input.mode,
    companyId: input.company.id,
    companyName: input.company.name,
    version: input.introspection.version,
    tableCount: input.introspection.tableCount,
    missingByDomain: input.introspection.domains,
    counts: input.counts,
    written,
    skipped,
    flagged,
    reconciliation,
    notImported: NOT_IMPORTED,
    notes: [
      ...missing.map(
        ([domain, tables]) =>
          `The ${domain} domain will import nothing: this instance has no ${tables.join(", ")}.`,
      ),
      ...(reconciliation.length === 0
        ? [
            "Nothing was written. The mappers that load a company's history arrive at P6-T03 and P6-T04; this run proves the source can be read and names what is in it.",
          ]
        : []),
      ...(input.extraNotes ?? []),
      ...(input.company.timezone
        ? [
            `The company's timezone is ${input.company.timezone}. It is offered as an edit to the workspace and never applied silently (TECHNICAL-PLAN §7.2).`,
          ]
        : []),
    ],
  };
}

/** The report as lines somebody reads in a terminal. */
export function render(report: FlowyteamReport, runId: string): string {
  const lines: string[] = [
    `FlowyTeam ${report.mode === "dry_run" ? "dry run" : "import"}: ${report.connectedTo}`,
    `Company ${report.companyId}, ${report.companyName}`,
    `Schema: ${report.tableCount} tables, ${report.version.migrationCount} migrations applied, the last on ${report.version.appliedOn ?? "an undated migration"} (${report.version.latestMigration})`,
    "",
    "In this company:",
  ];

  const width = Math.max(
    ...Object.keys(report.counts).map((table) => table.length),
    1,
  );
  for (const [table, count] of Object.entries(report.counts)) {
    lines.push(`  ${table.padEnd(width)}  ${count}`);
  }

  if (report.reconciliation.length > 0) {
    lines.push("", "Reconciliation:");
    for (const domain of report.reconciliation) {
      lines.push(`  ${describeDomain(domain)}${domain.clean ? "" : "  *"}`);
    }
    const lost = report.reconciliation.filter((domain) => !domain.clean);
    if (lost.length > 0) {
      lines.push("", "Rows that did not import:");
      for (const domain of lost) {
        for (const row of domain.skipped) {
          lines.push(`  ${row.source}: ${row.reason}`);
        }
      }
    }
    // Separate, and after, because these rows are here. Mixing them into the
    // list above made one live run read "16 created, 21 skipped".
    const flagged = report.reconciliation.filter(
      (domain) => domain.flags.length > 0,
    );
    if (flagged.length > 0) {
      lines.push("", "Imported, and worth a look:");
      for (const domain of flagged) {
        for (const row of domain.flags) {
          lines.push(`  ${row.source}: ${row.reason}`);
        }
      }
    }
  }

  lines.push(
    "",
    // A dry run has written nothing, and a line saying "Written: 50" under a
    // heading saying "dry run" is the kind of thing somebody reads in a hurry
    // and acts on.
    report.mode === "dry_run"
      ? `Would write: ${report.written}. Would skip: ${report.skipped}. Nothing was written.`
      : `Written: ${report.written}. Skipped: ${report.skipped}.`,
  );

  if (report.notes.length > 0) {
    lines.push("", "Worth knowing:");
    for (const note of report.notes) {
      lines.push(`  - ${note}`);
    }
  }

  lines.push(
    "",
    `Not imported by design: ${report.notImported.join(", ")}.`,
    `Run ${runId}`,
  );
  return lines.join("\n");
}
