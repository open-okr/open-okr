export const PACKAGE_NAME = "@openokr/db";

export {
  type ColumnExpectation,
  type DataChangeBatchResult,
  type DataChangeClient,
  DataChangeError,
  type DataChangeOutcome,
  type DataChangeScript,
  type RunDataChangesOptions,
  runDataChanges,
} from "./data-change.ts";
export {
  APPEND_ONLY_TABLES,
  type GrantOptions,
  grantAppPrivileges,
} from "./grants.ts";
export { idTimestamp, newId } from "./id.ts";
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
  type AccessBinding,
  type AccessContext,
  type AccessGroup,
  type AccessGroupKind,
  type AccessGroupMembership,
  type AccessRoleTag,
  accessBindings,
  accessContexts,
  accessGroupMemberships,
  accessGroups,
} from "./schema/access.ts";
export {
  type Activity,
  type ActorKind,
  type AuditEvent,
  activities,
  auditEvents,
} from "./schema/audit.ts";
export {
  accounts,
  authSchema,
  passkeys,
  sessions,
  twoFactors,
  users,
  verifications,
} from "./schema/auth.ts";
export { type Blob, type BlobStatus, blobs } from "./schema/blobs.ts";
export {
  type InviteLink,
  type InviteMode,
  inviteLinks,
} from "./schema/invitations.ts";
export {
  type Notification,
  type NotificationBatch,
  type NotificationBatchStatus,
  type NotificationRouting,
  type NotificationSettingsRow,
  notificationBatches,
  notificationSettings,
  notifications,
  type Subscription,
  type SubscriptionList,
  type SubscriptionReason,
  subscriptionLists,
  subscriptions,
} from "./schema/notifications.ts";
export { outbox } from "./schema/outbox.ts";
export { systemSettings } from "./schema/system-settings.ts";
export {
  type QuietHours,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceSettings,
  workspaceMembers,
  workspaces,
} from "./schema/workspaces.ts";
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
  INSTANCE_ADMIN_SETTING,
  type TenantContext,
  USER_SETTING,
  WORKSPACE_SETTING,
  type WorkspaceTx,
  withContext,
  withInstanceAdmin,
  withUser,
  withWorkspace,
} from "./tenant.ts";
