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
