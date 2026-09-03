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
 * **XLSX is not here, and the reason is on the P5-T15 row.** `exceljs` was
 * approved and then refused by this repository's own licence gate: its tree
 * pulls `buffers@0.1.1`, whose licence is unknown, and AGPL-3.0 cannot
 * distribute what nobody can name. Agung chose on 3 September 2026 to ship CSV
 * and make the spreadsheet its own row.
 */
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { type CsvTable, toCsv } from "../exports/csv.ts";
import { defineWriteAction } from "./define.ts";
import { callAction } from "./registry.ts";

/** The lists a person can take away, and the columns each one has. */
const EXPORTABLE = ["goals", "initiatives", "tasks", "kpis"] as const;
type Exportable = (typeof EXPORTABLE)[number];

/**
 * How many rows go in a file before it is worth doing elsewhere.
 *
 * Above this the export is handed to the outbox and the caller is told to wait,
 * which is what §4.9's "run asynchronously for large sets" asks for. Below it a
 * person clicking Export gets a file, which is what they wanted.
 */
const EXPORT_INLINE_LIMIT = 5000;

export const exportList = defineWriteAction({
  name: "exports.list",
  summary:
    "One list as a CSV file, matching the rows and columns the screen shows. Audited.",
  input: z.object({
    list: z.enum(EXPORTABLE),
    /** Narrows a goal or task list the way the screen narrows it. */
    cycleId: z.uuid().optional(),
    spaceId: z.uuid().optional(),
  }),
  output: z.object({
    filename: z.string(),
    /** The file itself, when it was small enough to build here. */
    csv: z.string().nullable(),
    rowCount: z.number().int(),
    /** True when the set was too large and the outbox is building it. */
    queued: z.boolean(),
  }),
  // A read of the product's own data, so `view` rather than `edit`: an export
  // takes out exactly what the person could already read on a screen, and
  // asking for more would put the file behind a wall the list is not behind.
  access: ACCESS_LEVELS.view,
  operation: (context, input) => ({
    requires: ACCESS_LEVELS.view,
    async execute({ workspaceId, actor }) {
      const table = await gather(context, input);
      const queued = table.rows.length > EXPORT_INLINE_LIMIT;
      const filename = `${input.list}-${new Date().toISOString().slice(0, 10)}.csv`;

      return {
        result: {
          filename,
          csv: queued ? null : toCsv(table),
          rowCount: table.rows.length,
          queued,
        },
        ...(queued
          ? {
              // Handed to the relay rather than built in the request. The row
              // carries what to export and for whom; the file reaches them the
              // way every other long job's output does.
              outbox: [
                {
                  topic: "export.requested",
                  payload: {
                    workspaceId,
                    list: input.list,
                    ...(input.cycleId ? { cycleId: input.cycleId } : {}),
                    ...(input.spaceId ? { spaceId: input.spaceId } : {}),
                    requestedByMemberId: actor.memberId,
                  },
                  idempotencyKey: `export.requested:${workspaceId}:${input.list}:${Date.now()}`,
                },
              ],
            }
          : {}),
        activity: {
          kind: "export.taken",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { list: input.list, rowCount: table.rows.length },
        },
        audit: {
          action: "exports.list",
          targetType: "workspace",
          targetId: workspaceId,
          // The one row an administrator will come looking for.
          payload: {
            list: input.list,
            rowCount: table.rows.length,
            queued,
          },
        },
      };
    },
  }),
});

/**
 * The rows, read through the same action the screen reads.
 *
 * Every one of these is access-filtered by its own action, so an export can
 * never carry a row its reader could not see on a page.
 */
async function gather(
  context: Parameters<typeof callAction>[0],
  input: { list: Exportable; cycleId?: string; spaceId?: string },
): Promise<CsvTable> {
  switch (input.list) {
    case "goals": {
      const cycleId =
        input.cycleId ??
        (await callAction(context, "cycles.current", { mode: "quarterly" }))
          ?.id;
      if (!cycleId) {
        return { columns: GOAL_COLUMNS, rows: [] };
      }
      const { goals } = await callAction(context, "goals.list", {
        cycleId,
        includeClosed: true,
      });
      return {
        columns: GOAL_COLUMNS,
        rows: goals.map((goal) => [
          goal.title,
          goal.level,
          goal.health,
          goal.progressPct,
          goal.champion.name,
          goal.reviewer.name,
          goal.keyResults.length,
        ]),
      };
    }
    case "initiatives": {
      const rows = await callAction(context, "initiatives.list", {
        ...(input.spaceId ? { spaceId: input.spaceId } : {}),
      });
      return {
        columns: INITIATIVE_COLUMNS,
        rows: rows.map((one) => [
          one.title,
          one.spaceName,
          one.ownerName,
          one.status,
          one.capacity ?? "not judged",
          one.startsOn ?? "",
          one.endsOn ?? "",
          one.keyResultIds.length,
        ]),
      };
    }
    case "tasks": {
      const rows = await callAction(context, "tasks.list", {});
      return {
        columns: TASK_COLUMNS,
        rows: rows.map((one) => [
          one.title,
          one.status,
          one.dueOn ?? "",
          one.keyResultTitle ?? "",
          one.assignees.map((who) => who.name).join("; "),
          `${one.checklist.done}/${one.checklist.total}`,
        ]),
      };
    }
    case "kpis": {
      const grid = await callAction(context, "kpis.grid", { periods: 1 });
      return {
        columns: KPI_COLUMNS,
        rows: grid.kpis.map((kpi) => [
          kpi.title,
          kpi.categoryId ?? "",
          kpi.frequency,
          kpi.direction,
          kpi.unit ?? "",
        ]),
      };
    }
    default:
      return { columns: [], rows: [] };
  }
}

const GOAL_COLUMNS = [
  "Objective",
  "Level",
  "Health",
  "Progress %",
  "Champion",
  "Reviewer",
  "Key results",
] as const;

const INITIATIVE_COLUMNS = [
  "Initiative",
  "Space",
  "Owner",
  "Status",
  "Capacity",
  "Starts",
  "Ends",
  "Key results",
] as const;

const TASK_COLUMNS = [
  "Task",
  "Status",
  "Due",
  "Key result",
  "Assignees",
  "Checklist",
] as const;

const KPI_COLUMNS = [
  "KPI",
  "Category id",
  "Frequency",
  "Direction",
  "Unit",
] as const;
