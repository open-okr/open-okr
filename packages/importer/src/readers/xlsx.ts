/**
 * The XLSX reader (TECHNICAL-PLAN §7.1 step 2, P6-T01a).
 *
 * **Every cell becomes a string, and the templates coerce from there.** A
 * spreadsheet cell already has a type, and it is tempting to keep it: a number
 * is a number, a date is a date. The trouble is that the same column arrives
 * typed from XLSX and untyped from CSV, and two coercion paths for one field
 * means two behaviours to test and one of them will be wrong. One reader shape
 * for both formats keeps the templates the only place a value is interpreted.
 *
 * The one thing worth doing here rather than later is the date, and it is worth
 * getting right: `read-excel-file` turns a spreadsheet serial into a `Date` at
 * **UTC** midnight of the day the cell shows. Reading that back through the
 * local parts moves it to the previous day anywhere west of UTC, which for a
 * due date is a deadline a day early. The UTC parts are the day the cell holds.
 * Proved by a round trip through a real file rather than by reasoning, because
 * the reasoning is exactly what was wrong here first time.
 *
 * `read-excel-file` (MIT) is the reader, approved on 3 September 2026 after
 * `exceljs` was refused by `pnpm check:licences` at P5-T15. Its author also
 * wrote `write-excel-file`, which the export path already uses.
 */
import { readSheet } from "read-excel-file/node";
import type { Table } from "./csv.ts";

/** One cell as the characters a mapping and a template can work with. */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    // UTC parts, because that is where the reader puts the day. See above.
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

/** The rows of a sheet as a table, in the same shape the CSV reader returns. */
export function sheetToTable(sheet: readonly unknown[][]): Table {
  const [header, ...body] = sheet;
  if (!header || header.every((cell) => cellToText(cell).trim() === "")) {
    throw new Error("That sheet has no header row.");
  }
  const headers = header.map((cell) => cellToText(cell).trim());

  const rows = body
    .map((line) => line.map(cellToText))
    .filter((line) => line.some((cell) => cell.trim() !== ""))
    .map((line) => {
      const padded = [...line];
      while (padded.length < headers.length) {
        padded.push("");
      }
      return padded;
    });

  return { headers, rows };
}

/**
 * The first sheet of an XLSX file as a table.
 *
 * The first sheet and not a named one: a file exported for an import has one
 * sheet, and a chooser belongs to the wizard in P6-T01b, which can offer the
 * names it finds. The command reads the first, which is what a file with one
 * sheet means.
 *
 * `readSheet` and not the package default: the default returns one entry per
 * sheet wrapping the rows, and this wants the rows.
 */
export async function readXlsx(path: string): Promise<Table> {
  const sheet = (await readSheet(path)) as unknown as readonly unknown[][];
  return sheetToTable(sheet);
}
