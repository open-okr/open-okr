/**
 * The CSV reader (TECHNICAL-PLAN §7.1 step 2, P6-T01a).
 *
 * **Written here rather than taken from a package**, for the same reason the
 * CSV writer in `packages/core/src/exports/csv.ts` was: RFC 4180 is a page
 * long, the whole of it is below, and a spreadsheet the product refuses to read
 * is a defect somebody has to be able to fix in this file.
 *
 * What it handles, because real files have all of it:
 *
 * - Quoted fields, and doubled quotes inside them (`"she said ""no"""`).
 * - Newlines inside quoted fields, which is why this is a character scanner
 *   rather than a split on line breaks.
 * - CRLF and LF line endings, mixed in one file.
 * - A byte-order mark, which is what Excel writes and what turns the first
 *   header into something no mapping matches.
 * - A trailing newline, which is not an empty last row.
 *
 * What it deliberately does not do is guess. A semicolon-separated file read as
 * one column per row reports one column per row, and the mapping refuses it by
 * name. A reader that sniffed the delimiter would sometimes sniff wrong, and
 * the failure would land three steps later as a coercion error on a field the
 * person never mentioned.
 */

/** A file as its header row and its body, exactly as the characters said. */
export interface Table {
  readonly headers: readonly string[];
  /** One entry per body row. A short row is padded to the header width. */
  readonly rows: readonly (readonly string[])[];
}

const BOM = "﻿";

/** Every field of every line, before the header is separated from the body. */
export function parseCsvLines(text: string): string[][] {
  const source = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const lines: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    lines.push(row);
    row = [];
  };

  while (index < source.length) {
    const char = source[index] as string;

    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      endField();
      index += 1;
      continue;
    }
    if (char === "\r") {
      // CRLF and a lone CR both end the row. A CR inside a quoted field is
      // handled above and never reaches here.
      endRow();
      index += source[index + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }

  // The last row, unless the file ended on a line break and left nothing.
  if (field !== "" || row.length > 0) {
    endRow();
  }
  return lines;
}

/**
 * A CSV file as a table, or a refusal naming what is wrong with it.
 *
 * An empty file and a file with headers and no rows are different things: the
 * first is refused, and the second is a table with no rows, which imports
 * nothing and says so.
 */
export function parseCsv(text: string): Table {
  const lines = parseCsvLines(text);
  const header = lines[0];
  if (!header || header.every((cell) => cell.trim() === "")) {
    throw new Error("That file has no header row.");
  }
  const headers = header.map((cell) => cell.trim());

  const rows = lines
    .slice(1)
    // A row of nothing but separators is what a spreadsheet leaves behind after
    // somebody deletes the contents of a line. It is not a row to import.
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
