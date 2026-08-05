export const PACKAGE_NAME = "@openokr/db";

export {
  type MigrationClient,
  MigrationError,
  type RunMigrationsOptions,
  runMigrations,
} from "./migrate.ts";
export {
  lintMigrationDirs,
  lintMigrationSql,
  type MigrationLintResult,
} from "./migration-lint.ts";
export {
  type EnsureRolesOptions,
  ensureRoles,
  type SqlRunner,
} from "./roles.ts";
export {
  activeOnly,
  includeDeleted,
  type SoftDeletable,
  softDeleteRows,
} from "./soft-delete.ts";
export {
  collectSoftDeletableTables,
  lintSoftDeleteUsage,
  type SoftDeleteViolation,
  type SourceFile,
} from "./soft-delete-lint.ts";
export {
  WORKSPACE_SETTING,
  type WorkspaceTx,
  withWorkspace,
} from "./tenant.ts";
