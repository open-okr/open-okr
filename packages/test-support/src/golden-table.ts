/**
 * Reads a golden-master matrix straight out of the design document that
 * defines it.
 *
 * The alternative was a fixture file beside the test with the same rows typed
 * again. Two copies of a correctness matrix is a matrix nobody owns: the
 * document says one thing, the fixture asserts another, and the build stays
 * green while the two disagree. This repository has already been bitten by two
 * copies of one policy (`scripts/check-licences.ts` versus the
 * dependency-review workflow) and answered it the same way, by checking the
 * disagreement rather than remembering to avoid it.
 *
 * So the design document is the fixture. A table is claimed by an HTML comment
 * on the line above it:
 *
 *     <!-- golden: scoring.kr-progress -->
 *
 *     | case | direction | baseline | target | current | expected_pct |
 *     |---|---|---|---|---|---|
 *     | increase halfway | increase | 0 | 100 | 50 | 50 |
 *
 * Changing a number in the document changes what the suite asserts, and
 * deleting a table breaks the build rather than silently testing nothing.
 */
import { readFileSync } from "node:fs";

/** One table row. Keys are the header cells, values are the raw cell text. */
export type GoldenRow = Record<string, string>;

export interface GoldenTable {
  id: string;
  columns: string[];
  rows: GoldenRow[];
}

const ANCHOR = /^<!--\s*golden:\s*([A-Za-z0-9._-]+)\s*-->$/;

/**
 * True for a markdown table separator such as `|---|---|`, which carries no
 * data and must not become a row.
 */
function isSeparator(line: string): boolean {
  return /^\|[\s|:-]+\|$/.test(line);
}

/**
 * Splits `| a | b |` into `["a", "b"]`.
 *
 * Written by hand rather than with a split on the pipe, because the leading and
 * trailing pipes produce empty edge cells that a naive split keeps, and a cell
 * may legitimately be empty in the middle.
 */
function splitRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.slice(
    trimmed.startsWith("|") ? 1 : 0,
    trimmed.endsWith("|") ? -1 : undefined,
  );
  return inner.split("|").map((cell) => cell.trim());
}

/** Every golden table in one markdown file, keyed by its anchor identifier. */
export function parseGoldenTables(source: string): Map<string, GoldenTable> {
  const lines = source.split(/\r?\n/);
  const tables = new Map<string, GoldenTable>();

  for (let i = 0; i < lines.length; i++) {
    const anchor = ANCHOR.exec((lines[i] ?? "").trim());
    if (!anchor) {
      continue;
    }
    const id = anchor[1] as string;

    // Skip blank lines between the anchor and its table.
    let cursor = i + 1;
    while (cursor < lines.length && (lines[cursor] ?? "").trim() === "") {
      cursor++;
    }

    const headerLine = (lines[cursor] ?? "").trim();
    if (!headerLine.startsWith("|")) {
      throw new Error(
        `Golden table "${id}" has no table under its anchor. A matrix that ` +
          "cannot be found must break the build, not assert nothing.",
      );
    }

    const columns = splitRow(headerLine);
    cursor++;

    if (!isSeparator((lines[cursor] ?? "").trim())) {
      throw new Error(
        `Golden table "${id}" is missing the header separator row.`,
      );
    }
    cursor++;

    const rows: GoldenRow[] = [];
    while (cursor < lines.length) {
      const line = (lines[cursor] ?? "").trim();
      if (!line.startsWith("|")) {
        break;
      }
      const cells = splitRow(line);
      if (cells.length !== columns.length) {
        throw new Error(
          `Golden table "${id}" row ${rows.length + 1} has ${cells.length} ` +
            `cells against ${columns.length} columns: ${line}`,
        );
      }
      const row: GoldenRow = {};
      for (const [index, column] of columns.entries()) {
        row[column] = cells[index] as string;
      }
      rows.push(row);
      cursor++;
    }

    if (rows.length === 0) {
      throw new Error(
        `Golden table "${id}" has a header and no rows. An empty matrix ` +
          "passes every assertion, which is the same as having no test.",
      );
    }

    if (tables.has(id)) {
      throw new Error(
        `Golden table "${id}" is declared twice. Identifiers address one ` +
          "matrix each, so the second would shadow the first.",
      );
    }

    tables.set(id, { id, columns, rows });
    i = cursor - 1;
  }

  return tables;
}

/**
 * One named matrix from one file. Throws when the anchor is absent, so a
 * renamed table fails loudly instead of quietly skipping its cases.
 */
export function loadGoldenTable(filePath: string, id: string): GoldenTable {
  const tables = parseGoldenTables(readFileSync(filePath, "utf8"));
  const table = tables.get(id);

  if (!table) {
    const known = [...tables.keys()].sort().join(", ") || "none";
    throw new Error(
      `Golden table "${id}" is not in ${filePath}. Tables found: ${known}.`,
    );
  }

  return table;
}

/** Every matrix in one file. */
export function loadGoldenTables(filePath: string): Map<string, GoldenTable> {
  return parseGoldenTables(readFileSync(filePath, "utf8"));
}

/**
 * A cell as a number, or null when the cell is blank.
 *
 * Blank means "no value" throughout these matrices: no achievement recorded, no
 * forecast possible, no score. It is never zero, and reading it as zero is the
 * specific mistake decision D-9 in the KPI design exists to prevent.
 */
export function cellNumber(row: GoldenRow, column: string): number | null {
  const raw = row[column];
  if (raw === undefined) {
    throw new Error(`No column "${column}" in this golden row.`);
  }
  if (raw === "") {
    return null;
  }
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`Column "${column}" is not a number: "${raw}".`);
  }
  return value;
}

/** A cell as a boolean, spelled `yes` or `no` in the documents. */
export function cellBoolean(row: GoldenRow, column: string): boolean | null {
  const raw = row[column];
  if (raw === undefined) {
    throw new Error(`No column "${column}" in this golden row.`);
  }
  if (raw === "") {
    return null;
  }
  if (raw === "yes") {
    return true;
  }
  if (raw === "no") {
    return false;
  }
  throw new Error(
    `Column "${column}" should read "yes" or "no", not "${raw}".`,
  );
}

/** A cell as a comma-separated list, empty when the cell is blank. */
export function cellList(row: GoldenRow, column: string): string[] {
  const raw = row[column];
  if (raw === undefined) {
    throw new Error(`No column "${column}" in this golden row.`);
  }
  if (raw.trim() === "") {
    return [];
  }
  return raw.split(",").map((entry) => entry.trim());
}

/** A cell as parsed JSON, for the matrices that carry a graph or a tree. */
export function cellJson<T>(row: GoldenRow, column: string): T | null {
  const raw = row[column];
  if (raw === undefined) {
    throw new Error(`No column "${column}" in this golden row.`);
  }
  if (raw.trim() === "") {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new Error(`Column "${column}" is not valid JSON: ${raw}`, { cause });
  }
}
