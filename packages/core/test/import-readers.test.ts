/**
 * The two readers (P6-T01a).
 *
 * Every case here is a file somebody actually sends: quotes inside quotes, a
 * newline inside a cell, Excel's byte-order mark, a row of empty separators
 * left behind by a deleted line, and a short last row.
 */
import { describe, expect, it } from "vitest";
import {
  cellToText,
  parseCsv,
  parseCsvLines,
  sheetToTable,
} from "../src/imports/readers/index.ts";

describe("the CSV reader", () => {
  it("reads a plain file", () => {
    const table = parseCsv("id,title\n1,Ship it\n2,Measure it\n");
    expect(table.headers).toEqual(["id", "title"]);
    expect(table.rows).toEqual([
      ["1", "Ship it"],
      ["2", "Measure it"],
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    const table = parseCsv('id,title\n1,"Ship it, then measure it"\n');
    expect(table.rows[0]).toEqual(["1", "Ship it, then measure it"]);
  });

  it("reads a doubled quote as one quote", () => {
    const table = parseCsv('id,title\n1,"She said ""no"""\n');
    expect(table.rows[0]).toEqual(["1", 'She said "no"']);
  });

  it("keeps a newline inside a quoted field", () => {
    const table = parseCsv('id,notes\n1,"First line\nSecond line"\n');
    expect(table.rows[0]).toEqual(["1", "First line\nSecond line"]);
  });

  it("reads CRLF and LF in one file", () => {
    const table = parseCsv("id,title\r\n1,One\r\n2,Two\n");
    expect(table.rows).toEqual([
      ["1", "One"],
      ["2", "Two"],
    ]);
  });

  it("strips the byte-order mark Excel writes", () => {
    // Without this the first header is "﻿id" and no mapping matches it.
    const table = parseCsv("﻿id,title\n1,One\n");
    expect(table.headers[0]).toBe("id");
  });

  it("drops a row of nothing but separators", () => {
    const table = parseCsv("id,title\n1,One\n,\n");
    expect(table.rows).toEqual([["1", "One"]]);
  });

  it("pads a short row to the header width", () => {
    const table = parseCsv("id,title,notes\n1,One\n");
    expect(table.rows[0]).toEqual(["1", "One", ""]);
  });

  it("does not read a trailing newline as an empty row", () => {
    expect(parseCsvLines("a,b\n1,2\n")).toHaveLength(2);
  });

  it("refuses a file with no header row", () => {
    expect(() => parseCsv("")).toThrow(/no header row/);
    expect(() => parseCsv(",,\n1,2,3\n")).toThrow(/no header row/);
  });
});

describe("the XLSX reader's cells", () => {
  it("reads a date as the day the cell shows, wherever the reader is", () => {
    // The reader hands over UTC midnight of the day in the cell, so the day
    // is the UTC day. Reading the local parts instead would move it back one
    // anywhere west of UTC, which for a due date is a deadline a day early.
    expect(cellToText(new Date(Date.UTC(2026, 8, 4)))).toBe("2026-09-04");
  });

  it("reads a number, a boolean and an empty cell", () => {
    expect(cellToText(42)).toBe("42");
    expect(cellToText(true)).toBe("true");
    expect(cellToText(null)).toBe("");
    expect(cellToText(undefined)).toBe("");
  });

  it("turns a sheet into the same shape the CSV reader returns", () => {
    const table = sheetToTable([
      ["id", "target"],
      ["kr-1", 40],
      [null, null],
      ["kr-2"],
    ]);
    expect(table.headers).toEqual(["id", "target"]);
    expect(table.rows).toEqual([
      ["kr-1", "40"],
      ["kr-2", ""],
    ]);
  });

  it("refuses a sheet with no header row", () => {
    expect(() => sheetToTable([[null, null], ["1"]])).toThrow(/no header row/);
  });
});
