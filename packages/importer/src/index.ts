/**
 * The importers (TECHNICAL-PLAN §7).
 *
 * The spreadsheet importer is P6-T01a: readers for the two formats, a template
 * per entity, a mapping, and a runner that plans every row and then either
 * writes it or does not. The FlowyTeam connector arrives at P6-T02 beside it
 * and shares the run record and the report shape.
 */
import { PACKAGE_NAME as CORE } from "@openokr/core";
import { PACKAGE_NAME as DB } from "@openokr/db";

export const PACKAGE_NAME = "@openokr/importer";
export const DEPENDS_ON = [CORE, DB] as const;

export { findExisting } from "./legacy-lookup.ts";
export {
  type Mapping,
  type MappingFile,
  parseMappingFile,
  resolveMapping,
  valuesFor,
} from "./mapping.ts";
export {
  cellToText,
  parseCsv,
  parseCsvLines,
  READABLE_EXTENSIONS,
  readTable,
  readXlsx,
  sheetToTable,
  type Table,
} from "./readers/index.ts";
export { type ReferenceHost, referencesFor } from "./references.ts";
export {
  type RowOutcome,
  type RunOptions,
  type RunReport,
  type RunResult,
  runImport,
} from "./run.ts";
export {
  asBoolean,
  asDay,
  asEnum,
  asNumber,
  asText,
  type ColumnSpec,
  ENTITIES,
  type EntityTemplate,
  goalsTemplate,
  initiativesTemplate,
  keyResultsTemplate,
  kpiRecordsTemplate,
  kpisTemplate,
  normalise,
  type PlanContext,
  type References,
  type RowPlan,
  TEMPLATES,
  tasksTemplate,
  templateFor,
} from "./templates/index.ts";
