/**
 * One table out of a file, whichever of the two formats it is (P6-T01a).
 *
 * The extension decides, and an unknown one is refused by name rather than
 * guessed at. A `.txt` file that happens to be comma-separated is a file
 * somebody can rename; a reader that tried both formats on every file would
 * report "no header row" for a spreadsheet it opened as text.
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parseCsv, type Table } from "./csv.ts";
import { readXlsx } from "./xlsx.ts";

export { parseCsv, parseCsvLines, type Table } from "./csv.ts";
export { cellToText, readXlsx, sheetToTable } from "./xlsx.ts";

/** The formats a spreadsheet import reads. */
export const READABLE_EXTENSIONS = [".csv", ".xlsx"] as const;

export async function readTable(path: string): Promise<Table> {
  const extension = extname(path).toLowerCase();
  if (extension === ".csv") {
    // utf8 with the byte-order mark left in: the CSV parser strips it, and
    // stripping it in two places is how one of them comes to disagree.
    return parseCsv(await readFile(path, "utf8"));
  }
  if (extension === ".xlsx") {
    return readXlsx(path);
  }
  throw new Error(
    `An import reads ${READABLE_EXTENSIONS.join(" and ")} files. "${extension || path}" is neither.`,
  );
}
