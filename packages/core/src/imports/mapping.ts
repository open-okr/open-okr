/**
 * Headers into fields (TECHNICAL-PLAN §7.1 step 2, P6-T01a).
 *
 * Two ways in, and the same result either way. A mapping supplied as JSON says
 * what each header is, and it wins outright. Without one, each header is
 * matched against the template's aliases with case, spaces and punctuation
 * folded away, which is enough for a file exported from a system that names
 * things roughly the way this one does. The AI mapper in P6-T01b proposes over
 * the same shape, so it is a third source of the same object rather than a
 * second path through the importer.
 *
 * **A mapping that leaves a required field unmapped is refused before anything
 * is read.** That is a property of the file rather than of a row, and reporting
 * it a thousand times is worse than reporting it once.
 */
import { normalise } from "./templates/coerce.ts";
import type { EntityTemplate } from "./templates/index.ts";

/** A mapping file: which header carries which field, and which entity it is for. */
export interface MappingFile {
  readonly entity?: string;
  /** Header text to the template's field name. A field of `null` ignores that column. */
  readonly columns: Readonly<Record<string, string | null>>;
}

export interface Mapping {
  /** Field name to the index of the column carrying it. */
  readonly fieldToIndex: Readonly<Record<string, number>>;
  /** Headers nothing claimed, for the report. */
  readonly unmapped: readonly string[];
}

export function parseMappingFile(text: string, path: string): MappingFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("columns" in parsed) ||
    typeof (parsed as { columns: unknown }).columns !== "object" ||
    (parsed as { columns: unknown }).columns === null
  ) {
    throw new Error(
      `${path} needs a "columns" object mapping each header to a field name.`,
    );
  }
  const columns = (parsed as { columns: Record<string, unknown> }).columns;
  const cleaned: Record<string, string | null> = {};
  for (const [header, field] of Object.entries(columns)) {
    if (field === null || field === "") {
      cleaned[header] = null;
      continue;
    }
    if (typeof field !== "string") {
      throw new Error(
        `${path} maps "${header}" to something that is not a field name.`,
      );
    }
    cleaned[header] = field;
  }
  const entity = (parsed as { entity?: unknown }).entity;
  return {
    ...(typeof entity === "string" ? { entity } : {}),
    columns: cleaned,
  };
}

/**
 * The mapping for a file, or a refusal naming what is missing.
 *
 * `supplied` wins where it speaks. Where it is silent, and when there is none,
 * the aliases decide.
 */
export function resolveMapping(
  template: EntityTemplate,
  headers: readonly string[],
  supplied?: MappingFile,
): Mapping {
  const byField: Record<string, number> = {};
  const unmapped: string[] = [];
  const fields = new Set(template.columns.map((column) => column.field));

  const suppliedByHeader = new Map<string, string | null>();
  for (const [header, field] of Object.entries(supplied?.columns ?? {})) {
    suppliedByHeader.set(normalise(header), field);
    if (field !== null && !fields.has(field)) {
      throw new Error(
        `The mapping sends "${header}" to "${field}", which is not a field of the ${template.entity} template. Its fields are: ${[...fields].join(", ")}.`,
      );
    }
  }

  headers.forEach((header, index) => {
    if (header === "") {
      return;
    }
    const said = suppliedByHeader.get(normalise(header));
    if (said === null) {
      // Mapped to nothing on purpose. Not unmapped, and not a warning.
      return;
    }
    const field = said ?? matchByAlias(template, header);
    if (!field) {
      unmapped.push(header);
      return;
    }
    if (byField[field] !== undefined) {
      throw new Error(
        `Two columns claim the field "${field}": "${headers[byField[field] as number]}" and "${header}". Supply a mapping that picks one.`,
      );
    }
    byField[field] = index;
  });

  const missing = template.columns
    .filter((column) => column.required && byField[column.field] === undefined)
    .map((column) => column.field);
  if (missing.length > 0) {
    throw new Error(
      `The ${template.entity} template needs ${missing.join(", ")}, and no column carries ${missing.length === 1 ? "it" : "them"}. Headers found: ${headers.filter((header) => header !== "").join(", ")}.`,
    );
  }

  return { fieldToIndex: byField, unmapped };
}

function matchByAlias(
  template: EntityTemplate,
  header: string,
): string | undefined {
  const wanted = normalise(header);
  const column = template.columns.find(
    (candidate) =>
      normalise(candidate.field) === wanted ||
      candidate.aliases.some((alias) => normalise(alias) === wanted),
  );
  return column?.field;
}

/** One row's declared values, keyed by field, trimmed, with blanks left out. */
export function valuesFor(
  mapping: Mapping,
  row: readonly string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [field, index] of Object.entries(mapping.fieldToIndex)) {
    const raw = (row[index] ?? "").trim();
    if (raw !== "") {
      values[field] = raw;
    }
  }
  return values;
}
