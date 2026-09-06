/**
 * Comma-separated export (TECHNICAL-PLAN §4.9, P5-T13).
 *
 * **The rows and columns a reader can see, and no others.** An export that
 * quietly carried a column the screen hides would be a way to read past the
 * interface, and one that dropped a row the screen shows would be a file nobody
 * can reconcile. The caller passes what it drew; this turns it into a file.
 *
 * **Every value is quoted.** Quoting only what needs it is smaller and is a
 * decision to make per value, and the one that gets it wrong ships a file that
 * opens wrong in one spreadsheet and right in another. Quoting everything is
 * boring and correct.
 *
 * **A leading `=`, `+`, `-` or `@` is prefixed with a single quote.** A
 * spreadsheet treats those as formulas, so a goal titled `=cmd|...` is a
 * command somebody's spreadsheet will offer to run. This is the standard
 * mitigation and it is not optional: the values here are typed by people, and
 * one of them may not be friendly.
 *
 * Pure: no database, no filesystem, no framework.
 */

/** The characters a spreadsheet reads as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

const quote = (value: unknown): string => {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};

export interface CsvTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
}

/**
 * One table as a CSV file's bytes.
 *
 * CRLF line endings, which is what RFC 4180 asks for and what Excel expects on
 * every platform. The byte-order mark is deliberate: without it Excel on
 * Windows reads a UTF-8 file as the system codepage and a name with an accent
 * in it comes out wrong.
 */
export function toCsv(table: CsvTable): string {
  const lines = [
    table.columns.map(quote).join(","),
    ...table.rows.map((row) => row.map(quote).join(",")),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
