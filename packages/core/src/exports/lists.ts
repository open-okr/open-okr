/**
 * What a list export is made of (TECHNICAL-PLAN §4.9, P5-T15).
 *
 * **Its own module because two callers need it and one of them is the relay.**
 * `actions/exports.ts` builds a file inside a request; `exports/worker.ts`
 * builds the same file later, for the same member, when the list was too large
 * to wait for. Two copies of these queries would be two answers about what a
 * list contains, and the inline file and the queued one would drift apart.
 *
 * **One `CsvTable` and two renderers.** A workbook built from its own query
 * would be a second answer about what a list contains, and the first thing to
 * disagree would be access.
 *
 * **`callAction` is a type here and a parameter at runtime.** The registry
 * imports every action and an action imports this module, so importing the
 * registry back for a value would put this module inside that cycle. Both
 * callers already hold the function, so they pass it.
 */
import type { callAction } from "../actions/registry.ts";
import { type CsvTable, toCsv } from "./csv.ts";
import type { Exportable, Format } from "./kinds.ts";
import { toXlsx } from "./xlsx.ts";

/**
 * The file's name, which is the only place its format is announced.
 *
 * Dated, because a person who exports the same list weekly ends up with four
 * files in one folder and needs to tell them apart without opening them.
 */
export function exportFilename(list: string, format: Format): string {
  return `${list}-${new Date().toISOString().slice(0, 10)}.${format}`;
}

/** One table as whichever file was asked for. */
export async function render(
  table: CsvTable,
  format: Format,
): Promise<{ csv: string | null; xlsxBase64: string | null }> {
  if (format === "xlsx") {
    const bytes = await toXlsx(table);
    return { csv: null, xlsxBase64: bytes.toString("base64") };
  }
  return { csv: toCsv(table), xlsxBase64: null };
}

/** The registry's own caller, handed in rather than imported. */
export type ActionCaller = typeof callAction;

export async function gather(
  call: ActionCaller,
  context: Parameters<ActionCaller>[0],
  input: { list: Exportable; cycleId?: string; spaceId?: string },
): Promise<CsvTable> {
  switch (input.list) {
    case "goals": {
      const cycleId =
        input.cycleId ??
        (await call(context, "cycles.current", { mode: "quarterly" }))?.id;
      if (!cycleId) {
        return { columns: GOAL_COLUMNS, rows: [] };
      }
      const { goals } = await call(context, "goals.list", {
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
      const rows = await call(context, "initiatives.list", {
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
      const rows = await call(context, "tasks.list", {});
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
      const grid = await call(context, "kpis.grid", { periods: 1 });
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
