import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { toCsv } from "../src/exports/csv.ts";
import { toXlsx } from "../src/exports/xlsx.ts";

/**
 * The workbook export (TECHNICAL-PLAN §4.9, P5-T15).
 *
 * **Opened rather than trusted.** An XLSX is a zip of XML, so these tests
 * unzip the bytes and read the sheet, which is what a spreadsheet does. A test
 * that only asserted the buffer was non-empty would pass on a corrupt file.
 *
 * `fflate` is already in the tree, underneath `write-excel-file`, so reading
 * the file back costs no dependency.
 */

/** The sheet's cell values, in row order, as a spreadsheet would show them. */
function readSheet(bytes: Buffer): string[][] {
  const files = unzipSync(new Uint8Array(bytes));
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"] as Uint8Array);
  const shared = files["xl/sharedStrings.xml"];
  const strings = shared
    ? [...strFromU8(shared).matchAll(/<si>(.*?)<\/si>/gs)].map((match) =>
        [...(match[1] ?? "").matchAll(/<t[^>]*>(.*?)<\/t>/gs)]
          .map((one) => decode(one[1] ?? ""))
          .join(""),
      )
    : [];

  return [...sheet.matchAll(/<row[^>]*>(.*?)<\/row>/gs)].map((row) =>
    [...(row[1] ?? "").matchAll(/<c\b([^>]*)(?:\/>|>(.*?)<\/c>)/gs)].map(
      (cell) => {
        const attributes = cell[1] ?? "";
        const body = cell[2] ?? "";
        const value = /<v>(.*?)<\/v>/s.exec(body)?.[1] ?? "";
        // A shared string cell holds an index into the string table; every
        // other cell holds its value inline.
        return / t="s"/.test(attributes)
          ? (strings[Number(value)] ?? "")
          : decode(value);
      },
    ),
  );
}

const decode = (text: string): string =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

const TABLE = {
  columns: ["Objective", "Progress", "Champion", "Due"],
  rows: [
    ["Raise weekly activation", 62, "Ada Lovelace", "2026-12-31"],
    ["Cut time to first value", 0, "Bo Persson", ""],
  ],
} as const;

describe("the workbook a member downloads", () => {
  it("carries the same rows and columns as the CSV", async () => {
    const sheet = readSheet(await toXlsx(TABLE));

    expect(sheet[0]).toEqual([...TABLE.columns]);
    expect(sheet).toHaveLength(TABLE.rows.length + 1);

    // The CSV is the reference the row's test plan names: same values, same
    // order, one format quoting them and the other typing them.
    const csvRows = toCsv(TABLE)
      .replace("﻿", "")
      .trimEnd()
      .split("\r\n")
      .map((line) =>
        [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((one) =>
          (one[1] ?? "").replaceAll('""', '"'),
        ),
      );
    expect(sheet[0]).toEqual(csvRows[0]);
    expect(sheet[1]).toEqual(csvRows[1]);
  });

  it("writes a number as a number, which is what a workbook is for", async () => {
    const bytes = await toXlsx(TABLE);
    const files = unzipSync(new Uint8Array(bytes));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"] as Uint8Array);

    // A numeric cell carries no `t="s"`, so it is a number rather than an
    // index into the string table. Sorting and summing depend on it.
    const secondRow = /<row r="2"[^>]*>(.*?)<\/row>/s.exec(sheet)?.[1] ?? "";
    const cells = [...secondRow.matchAll(/<c\b([^>]*)/g)].map(
      (one) => one[1] ?? "",
    );
    expect(cells[1]).not.toContain('t="s"');
    expect(secondRow).toContain("<v>62</v>");
  });

  it("keeps a zero, which is a measurement rather than a blank", async () => {
    const sheet = readSheet(await toXlsx(TABLE));
    expect(sheet[2]?.[1]).toBe("0");
  });

  it("leaves a formula title as text, with no apostrophe added", async () => {
    const dangerous = "=cmd|'/c calc'!A1";
    const sheet = readSheet(
      await toXlsx({ columns: ["Objective"], rows: [[dangerous]] }),
    );

    // Verbatim: an XLSX cell declares its own type, so a string cell is text
    // whatever it starts with. The CSV's apostrophe would be visible here and
    // would protect nothing the format does not already.
    expect(sheet[1]?.[0]).toBe(dangerous);
    expect(sheet[1]?.[0]).not.toContain("'=");
  });

  it("writes a header and nothing else for an empty list", async () => {
    const sheet = readSheet(
      await toXlsx({ columns: ["Objective", "Progress"], rows: [] }),
    );
    // An empty file would leave a person unsure whether the export failed or
    // the list really is empty. The heading answers that.
    expect(sheet).toEqual([["Objective", "Progress"]]);
  });

  it("is a zip a spreadsheet recognises", async () => {
    const bytes = await toXlsx(TABLE);
    // `PK`, the zip magic number. A file that fails here opens as corrupt and
    // no assertion about its contents would have run.
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    const files = unzipSync(new Uint8Array(bytes));
    expect(Object.keys(files)).toContain("[Content_Types].xml");
    expect(Object.keys(files)).toContain("xl/workbook.xml");
  });
});
