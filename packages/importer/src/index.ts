/**
 * The importers (TECHNICAL-PLAN §7).
 *
 * **What is here and what is not, after P6-T01b.** The spreadsheet engine, the
 * readers, the six entity templates, the mapping and the runner live in
 * `packages/core/src/imports`, because the wizard in `apps/web` needs the same
 * engine the command uses and the dependency table does not let an application
 * reach this package. What stays here is the command line: argument parsing,
 * the report as lines a person reads, and the entry point that opens a pool.
 * The FlowyTeam connector joins it at P6-T02, with the one pre-approved MySQL
 * dependency, which is the other reason the engine moved: a web application has
 * no business carrying a MySQL client in its dependency graph.
 */
import { PACKAGE_NAME as CORE } from "@openokr/core";

export const PACKAGE_NAME = "@openokr/importer";
/**
 * Core alone, since P6-T01b-a.
 *
 * The engine moved, so nothing here reaches the database directly any more:
 * the command resolves its workspace and its member through core's own
 * resolver and everything else through registry actions. The database package
 * comes back at P6-T02, where the FlowyTeam connector reads a MySQL source.
 */
export const DEPENDS_ON = [CORE] as const;

export { type Args, parseArgs, render, USAGE, UsageError } from "./cli.ts";
export {
  FLOWYTEAM_USAGE,
  type FlowyteamArgs,
  parseFlowyteamArgs,
} from "./flowyteam/cli.ts";
export {
  type Company,
  type CompanyCounts,
  countCompanies,
  countFor,
  listCompanies,
  requireCompany,
  SUMMARY_TABLES,
} from "./flowyteam/companies.ts";
export {
  CORE_TABLES,
  EXPECTED_TABLES,
  type Introspection,
  inferVersion,
  introspect,
  type SourceVersion,
} from "./flowyteam/introspect.ts";
export {
  LEGACY_TABLES,
  LEGACY_TYPE,
  legacyIdFor,
  legacyKeyFor,
  parseLegacyId,
  type SourceTable,
} from "./flowyteam/legacy.ts";
export {
  buildReport,
  type FlowyteamReport,
  NOT_IMPORTED,
  render as renderFlowyteamReport,
} from "./flowyteam/report.ts";
export {
  companyAlreadyImported,
  type FlowyteamRunOptions,
  type FlowyteamRunResult,
  guardCompany,
  type PriorRun,
  runFlowyteamImport,
} from "./flowyteam/run.ts";
export {
  type Address,
  assertRead,
  type OpenOptions,
  openReadOnlySession,
  openSource,
  parseUrl,
  READ_ONLY_ERROR,
  type Source,
  SourceError,
} from "./flowyteam/source.ts";
