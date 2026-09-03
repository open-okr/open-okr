/**
 * Exporting a list (TECHNICAL-PLAN §4.9, P5-T13).
 *
 * **An export is the one action that takes data out of the product, so every
 * one is audited.** Who exported what, and when, is a question an administrator
 * will eventually need answered, and the answer has to exist before they ask.
 * That is why this is a write action rather than a read: it goes through the
 * Operation pipeline for the audit row, and the file it returns is the result.
 *
 * **The rows are read through the same actions the screen reads.** An export
 * that ran its own query would be a second answer about what a list contains,
 * and the first thing to disagree would be access: a row the screen hides and
 * the file carries is a way to read past the interface.
 *
 * **Two formats, one table.** `gather()` builds one `CsvTable` and `csv.ts`
 * or `xlsx.ts` renders it, so the two files cannot come to disagree about what
 * a list contains. The writer is `write-excel-file` (MIT, over `fflate`, MIT),
 * chosen at P5-T15 after `exceljs` was approved and refused the same day by
 * this repository's licence gate.
 *
 * **A large export is a row in `export_runs`, not a longer request.** Above
 * the inline limit nothing is built here: the run is recorded, the relay builds
 * the file and puts it in storage, and the person collects it from their own
 * list. A request that waited would time out on the size that made it wait.
 */
import {
  activeOnly,
  exportRuns,
  newId,
  withWorkspace,
  workspaces,
} from "@openokr/db";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { actingMemberId } from "../exports/collect.ts";
import { EXPORT_TOPIC, EXPORTABLE, FORMATS } from "../exports/kinds.ts";
import { exportFilename, gather, render } from "../exports/lists.ts";
import type { OperationTx } from "../operations/operation.ts";
import { OperationError } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";
import { callAction } from "./registry.ts";

/**
 * How many rows go in a file before it is worth doing elsewhere.
 *
 * Above this the export is handed to the outbox and the caller is told to wait,
 * which is what §4.9's "run asynchronously for large sets" asks for. Below it a
 * person clicking Export gets a file, which is what they wanted.
 *
 * **A setting, not a constant.** §4.9 asks for the behaviour and names no
 * figure, so the number belongs in the §4.14 map with a working default rather
 * than compiled in: an instance whose lists are small wants it lower, and one
 * on fast disks wants it higher. `exportInlineRowLimit` is the key and 5000 is
 * what a fresh workspace resolves without anybody configuring anything.
 */
const EXPORT_LIMIT_SETTING = "exportInlineRowLimit";
const EXPORT_INLINE_LIMIT_DEFAULT = 5000;

/** The workspace's own limit, or the default it inherits. */
async function inlineLimit(
  tx: OperationTx,
  workspaceId: string,
): Promise<number> {
  const [workspace] = await tx
    .select({ settings: workspaces.settings })
    // openokr:allow-raw-read: called only from inside the export Operation's
    // own execute, on the transaction it opened. The workspace's own settings
    // are not a protected aggregate; the export they bound already went
    // through the access getter.
    .from(workspaces)
    .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
    .limit(1);
  const stored = (workspace?.settings as Record<string, unknown> | undefined)?.[
    EXPORT_LIMIT_SETTING
  ];
  return typeof stored === "number" && Number.isInteger(stored) && stored > 0
    ? stored
    : EXPORT_INLINE_LIMIT_DEFAULT;
}

export const exportList = defineWriteAction({
  name: "exports.list",
  summary:
    "One list as a CSV file, matching the rows and columns the screen shows. Audited.",
  input: z.object({
    list: z.enum(EXPORTABLE),
    /** Narrows a goal or task list the way the screen narrows it. */
    cycleId: z.uuid().optional(),
    spaceId: z.uuid().optional(),
    // CSV by default, because it is the format every tool reads and the one a
    // caller who names nothing almost certainly wants.
    format: z.enum(FORMATS).default("csv"),
  }),
  output: z.object({
    filename: z.string(),
    /** The file itself, when it was small enough to build here. */
    csv: z.string().nullable(),
    /**
     * The same file as bytes, for a format that is not text.
     *
     * Base64 rather than a second request: the action already built it, and a
     * download route would build it again to answer a question this answer
     * already holds. Only ever set for a format `csv` cannot carry.
     */
    xlsxBase64: z.string().nullable(),
    rowCount: z.number().int(),
    /** True when the set was too large and the outbox is building it. */
    queued: z.boolean(),
    /** The `export_runs` row to collect it from, when it was queued. */
    runId: z.uuid().nullable(),
  }),
  // **`edit`, not `view`, and the first draft of this file had it wrong.**
  // The argument for `view` was that an export takes out exactly what the
  // person could already read on a screen. That is true of one row and false of
  // a list: reading is bounded by attention and a file is not, so bulk
  // extraction is its own act and the registry's own rule already says so. No
  // write is reachable at `view`, whatever its domain, and this action writes.
  // Every active member holds `edit` across the workspace through P3-T01's
  // standard binding, so this narrows nobody except a deliberately view-only
  // grant, which is the case the rule exists for.
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    requires: ACCESS_LEVELS.edit,
    async execute({ tx, workspaceId, actor }) {
      const table = await gather(callAction, context, input);
      const queued = table.rows.length > (await inlineLimit(tx, workspaceId));
      const filename = exportFilename(input.list, input.format);

      // **Built here only when it is small, and never for a queued run.** The
      // limit is what separates a file somebody gets now from one worth a
      // worker, and building both would spend the cost this limit exists to
      // avoid.
      const inline = queued ? null : await render(table, input.format);

      // The row a person comes back to. Written before the outbox row, in the
      // same transaction, so a relay that picks the delivery up immediately
      // finds a run to move rather than a topic with nothing behind it.
      const runId = queued ? newId() : null;
      if (runId) {
        if (!actor.memberId) {
          throw new OperationError(
            "forbidden",
            "An export belongs to the member who asked for it.",
          );
        }
        // openokr:allow-mutation: the calling Operation's own transaction.
        await tx.insert(exportRuns).values({
          id: runId,
          workspaceId,
          kind: "list",
          list: input.list,
          format: input.format,
          cycleId: input.cycleId ?? null,
          spaceId: input.spaceId ?? null,
          requestedById: actor.memberId,
          state: "queued",
          rowCount: table.rows.length,
          filename,
        });
      }

      return {
        result: {
          filename,
          csv: inline?.csv ?? null,
          xlsxBase64: inline?.xlsxBase64 ?? null,
          rowCount: table.rows.length,
          queued,
          runId,
        },
        ...(runId
          ? {
              // Handed to the relay rather than built in the request. The row
              // names the run; everything the worker needs to rebuild the file
              // is on the run, so the payload cannot drift from it.
              outbox: [
                {
                  topic: EXPORT_TOPIC,
                  payload: { workspaceId, runId },
                  // The run's own identifier. A redelivery names the same run,
                  // which the worker treats as the same work rather than as a
                  // second file.
                  idempotencyKey: `${EXPORT_TOPIC}:${runId}`,
                },
              ],
            }
          : {}),
        activity: {
          kind: "export.taken",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: {
            list: input.list,
            format: input.format,
            rowCount: table.rows.length,
          },
        },
        audit: {
          action: "exports.list",
          targetType: "workspace",
          targetId: workspaceId,
          // The one row an administrator will come looking for.
          payload: {
            list: input.list,
            format: input.format,
            rowCount: table.rows.length,
            queued,
          },
        },
      };
    },
  }),
});

/**
 * A member's own exports, newest first (P5-T15).
 *
 * **Their own, and an administrator's is not an exception.** The file holds
 * exactly the rows that member could see when the worker built it, so handing
 * it to somebody with a wider grant would hand them rows their own access never
 * reached. The filter is on `requested_by_id` and there is no parameter that
 * widens it.
 *
 * A read rather than part of the export write: it is the list a person opens
 * to see whether the thing they asked for has arrived, and opening a list is
 * not an act worth auditing.
 */
export const listMyExports = defineReadAction({
  name: "exports.mine",
  summary: "The exports you have asked for, and which of them are ready.",
  input: z.object({ limit: z.number().int().min(1).max(100).default(20) }),
  output: z.array(
    z.object({
      id: z.uuid(),
      list: z.string(),
      format: z.enum(FORMATS),
      state: z.enum(["queued", "building", "ready", "failed"]),
      rowCount: z.number().int().nullable(),
      filename: z.string(),
      /** Null until the worker has one, and the reason the row is not a link yet. */
      blobId: z.uuid().nullable(),
      error: z.string().nullable(),
      requestedAt: z.string(),
      finishedAt: z.string().nullable(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const { limit } = z
      .object({ limit: z.number().int().min(1).max(100).default(20) })
      .parse(input ?? {});

    return withWorkspace(
      drizzle(context.pool),
      context.workspaceId,
      async (tx) => {
        const memberId = await actingMemberId(tx, context);
        if (!memberId) {
          return [];
        }
        const rows = await tx
          .select({
            id: exportRuns.id,
            list: exportRuns.list,
            format: exportRuns.format,
            state: exportRuns.state,
            rowCount: exportRuns.rowCount,
            filename: exportRuns.filename,
            blobId: exportRuns.blobId,
            error: exportRuns.error,
            createdAt: exportRuns.createdAt,
            finishedAt: exportRuns.finishedAt,
          })
          .from(exportRuns)
          .where(
            activeOnly(
              exportRuns,
              eq(exportRuns.workspaceId, context.workspaceId),
              eq(exportRuns.requestedById, memberId),
            ),
          )
          .orderBy(desc(exportRuns.createdAt))
          .limit(limit);

        return rows.map((row) => ({
          id: row.id,
          list: row.list,
          format: row.format,
          state: row.state,
          rowCount: row.rowCount,
          filename: row.filename,
          blobId: row.blobId,
          error: row.error,
          requestedAt: row.createdAt.toISOString(),
          finishedAt: row.finishedAt?.toISOString() ?? null,
        }));
      },
    );
  },
});
