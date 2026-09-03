/**
 * A real `.xlsx` file, written and then read (P6-T01a).
 *
 * The cell conversions are unit-tested in `readers.test.ts` against arrays. This
 * one goes through the file: a zip, its shared strings, its number formats and
 * its date serials, because a reader that only ever saw arrays would pass while
 * the file path was broken. It is the same shape as the export test in
 * `packages/core/test/xlsx.test.ts`, which unzips what it wrote rather than
 * asserting the buffer is non-empty.
 *
 * The writer is `write-excel-file`, already in this repository for the export
 * path and already past the licence gate. It is a test dependency here.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { readTable } from "../src/index";

describe("reading a spreadsheet from disk", () => {
  it("reads its headers, its numbers and its dates", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openokr-xlsx-"));
    const path = join(directory, "key-results.xlsx");

    // The writer returns a stream-like object; `toBuffer` is the shape the
    // export path already uses, and writing the bytes here keeps the test
    // independent of whether its file writer has flushed.
    const buffer = await writeXlsxFile(
      [
        [
          { value: "Key result ID" },
          { value: "Target" },
          { value: "Due" },
          { value: "Carried" },
        ],
        [
          { value: "kr-1", type: String },
          { value: 40, type: Number },
          {
            // UTC, because the writer turns a local midnight into a serial
            // through UTC and the day it lands on is then the day before.
            // That is the writer's business; what this proves is the read.
            value: new Date(Date.UTC(2026, 8, 30)),
            type: Date,
            format: "yyyy-mm-dd",
          },
          { value: true, type: Boolean },
        ],
      ],
      { sheet: "Sheet1" },
    ).toBuffer();
    await writeFile(path, buffer);

    const table = await readTable(path);

    expect(table.headers).toEqual([
      "Key result ID",
      "Target",
      "Due",
      "Carried",
    ]);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.[0]).toBe("kr-1");
    expect(table.rows[0]?.[1]).toBe("40");
    // The day the cell shows, read off the UTC parts the reader uses.
    expect(table.rows[0]?.[2]).toBe("2026-09-30");
    expect(table.rows[0]?.[3]).toBe("true");
  });
});
