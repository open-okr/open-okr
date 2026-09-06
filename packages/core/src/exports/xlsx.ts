/**
 * Workbook export (TECHNICAL-PLAN §4.9, P5-T15).
 *
 * **The same table the CSV writer takes, so the two files cannot disagree.**
 * `gather()` in `actions/exports.ts` builds one `CsvTable` and both formats
 * render it. A workbook assembled from its own query would be a second answer
 * about what a list contains, and the first thing to diverge would be access.
 *
 * **A number is written as a number.** That is the whole reason somebody asks
 * for a workbook rather than a CSV: a progress figure they can sum, sort and
 * chart without the spreadsheet guessing at the text. The CSV keeps every value
 * quoted because the format carries no types; this one carries them, so it
 * uses them.
 *
 * **No apostrophe prefix here, and that is not an oversight.** `csv.ts` puts a
 * `'` in front of a value starting with `=`, `+`, `-` or `@` because a CSV cell
 * has no declared type and a spreadsheet decides for itself. An XLSX cell says
 * what it is: a string cell holding `=cmd|'/c calc'!A1` is text, and Excel
 * displays it rather than running it. Copying the CSV's mitigation would put a
 * visible apostrophe into every such title for no protection that the format
 * does not already give.
 *
 * **The dependency is `write-excel-file`, MIT, over `fflate`, MIT.** Two
 * packages, both on the licence gate's existing allow list, so the gate passes
 * with nothing added to it. `exceljs` was approved first and refused the same
 * day: its tree pulls `buffers@0.1.1`, whose licence nobody can name, and
 * AGPL-3.0 cannot distribute that. Agung chose this one on 3 September 2026.
 *
 * Not a port and not a vendor SDK: this is a serialiser, the same kind of thing
 * as `csv.ts`, with no network, no clock and no configuration.
 */
import writeXlsxFile from "write-excel-file/node";
import type { CsvTable } from "./csv.ts";

/**
 * How wide a column is allowed to get.
 *
 * A rich-text excerpt or a long objective title would otherwise open a column
 * wider than the screen, and every other column would be pushed out of sight.
 * Excel wraps what does not fit, which is what a reader wants.
 */
const MAX_COLUMN_WIDTH = 60;

/** How narrow a column may be, so a one-character heading is still readable. */
const MIN_COLUMN_WIDTH = 10;

/** One table as the bytes of an `.xlsx` file. */
export async function toXlsx(table: CsvTable): Promise<Buffer> {
  const header = table.columns.map((column) => ({
    value: column,
    fontWeight: "bold" as const,
  }));

  const body = table.rows.map((row) => row.map(cell));

  return writeXlsxFile([header, ...body], {
    // Named rather than left as "Sheet1", because a person who exports four
    // lists into one folder has four files and needs to know which is which
    // with the file open.
    sheet: "Export",
    // The heading stays put while somebody scrolls a thousand rows. Without it
    // a large export is unreadable past the first screen, and a large export is
    // exactly what this format is for.
    stickyRowsCount: 1,
    columns: widths(table),
  }).toBuffer();
}

/**
 * One value as a cell.
 *
 * `null` and `undefined` become an empty cell rather than the string "null",
 * which is what `gather()` already means by them: a field nobody filled in.
 */
function cell(
  value: unknown,
):
  | { value: string; type: StringConstructor }
  | { value: number; type: NumberConstructor }
  | { value: boolean; type: BooleanConstructor }
  | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { value, type: Number };
  }
  if (typeof value === "boolean") {
    return { value, type: Boolean };
  }
  return { value: String(value), type: String };
}

/**
 * A width per column, from the longest thing in it.
 *
 * Measured rather than fixed, because these tables hold a member's name beside
 * a rich-text excerpt and one width cannot serve both. Only the first two
 * hundred rows are measured: a hundred thousand rows would make this the slow
 * part of an export, and a column's widest value is almost never past the top.
 */
function widths(table: CsvTable): { width: number }[] {
  const sample = table.rows.slice(0, 200);
  return table.columns.map((column, index) => {
    let longest = column.length;
    for (const row of sample) {
      const value = row[index];
      const length =
        value === null || value === undefined ? 0 : String(value).length;
      if (length > longest) {
        longest = length;
      }
    }
    return {
      width: Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(MIN_COLUMN_WIDTH, longest + 2),
      ),
    };
  });
}
