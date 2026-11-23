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
import { withContext } from "@openokr/db";
import { drizzle } from "drizzle-orm/node-postgres";
import type { callAction } from "../actions/registry.ts";
import { serverTranslate } from "../i18n/catalogue.ts";
import { resolveMemberLanguage } from "../settings/member-language.ts";
import { actingMemberId } from "./collect.ts";
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

async function requesterLocale(context: Parameters<ActionCaller>[0]) {
  const { workspaceId, actor } = context;
  const memberId =
    actor.memberId ??
    (await withContext(
      drizzle(context.pool),
      { workspaceId, userId: actor.userId },
      (tx) => actingMemberId(tx, context),
    ));
  return memberId ? resolveMemberLanguage(context, memberId) : "en";
}

export async function gather(
  call: ActionCaller,
  context: Parameters<ActionCaller>[0],
  input: { list: Exportable; cycleId?: string; spaceId?: string },
): Promise<CsvTable> {
  const locale = await requesterLocale(context);
  const headers = (columns: readonly string[]) =>
    columns.map((key) => serverTranslate(locale, `exports.column.${key}`));

  switch (input.list) {
    case "goals": {
      const cycleId =
        input.cycleId ??
        (await call(context, "cycles.current", { mode: "quarterly" }))?.id;
      if (!cycleId) {
        return { columns: headers(GOAL_COLUMNS), rows: [] };
      }
      const { goals } = await call(context, "goals.list", {
        cycleId,
        includeClosed: true,
      });
      return {
        columns: headers(GOAL_COLUMNS),
        rows: goals.map((goal) => [
          goal.title,
          goal.level,
          goal.health,
          goal.progressPct,
          goal.champion.name,
          goal.reviewer?.name ?? "",
          goal.keyResults.length,
        ]),
      };
    }
    case "initiatives": {
      const rows = await call(context, "initiatives.list", {
        ...(input.spaceId ? { spaceId: input.spaceId } : {}),
      });
      return {
        columns: headers(INITIATIVE_COLUMNS),
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
        columns: headers(TASK_COLUMNS),
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
        columns: headers(KPI_COLUMNS),
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
  "objective",
  "level",
  "health",
  "progress",
  "owner",
  "reviewer",
  "keyResults",
] as const;

const INITIATIVE_COLUMNS = [
  "initiative",
  "space",
  "owner",
  "status",
  "capacity",
  "starts",
  "ends",
  "keyResults",
] as const;

const TASK_COLUMNS = [
  "task",
  "status",
  "due",
  "keyResult",
  "assignees",
  "checklist",
] as const;

const KPI_COLUMNS = [
  "kpi",
  "categoryId",
  "frequency",
  "direction",
  "unit",
] as const;
