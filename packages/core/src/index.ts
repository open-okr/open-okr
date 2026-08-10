import { PACKAGE_NAME as DB } from "@openokr/db";
import { PACKAGE_NAME as METHOD } from "@openokr/method";

export const PACKAGE_NAME = "@openokr/core";
export const DEPENDS_ON = [DB, METHOD] as const;

export {
  type BindGroupInput,
  bindGroup,
  type EnsureContextInput,
  type EnsureMemberGroupInput,
  type EnsureWorkspaceStandardGroupInput,
  ensureContext,
  ensureMemberGroup,
  ensureWorkspaceStandardGroup,
} from "./access/contexts.ts";
export { ACCESS_LEVELS, type AccessLevel } from "./access/levels.ts";
export { PERMISSIONS, type Permission } from "./access/permissions.ts";
export { derivePrivacy, type PrivacyLabel } from "./access/privacy.ts";
export {
  type AccessScopedResource,
  type AccessScopeFilterInput,
  type AnonymousContextInput,
  accessScopeFilter,
  can,
  type GetAccessScopedInput,
  getAccessScoped,
  type MemberContextInput,
  resolveAnonymousAccessLevel,
  resolveMemberAccessLevel,
  resolveSubjectContext,
  type SubjectContext,
} from "./access/reads.ts";
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
  type ProvisionedMember,
  type ProvisionMemberInput,
  provisionMemberForInvite,
} from "./invitations/provisioning.ts";
export {
  emailDomain,
  generateInviteToken,
  hashInviteToken,
} from "./invitations/tokens.ts";
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
  type ErasureExport,
  isLastFullAccessHolder,
  refuseIfLastOwner,
  stripBindings,
} from "./people/lifecycle.ts";
export {
  buildOrgChart,
  type ManagerCycleCheckInput,
  type OrgChartNode,
  type PossibleManager,
  possibleManagers,
  wouldCreateManagerCycle,
} from "./people/manager-chain.ts";
export {
  environmentValue,
  getInstanceSetting,
  INSTANCE_SETTINGS,
  type InstanceSettingDefinition,
  SETUP_COMPLETED_AT,
} from "./secrets/instance-registry.ts";
export {
  clearSetting,
  type ResolvedSetting,
  readSecret,
  readSetting,
  readSettingRows,
  resolveSetting,
  type SettingSource,
  type SettingWrite,
  writeSettings,
} from "./secrets/instance-settings.ts";
export {
  decryptSecret,
  encryptSecret,
  type KeyRing,
  KeyRingError,
  type KeyRingSource,
  newRootKey,
  parseKeyRing,
  rewrapSecret,
  rootKeyFingerprint,
  type SealedSecret,
} from "./secrets/key-ring.ts";
export {
  type ResolvedMailSettings,
  resolveMailSettings,
} from "./secrets/mail-settings.ts";
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
  type CompleteSetupInput,
  type CompleteSetupResult,
  completeSetup,
} from "./setup/complete.ts";
export {
  blockingFailures,
  type ConnectionOutcome,
  type ConnectionProbe,
  type ConnectionTest,
  runConnectionTests,
} from "./setup/connection-tests.ts";
export {
  databaseProbe,
  type MailProbeOptions,
  mailProbe,
  notInThisBuild,
} from "./setup/probes.ts";
export {
  readSetupState,
  type SetupState,
  setupRefusal,
} from "./setup/state.ts";
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
