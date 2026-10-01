/**
 * The downloadable import templates (REQUIREMENTS §6, completeness review M-17).
 *
 * A template is worth offering only if the importer reads it back without a
 * question. So every assertion here goes through the importer's own code: the
 * two readers, the alias matching, and the run. A header row that stops
 * matching what the mapping recognises fails the first block; an example row
 * the templates can no longer plan fails the second; an imports page that
 * stops naming the same columns fails the third.
 */
import { readFile } from "node:fs/promises";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { resolveMapping } from "../src/imports/mapping.ts";
import { parseCsv, readBuffer } from "../src/imports/readers/index.ts";
import { runTable } from "../src/imports/run.ts";
import {
  TEMPLATE_FORMATS,
  templateFile,
} from "../src/imports/template-files.ts";
import { TEMPLATES } from "../src/imports/templates/index.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/** The two people the examples name. RFC 2606 keeps the domain unregistrable. */
const ALEX = "44444444-4444-4444-8444-444444444444";
const ALEX_EMAIL = "alex@example.com";
const SAM_EMAIL = "sam@example.com";
/** The space the initiative and task examples sit in. */
const SPACE = "Product";

describe("each template, read back by the importer", () => {
  for (const template of TEMPLATES) {
    const fields = template.columns.map((column) => column.field);

    for (const format of TEMPLATE_FORMATS) {
      it(`${template.entity}.${format}: every column maps, and nothing is left over`, async () => {
        const file = await templateFile(template.entity, format);
        expect(file.filename).toBe(
          `openokr-${template.entity}-template.${format}`,
        );

        // The reader the wizard uses, from bytes and a filename, so the
        // extension is decided exactly as it is for an upload.
        const table = await readBuffer(file.filename, file.bytes);
        expect(table.headers).toEqual(fields);

        // No mapping supplied: the aliases alone have to claim every column,
        // or the template is a file the wizard asks questions about.
        const mapping = resolveMapping(template, table.headers);
        expect(mapping.unmapped).toEqual([]);
        expect(Object.keys(mapping.fieldToIndex).sort()).toEqual(
          [...fields].sort(),
        );

        expect(table.rows).toEqual([
          template.columns.map((column) => column.example),
        ]);
      });
    }

    it(`${template.entity}: every required column has an example`, () => {
      // An empty required cell is a skipped row, and a template whose own
      // example is skipped teaches the wrong thing on the first try.
      const empty = template.columns
        .filter((column) => column.required && column.example.trim() === "")
        .map((column) => column.field);
      expect(empty).toEqual([]);
    });
  }

  it("the CSV opens in Excel as UTF-8", async () => {
    // The byte-order mark is what stops Excel on Windows reading the file in
    // the system codepage. The reader strips it, which the block above proves.
    const file = await templateFile("goals", "csv");
    expect(file.bytes.toString("utf8").startsWith("\uFEFF")).toBe(true);
    expect(parseCsv(file.bytes.toString("utf8")).headers[0]).toBe("externalId");
  });
});

describe("the six examples, imported in order", () => {
  let pool: Pool;
  let workspaceId: string;

  beforeEach(async () => {
    const wb = await workerDb();
    pool = wb.appPool;
    await wb.truncateAllTables();
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      [ALEX, "Alex Example", ALEX_EMAIL],
    );
    const provisioned = await provisionWorkspaceForUser(wb.appPool, {
      id: ALEX,
      name: "Alex Example",
    });
    workspaceId = provisioned.workspaceId;

    const context = {
      pool,
      workspaceId,
      actor: { kind: "human" as const, userId: ALEX },
    };
    await callAction(context, "spaces.create", { name: SPACE });
    // The reviewer the goals example names. A placeholder, because that is
    // the member a migrated workspace is full of.
    await callAction(context, "people.importMember", {
      name: "Sam Example",
      email: SAM_EMAIL,
      legacy: { type: "csv", id: "sam" },
    });
  });

  afterAll(async () => {
    const wb = await workerDb();
    await wb.close();
  });

  it("previews and imports every example with no skip, from either format", async () => {
    for (const template of TEMPLATES) {
      const csv = await templateFile(template.entity, "csv");
      const xlsx = await templateFile(template.entity, "xlsx");
      const table = await readBuffer(csv.filename, csv.bytes);
      // One table whichever file somebody downloaded.
      expect(await readBuffer(xlsx.filename, xlsx.bytes)).toEqual(table);

      const run = (dryRun: boolean) =>
        runTable({
          pool,
          workspaceId,
          userId: ALEX,
          entity: template.entity,
          table,
          name: csv.filename,
          dryRun,
        });

      const preview = await run(true);
      const skipped = (rows: typeof preview.report.rows) =>
        rows
          .filter((row) => row.outcome === "skipped")
          .map((row) => `${template.entity}: ${row.reason}`);
      expect(skipped(preview.report.rows)).toEqual([]);
      expect(preview.report.unmappedHeaders).toEqual([]);
      expect(preview.report.created).toBe(1);

      // Written for real, because the next template's example names this
      // one's: the key result finds the objective by `OBJ-1`, and so on.
      const real = await run(false);
      expect(skipped(real.report.rows)).toEqual([]);
      expect(real.report.rows).toEqual(preview.report.rows);
    }

    const wb = await workerDb();
    const counts = await wb.admin.query<Record<string, number>>(
      `select
         (select count(*)::int from goals) as goals,
         (select count(*)::int from key_results) as "keyResults",
         (select count(*)::int from kpis) as kpis,
         (select count(*)::int from kpi_records) as "kpiRecords",
         (select count(*)::int from initiatives) as initiatives,
         (select count(*)::int from tasks) as tasks`,
    );
    expect(counts.rows[0]).toEqual({
      goals: 1,
      keyResults: 1,
      kpis: 1,
      kpiRecords: 1,
      initiatives: 1,
      tasks: 1,
    });
  });
});

describe("the imports page", () => {
  /**
   * The table the page carries for one entity, built from the template.
   *
   * The page is for somebody filling a template in, and a column the page
   * does not name is a column they guess at. Built here rather than parsed
   * out of the page, so the failure prints the table to paste.
   */
  const tableFor = (entity: string): string => {
    const template = TEMPLATES.find((one) => one.entity === entity);
    return [
      "| Column | Required | What it holds |",
      "|---|---|---|",
      ...(template?.columns ?? []).map(
        (column) =>
          `| \`${column.field}\` | ${column.required ? "Yes" : "No"} | ${column.describe} |`,
      ),
    ].join("\n");
  };

  it("names every template's columns, in order, as the template does", async () => {
    const page = await readFile(
      new URL("../../../docs/import/README.md", import.meta.url),
      "utf8",
    );
    for (const template of TEMPLATES) {
      expect(page).toContain(`/admin/imports/templates/${template.entity}.csv`);
      expect(page).toContain(tableFor(template.entity));
    }
  });
});
