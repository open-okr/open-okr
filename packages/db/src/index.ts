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
  enqueueOutbox,
  type OutboxMessage,
  type OutboxPayload,
} from "./outbox.ts";
export {
  type EnsureRolesOptions,
  ensureRoles,
  type SqlRunner,
} from "./roles.ts";
export {
  accounts,
  authSchema,
  passkeys,
  sessions,
  twoFactors,
  users,
  verifications,
} from "./schema/auth.ts";
export { outbox } from "./schema/outbox.ts";
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
