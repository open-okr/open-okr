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
  const extension = extensionOf(path);
  if (extension === ".csv") {
    // utf8 with the byte-order mark left in: the CSV parser strips it, and
    // stripping it in two places is how one of them comes to disagree.
    return parseCsv(await readFile(path, "utf8"));
  }
  return readXlsx(path);
}

/**
 * The same table from bytes rather than from a path (P6-T01b).
 *
 * The wizard has the file in a request and no filename on disk, and the
 * command has a path. Both read the same way from here on, which is the point:
 * the report a screen shows and the report a terminal prints come from one
 * reader, one mapping and one runner.
 *
 * The XLSX reader takes a buffer directly. The CSV path decodes as utf8, which
 * is what a spreadsheet writes; a file in another encoding arrives as text with
 * replacement characters in it and its rows are refused by name rather than
 * silently mangled.
 */
export async function readBuffer(
  filename: string,
  bytes: Buffer,
): Promise<Table> {
  const extension = extensionOf(filename);
  if (extension === ".csv") {
    return parseCsv(bytes.toString("utf8"));
  }
  return readXlsx(bytes);
}

/** The extension, or a refusal naming what this reads. */
function extensionOf(name: string): (typeof READABLE_EXTENSIONS)[number] {
  const extension = extname(name).toLowerCase();
  const found = READABLE_EXTENSIONS.find(
    (candidate) => candidate === extension,
  );
  if (!found) {
    throw new Error(
      `An import reads ${READABLE_EXTENSIONS.join(" and ")} files. "${extension || name}" is neither.`,
    );
  }
  return found;
}
