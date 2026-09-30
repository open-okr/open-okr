/**
 * The downloadable import templates (REQUIREMENTS §6, completeness review M-17).
 *
 * **Built from the entity templates, never written down beside them.** The
 * header row is each column's own field name, which is the first thing the
 * alias matching in `mapping.ts` tries, so a template read back through the
 * importer maps every column with no mapping supplied and none left over. The
 * example row is each column's own `example`. A column added to a template is
 * a column in its file the same day, and there is no second list to forget.
 *
 * **The same writers the exports use.** `toCsv` quotes every cell and writes
 * the byte-order mark Excel needs, and `parseCsv` strips it; `toXlsx` writes
 * with the dependency the export path already carries. A template is a small
 * export of a table nobody stored, so it needs no writer of its own.
 *
 * **Required columns are not marked in the header.** A header of `title *`
 * would stop matching the field it names, because the alias matching folds
 * case, spaces and punctuation but not an asterisk. The wizard says which
 * columns are required beside the download, and the imports page lists them.
 *
 * Pure: no database, no clock, no configuration. The same bytes for every
 * workspace, which is why nothing here takes one.
 */
import { type CsvTable, toCsv } from "../exports/csv.ts";
import { toXlsx } from "../exports/xlsx.ts";
import { templateFor } from "./templates/index.ts";

/** The formats a template downloads in: the two an import reads. */
export const TEMPLATE_FORMATS = ["csv", "xlsx"] as const;
export type TemplateFormat = (typeof TEMPLATE_FORMATS)[number];

export interface TemplateFile {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Buffer;
}

const CONTENT_TYPES: Readonly<Record<TemplateFormat, string>> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** One entity's template as a header row and its one example row. */
function templateTable(entity: string): CsvTable {
  const template = templateFor(entity);
  return {
    columns: template.columns.map((column) => column.field),
    rows: [template.columns.map((column) => column.example)],
  };
}

/** One entity's template as a file, in either format an import reads. */
export async function templateFile(
  entity: string,
  format: TemplateFormat,
): Promise<TemplateFile> {
  const table = templateTable(entity);
  const bytes =
    format === "csv"
      ? Buffer.from(toCsv(table), "utf8")
      : await toXlsx(table, { sheet: entity });
  return {
    filename: `openokr-${entity}-template.${format}`,
    contentType: CONTENT_TYPES[format],
    bytes,
  };
}
