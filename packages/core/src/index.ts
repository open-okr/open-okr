import { PACKAGE_NAME as DB } from "@openokr/db";
import { PACKAGE_NAME as METHOD } from "@openokr/method";

export const PACKAGE_NAME = "@openokr/core";
export const DEPENDS_ON = [DB, METHOD] as const;

export { ACCESS_LEVELS, type AccessLevel } from "./access/levels.ts";
export {
  type ActionCallContext,
  type ActionDefinition,
  defineReadAction,
  defineWriteAction,
  type SafetyClass,
} from "./actions/define.ts";
export {
  ACTION_MAP,
  ACTIONS,
  type ActionName,
  actionNames,
  callAction,
  getAction,
} from "./actions/registry.ts";
export {
  type AuditRow,
  auditRowHash,
  type ChainVerdict,
  canonicalJson,
  GENESIS_HASH,
  verifyChain,
} from "./audit/chain.ts";
export { verifyAllChains, verifyWorkspaceChain } from "./audit/verify.ts";
export { type Auth, type AuthOptions, createAuth } from "./auth/auth.ts";
export { type CurrentSession, getCurrentSession } from "./auth/session.ts";
export {
  hashSessionToken,
  withHashedSessionTokens,
} from "./auth/session-hashing.ts";
export {
  type ActivityInput,
  type ActorInput,
  type AuditInput,
  type OperationContext,
  OperationError,
  type OperationOutcome,
  type OperationSpec,
  type OperationTx,
  type ResolvedActor,
  runOperation,
} from "./operations/operation.ts";
export {
  DEFAULT_QUIET_HOURS,
  INSTANCE_DEFAULT_LANGUAGE,
  isKnownTimezone,
  type ProvisioningContext,
  resolveMemberSettings,
  resolveWorkspaceSettings,
  SETTINGS_REGISTRY,
  type SettingDefinition,
  type SettingScope,
} from "./settings/registry.ts";
export {
  listMembershipsForUser,
  type Membership,
  resolveActiveWorkspace,
} from "./workspaces/memberships.ts";
export {
  type CreateWorkspaceInput,
  createWorkspace,
  defaultWorkspaceName,
  type ProvisionedWorkspace,
  provisionWorkspaceForUser,
  slugify,
  type WorkspaceUser,
} from "./workspaces/provisioning.ts";
export {
  isRegistrationOpen,
  REGISTRATION_CLOSED_MESSAGE,
} from "./workspaces/registration.ts";
