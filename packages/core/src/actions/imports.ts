/**
 * Import runs (TECHNICAL-PLAN §7.1 step 7, P6-T01a).
 *
 * **Three actions rather than direct inserts, for the reason every write in
 * this product goes through the pipeline.** A run row records that somebody
 * loaded a spreadsheet into a workspace, which is exactly the kind of write an
 * administrator asks about a quarter later: who ran it, when, what it wrote and
 * what it refused. Inserting it from the command line would leave no audit row
 * to answer with.
 *
 * **Two writes, not one.** A run is recorded as it starts, so a run that dies
 * halfway leaves a row saying it was running rather than no row at all. That is
 * the difference between an import somebody can ask about and an import nobody
 * can account for.
 *
 * **`full`, not `edit`.** An import writes across every domain at once and its
 * report names rows the reader may not otherwise reach. Loading somebody else's
 * quarter into a workspace is an administrative act.
 */
import { activeOnly, importRuns, withWorkspace } from "@openokr/db";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { ASSIST_FEATURE_KEYS } from "../ai/assist-keys.ts";
import { checkFeatureAvailability } from "../ai/budgets.ts";
import { LEGACY_SOURCES } from "../imports/legacy.ts";
import { templateFor } from "../imports/templates/index.ts";
import { OperationError } from "../operations/errors.ts";
import { actingMemberId } from "./api-tokens.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const IMPORT_MODES = ["dry_run", "real"] as const;
const IMPORT_STATUSES = ["running", "completed", "failed"] as const;

/**
 * The report, as whatever the importer put in it.
 *
 * Deliberately unconstrained here: its shape belongs to `packages/importer` and
 * differs per source, per-row errors for a spreadsheet and per-table
 * reconciliation for FlowyTeam. A schema in this file would be a second
 * definition to keep in step with the one that writes it.
 */
const report = z.record(z.string(), z.unknown());

export const startImportRun = defineWriteAction({
  name: "imports.startRun",
  summary: "Records an import run as it starts, before anything is loaded.",
  input: z.object({
    source: z.enum(LEGACY_SOURCES),
    /** Which entity template a spreadsheet run is loading. Absent for a whole-company run. */
    entity: z.string().trim().min(1).max(60).optional(),
    mode: z.enum(IMPORT_MODES),
    filename: z.string().trim().min(1).max(400).optional(),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const memberId = await actingMemberId(
        tx,
        workspaceId,
        context.actor.userId,
      );

      // openokr:allow-mutation: the calling Operation's own transaction.
      const [row] = await tx
        .insert(importRuns)
        .values({
          workspaceId,
          source: input.source,
          entity: input.entity ?? null,
          mode: input.mode,
          status: "running",
          filename: input.filename ?? null,
          requestedById: memberId,
        })
        .returning({ id: importRuns.id });
      if (!row) {
        throw new Error("The import run insert returned no row.");
      }

      return {
        result: { id: row.id },
        activity: {
          kind: "import.started" as const,
          subjectType: "workspace" as const,
          subjectId: workspaceId,
          payload: {
            source: input.source,
            mode: input.mode,
            ...(input.entity ? { entity: input.entity } : {}),
          },
        },
        audit: {
          action: "imports.startRun",
          targetType: "import_run",
          targetId: row.id,
          payload: {
            source: input.source,
            mode: input.mode,
            entity: input.entity ?? null,
            filename: input.filename ?? null,
          },
        },
      };
    },
  }),
});

export const finishImportRun = defineWriteAction({
  name: "imports.finishRun",
  summary: "Closes an import run with its counts and its report.",
  input: z.object({
    id: z.uuid(),
    status: z.enum(["completed", "failed"]),
    rowsRead: z.number().int().min(0),
    rowsWritten: z.number().int().min(0),
    rowsSkipped: z.number().int().min(0),
    report: report.optional(),
    /** Why the run failed as a whole. A row that could not be read is a skip in the report. */
    error: z.string().trim().min(1).max(2000).optional(),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [run] = await tx
        .select({ id: importRuns.id, status: importRuns.status })
        .from(importRuns)
        .where(
          activeOnly(
            importRuns,
            eq(importRuns.workspaceId, workspaceId),
            eq(importRuns.id, input.id),
          ),
        )
        .limit(1);
      if (!run) {
        throw new OperationError("not_found", "No such import run.");
      }
      if (run.status !== "running") {
        // A run closes once. A second close would overwrite the counts of the
        // first with whatever the caller happens to hold now.
        throw new OperationError(
          "forbidden",
          "That import run has already finished.",
        );
      }

      const finishedAt = new Date();
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(importRuns)
        .set({
          status: input.status,
          rowsRead: input.rowsRead,
          rowsWritten: input.rowsWritten,
          rowsSkipped: input.rowsSkipped,
          report: input.report ?? {},
          error: input.error ?? null,
          finishedAt,
          updatedAt: finishedAt,
        })
        .where(activeOnly(importRuns, eq(importRuns.id, input.id)));

      return {
        result: { id: input.id },
        activity: {
          kind: "import.finished" as const,
          subjectType: "workspace" as const,
          subjectId: workspaceId,
          payload: {
            status: input.status,
            rowsWritten: input.rowsWritten,
            rowsSkipped: input.rowsSkipped,
          },
        },
        audit: {
          action: "imports.finishRun",
          targetType: "import_run",
          targetId: input.id,
          payload: {
            status: input.status,
            rowsRead: input.rowsRead,
            rowsWritten: input.rowsWritten,
            rowsSkipped: input.rowsSkipped,
          },
        },
      };
    },
  }),
});

export const listImportRuns = defineReadAction({
  name: "imports.listRuns",
  summary: "This workspace's import runs, newest first, with their reports.",
  input: z.object({ limit: z.number().int().min(1).max(100).default(20) }),
  output: z.object({
    runs: z.array(
      z.object({
        id: z.uuid(),
        source: z.enum(LEGACY_SOURCES),
        entity: z.string().nullable(),
        mode: z.enum(IMPORT_MODES),
        status: z.enum(IMPORT_STATUSES),
        filename: z.string().nullable(),
        rowsRead: z.number().int(),
        rowsWritten: z.number().int(),
        rowsSkipped: z.number().int(),
        report: report,
        error: z.string().nullable(),
        startedAt: z.string(),
        finishedAt: z.string().nullable(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.full,
  async handler(context, input) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const rows = await tx
        .select({
          id: importRuns.id,
          source: importRuns.source,
          entity: importRuns.entity,
          mode: importRuns.mode,
          status: importRuns.status,
          filename: importRuns.filename,
          rowsRead: importRuns.rowsRead,
          rowsWritten: importRuns.rowsWritten,
          rowsSkipped: importRuns.rowsSkipped,
          report: importRuns.report,
          error: importRuns.error,
          startedAt: importRuns.startedAt,
          finishedAt: importRuns.finishedAt,
        })
        .from(importRuns)
        .where(
          activeOnly(
            importRuns,
            eq(importRuns.workspaceId, context.workspaceId),
          ),
        )
        .orderBy(desc(importRuns.startedAt))
        .limit(input.limit);

      return {
        runs: rows.map((row) => ({
          ...row,
          startedAt: row.startedAt.toISOString(),
          finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
        })),
      };
    });
  },
});

/**
 * A proposed column mapping, or nothing (P6-T01b-a).
 *
 * **A proposal, checked field by field before anybody sees it.** The model
 * answers with one field name per column and this keeps only the names the
 * entity's template actually has: a field it invented is dropped, and the
 * column comes back unclaimed for a person to name. Two columns claiming one
 * field keep the first, because a field can only carry one column and choosing
 * between them is the reader's call, not a model's.
 *
 * **Null is a first-class answer.** No provider, the feature turned off, a
 * refusal, a model that fell over: all of them mean the screen offers the
 * manual path, which is the alias matching in `resolveMapping` and is complete
 * on its own. That is AI-NATIVE-PLAN §1's deterministic-first rule as code.
 */
export const proposeImportMapping = defineReadAction({
  name: "imports.proposeMapping",
  summary:
    "Proposes which column carries which field, for a human to confirm. Null with the provider off.",
  input: z.object({
    entity: z.string().trim().min(1).max(60),
    /** The file's headers, in file order. */
    headers: z.array(z.string().max(200)).min(1).max(200),
    /** The first body row, when there is one. A header alone is often ambiguous. */
    sample: z.array(z.string().max(500)).max(200).optional(),
  }),
  output: z
    .object({
      /** Header to field, for the headers the proposal claimed. */
      columns: z.record(z.string(), z.string()),
      /** Headers it left for a person, either by choice or because the field was not real. */
      unclaimed: z.array(z.string()),
      notes: z.string(),
    })
    .nullable(),
  access: ACCESS_LEVELS.full,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.proposeImportMapping) {
      return null;
    }
    const template = templateFor(input.entity);
    const availability = await checkFeatureAvailability(context.pool, {
      workspaceId: context.workspaceId,
      featureKey: ASSIST_FEATURE_KEYS.proposeImportMapping,
      defaultTier: "fast",
    });
    if (!availability.available) {
      return null;
    }

    let proposed: Awaited<
      ReturnType<NonNullable<typeof drafter.proposeImportMapping>>
    >;
    try {
      proposed = await drafter.proposeImportMapping({
        entity: template.entity,
        describe: template.describe,
        headers: input.headers,
        fields: template.columns.map((column) => ({
          field: column.field,
          describe: column.describe,
          required: column.required,
        })),
        sample: input.sample ?? [],
      });
    } catch {
      return null;
    }
    if (!proposed) {
      return null;
    }

    const known = new Set(template.columns.map((column) => column.field));
    const columns: Record<string, string> = {};
    const unclaimed: string[] = [];
    const taken = new Set<string>();

    input.headers.forEach((header, index) => {
      const field = (proposed.fields[index] ?? "").trim();
      if (field === "" || !known.has(field) || taken.has(field)) {
        // Unclaimed rather than refused, and the three reasons are on purpose
        // indistinguishable to the reader: whichever it was, the column is
        // theirs to name.
        unclaimed.push(header);
        return;
      }
      taken.add(field);
      columns[header] = field;
    });

    return { columns, unclaimed, notes: proposed.notes.trim() };
  },
});
