/**
 * The run (TECHNICAL-PLAN §7.1, P6-T01a).
 *
 * **The dry run and the real run are the same code path.** Every row is read,
 * coerced, resolved and planned identically; the last step either calls the
 * action or does not. That is what makes §7's acceptance criterion a property
 * rather than a hope: the report a dry run produces is the report the real run
 * produces, because the same lines produced both.
 *
 * The one thing a dry run cannot know is what a row would do to the row after
 * it. A file of two objectives where the second aligns to the first reports the
 * second as an error in a dry run, because the parent does not exist yet and
 * the resolver refuses to pretend it does. The report says so in those words
 * rather than quietly counting it as creatable.
 *
 * **Rows are written one at a time, each in its own transaction.** That is what
 * "through the normal Operation pipeline" costs and what it buys: a row that
 * fails does not roll back the nine hundred before it, every row gets its
 * access bindings, its activity row, its audit row and its outbox row, and the
 * run can be resumed by running the same file again.
 */

import type { Pool } from "pg";
import type { ActionCallContext } from "../actions/define.ts";
import { callAction } from "../actions/registry.ts";
import { findExisting } from "./legacy-lookup.ts";
import {
  type Mapping,
  type MappingFile,
  resolveMapping,
  valuesFor,
} from "./mapping.ts";
import { readTable, type Table } from "./readers/index.ts";
import { referencesFor } from "./references.ts";
import { type EntityTemplate, templateFor } from "./templates/index.ts";

export interface RunOptions {
  readonly pool: Pool;
  readonly workspaceId: string;
  /** The user whose access every write is made with. */
  readonly userId: string;
  readonly entity: string;
  readonly file: string;
  readonly mapping?: MappingFile;
  /** True by default at the command line: nothing is written. */
  readonly dryRun: boolean;
}

/**
 * A run over a table somebody already read (P6-T01b-b).
 *
 * The wizard holds a table because the request carried bytes and the server
 * read them; the command holds a path. From here the two are one run: the same
 * mapping, the same loop, the same report, the same `import_runs` row.
 *
 * `name` is what the report and the run row call the file. A path at the
 * command line, an uploaded file's own name in the browser. It is a label and
 * nothing reads it back.
 */
export interface TableRunOptions {
  readonly pool: Pool;
  readonly workspaceId: string;
  readonly userId: string;
  readonly entity: string;
  readonly table: Table;
  readonly name: string;
  readonly mapping?: MappingFile;
  readonly dryRun: boolean;
}

/** What happened to one row, in the words the report uses. */
export interface RowOutcome {
  /** The line in the file, counting the header as line 1. */
  readonly line: number;
  readonly outcome: "created" | "updated" | "skipped";
  /** The row's own identifier from the source, when it has one. */
  readonly externalId?: string;
  /** Why it was skipped. Present only for a skip. */
  readonly reason?: string;
}

export interface RunReport {
  readonly entity: string;
  readonly file: string;
  readonly mode: "dry_run" | "real";
  readonly rowsRead: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  /** Headers the mapping did not claim. Not an error, and worth saying. */
  readonly unmappedHeaders: readonly string[];
  readonly rows: readonly RowOutcome[];
}

export interface RunResult {
  readonly report: RunReport;
  /** The `import_runs` row this run recorded itself in. */
  readonly runId: string;
}

export async function runImport(options: RunOptions): Promise<RunResult> {
  // The path is read here and nowhere else. Everything after it is the same
  // run the wizard performs, which is what stops the two surfaces drifting.
  const table = await readTable(options.file);
  return runTable({
    pool: options.pool,
    workspaceId: options.workspaceId,
    userId: options.userId,
    entity: options.entity,
    table,
    name: options.file,
    ...(options.mapping ? { mapping: options.mapping } : {}),
    dryRun: options.dryRun,
  });
}

export async function runTable(options: TableRunOptions): Promise<RunResult> {
  const template = templateFor(options.entity);
  const mapping = resolveMapping(
    template,
    options.table.headers,
    options.mapping,
  );

  const context: ActionCallContext = {
    pool: options.pool,
    workspaceId: options.workspaceId,
    actor: { kind: "human", userId: options.userId },
    // Every write this run makes, and the two run rows themselves, are part of
    // one bulk load: the feed still records them and nobody is notified.
    bulk: true,
  };

  const { id: runId } = await callAction(context, "imports.startRun", {
    source: "csv",
    entity: template.entity,
    mode: options.dryRun ? "dry_run" : "real",
    filename: options.name,
  });

  try {
    const report = await loadRows(
      context,
      template,
      mapping,
      options.table.rows,
      {
        entity: template.entity,
        file: options.name,
        dryRun: options.dryRun,
        unmappedHeaders: mapping.unmapped,
      },
    );

    await callAction(context, "imports.finishRun", {
      id: runId,
      status: "completed",
      rowsRead: report.rowsRead,
      rowsWritten: report.created + report.updated,
      rowsSkipped: report.skipped,
      report: report as unknown as Record<string, unknown>,
    });

    return { report, runId };
  } catch (error) {
    // The run as a whole failed: a file that could not be read, or a database
    // that went away. Row failures are skips and never reach here.
    await callAction(context, "imports.finishRun", {
      id: runId,
      status: "failed",
      rowsRead: 0,
      rowsWritten: 0,
      rowsSkipped: 0,
      error: messageOf(error).slice(0, 2000),
    }).catch(() => {
      // The close is best-effort: if the database is gone, the row stays
      // `running`, which is exactly what it should say.
    });
    throw error;
  }
}

async function loadRows(
  context: ActionCallContext,
  template: EntityTemplate,
  mapping: Mapping,
  rows: readonly (readonly string[])[],
  about: {
    entity: string;
    file: string;
    dryRun: boolean;
    unmappedHeaders: readonly string[];
  },
): Promise<RunReport> {
  const references = referencesFor({
    pool: context.pool,
    workspaceId: context.workspaceId,
    legacyType: "csv",
  });

  const outcomes: RowOutcome[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const seen = new Map<string, number>();

  for (const [index, row] of rows.entries()) {
    // The header is line 1, so the first body row is line 2. A report a person
    // can act on counts the way their spreadsheet does.
    const line = index + 2;
    const values = valuesFor(mapping, row);
    const externalId = template.legacyField
      ? values[template.legacyField]
      : undefined;

    const skip = (reason: string) => {
      skipped += 1;
      outcomes.push({
        line,
        outcome: "skipped",
        ...(externalId ? { externalId } : {}),
        reason,
      });
    };

    const missing = template.columns
      .filter((column) => column.required && !values[column.field])
      .map((column) => column.field);
    if (missing.length > 0) {
      skip(
        `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} empty.`,
      );
      continue;
    }

    if (template.legacyField && externalId) {
      const before = seen.get(externalId);
      if (before !== undefined) {
        // Two rows claiming one identity would write once and lose the other
        // silently. Naming the earlier line is what makes it fixable.
        skip(
          `The identifier "${externalId}" is already used by line ${before}.`,
        );
        continue;
      }
      seen.set(externalId, line);
    }

    try {
      const existingId =
        template.legacyTable && externalId
          ? await findExisting(
              context.pool,
              context.workspaceId,
              template.legacyTable,
              { type: "csv", id: externalId },
            )
          : undefined;

      const plan = await template.plan({
        values,
        legacyId: externalId ?? "",
        existingId,
        references,
      });

      if (about.dryRun) {
        // Planned and not written. The plan is what proves the row is
        // writable: it resolved every reference and coerced every value.
        if (plan.kind === "update") {
          updated += 1;
        } else {
          created += 1;
        }
        outcomes.push({
          line,
          outcome: plan.kind === "update" ? "updated" : "created",
          ...(externalId ? { externalId } : {}),
        });
        continue;
      }

      await callAction(
        context,
        plan.action as Parameters<typeof callAction>[1],
        plan.input as never,
      );

      if (plan.kind === "update") {
        updated += 1;
      } else {
        created += 1;
      }
      outcomes.push({
        line,
        outcome: plan.kind === "update" ? "updated" : "created",
        ...(externalId ? { externalId } : {}),
      });
    } catch (error) {
      skip(messageOf(error));
    }
  }

  return {
    entity: about.entity,
    file: about.file,
    mode: about.dryRun ? "dry_run" : "real",
    rowsRead: rows.length,
    created,
    updated,
    skipped,
    unmappedHeaders: about.unmappedHeaders,
    rows: outcomes,
  };
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Something went wrong loading that row.";
}
