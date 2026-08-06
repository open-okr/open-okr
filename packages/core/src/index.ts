import { PACKAGE_NAME as DB } from "@openokr/db";
import { PACKAGE_NAME as METHOD } from "@openokr/method";

export const PACKAGE_NAME = "@openokr/core";
export const DEPENDS_ON = [DB, METHOD] as const;

export { type Auth, type AuthOptions, createAuth } from "./auth/auth.ts";
export { type CurrentSession, getCurrentSession } from "./auth/session.ts";
export {
  hashSessionToken,
  withHashedSessionTokens,
} from "./auth/session-hashing.ts";
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
