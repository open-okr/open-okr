/**
 * The action contract registry (TECHNICAL-PLAN §14).
 *
 * Every read and write in the product is declared here once: a name, its
 * input and output schemas, the access level it requires, and its safety
 * class. The internal typed client below is the first projection. REST,
 * OpenAPI, the MCP tool catalogue, the command line and the chat command
 * router are the rest, and they arrive in P5-T07 onwards generated from this
 * list rather than written again.
 *
 * One permission decision, everywhere: a surface cannot reach a capability
 * that is not in here, and cannot reach one on easier terms than it declares.
 */

import { workspaceFeed } from "./activities.ts";
import {
  bindAgentScope,
  bulkApplyProposedChanges,
  bulkDismissProposedChanges,
  cancelAgentRun,
  createAgent,
  listProposedChanges,
  readAgentRun,
  readAgents,
  setAgentEnabled,
  startAgentRun,
} from "./agents.ts";
import {
  readOwnCredentialStatus,
  readProviderConfig,
  removePersonalCredential,
  removeWorkspaceCredential,
  rotateCredentials,
  setPersonalCredential,
  setWorkspaceCredential,
  updateProviderConfig,
} from "./ai.ts";
import {
  addCustomModel,
  readFeatureSettings,
  readModelCatalog,
  readPrompt,
  readTierRouting,
  removeCustomModel,
  removeTierPolicy,
  restorePrompt,
  setTierPolicy,
  updateCustomModel,
  updateFeatureSetting,
  updatePrompt,
} from "./ai-models.ts";
import {
  readBudgets,
  readUsageSummary,
  removeBudget,
  setBudget,
} from "./ai-usage.ts";
import { claimUpload, getBlobForDownload, prepareUpload } from "./blobs.ts";
import {
  archiveCycle,
  createCycle,
  ensureCurrentCycle,
  listCycles,
  readAnnualFrame,
  readCurrentCycle,
  readRhythmSettings,
  setAnnualFrame,
  updateCycle,
  updateRhythmSettings,
} from "./cycles.ts";
import type { ActionCallContext, ActionDefinition } from "./define.ts";
import {
  acceptLink,
  createPersonalLink,
  createWorkspaceLink,
  joinByTrustedDomain,
  revokeLink,
} from "./invitations.ts";
import {
  getNotificationSettings,
  listNotifications,
  markNotificationRead,
  snoozeNotification,
  toggleSubscription,
  updateOwnNotificationSettings,
} from "./notifications.ts";
import { workspaceOverview } from "./overview.ts";
import {
  convertToGuest,
  directory,
  eraseMember,
  orgChart,
  possibleManagersFor,
  restoreMember,
  suspendMember,
  updateMember,
  updateOwnProfile,
} from "./people.ts";
import {
  readWorkspaceSettings,
  resetWorkspaceSettings,
  updateWorkspaceBranding,
  updateWorkspaceGeneralSettings,
} from "./settings.ts";
import {
  addSpaceMember,
  archiveSpace,
  createSpace,
  joinSpace,
  leaveSpace,
  listSpaces,
  readSpace,
  removeSpaceMember,
  setSpaceMemberRole,
  updateSpace,
} from "./spaces.ts";
import {
  provisionWorkspace,
  renameWorkspace,
  setWorkspaceState,
} from "./workspace.ts";

/**
 * The registry, keyed by name so the typed client can infer an action's input
 * and output from the name alone.
 */
export const ACTION_MAP = {
  "workspace.overview": workspaceOverview,
  "workspace.rename": renameWorkspace,
  "workspace.setState": setWorkspaceState,
  "workspace.provision": provisionWorkspace,
  "people.updateOwnProfile": updateOwnProfile,
  "people.updateMember": updateMember,
  "people.suspend": suspendMember,
  "people.restore": restoreMember,
  "people.convertToGuest": convertToGuest,
  "people.erase": eraseMember,
  "people.directory": directory,
  "people.orgChart": orgChart,
  "people.possibleManagers": possibleManagersFor,
  "invitations.createWorkspaceLink": createWorkspaceLink,
  "invitations.createPersonalLink": createPersonalLink,
  "invitations.revokeLink": revokeLink,
  "invitations.acceptLink": acceptLink,
  "invitations.joinByTrustedDomain": joinByTrustedDomain,
  "blobs.prepareUpload": prepareUpload,
  "blobs.claimUpload": claimUpload,
  "blobs.getForDownload": getBlobForDownload,
  "notifications.list": listNotifications,
  "notifications.markRead": markNotificationRead,
  "notifications.snooze": snoozeNotification,
  "notifications.getSettings": getNotificationSettings,
  "notifications.updateSettings": updateOwnNotificationSettings,
  "subscriptions.toggle": toggleSubscription,
  "activities.workspaceFeed": workspaceFeed,
  "settings.readWorkspaceSettings": readWorkspaceSettings,
  "settings.updateWorkspaceGeneral": updateWorkspaceGeneralSettings,
  "settings.updateWorkspaceBranding": updateWorkspaceBranding,
  "settings.resetWorkspaceSettings": resetWorkspaceSettings,
  "ai.readProviderConfig": readProviderConfig,
  "ai.updateProviderConfig": updateProviderConfig,
  "ai.setWorkspaceCredential": setWorkspaceCredential,
  "ai.removeWorkspaceCredential": removeWorkspaceCredential,
  "ai.setPersonalCredential": setPersonalCredential,
  "ai.removePersonalCredential": removePersonalCredential,
  "ai.readOwnCredentialStatus": readOwnCredentialStatus,
  "ai.rotateCredentials": rotateCredentials,
  "ai.readModelCatalog": readModelCatalog,
  "ai.addCustomModel": addCustomModel,
  "ai.updateCustomModel": updateCustomModel,
  "ai.removeCustomModel": removeCustomModel,
  "ai.readTierRouting": readTierRouting,
  "ai.setTierPolicy": setTierPolicy,
  "ai.removeTierPolicy": removeTierPolicy,
  "ai.readFeatureSettings": readFeatureSettings,
  "ai.updateFeatureSetting": updateFeatureSetting,
  "ai.readPrompt": readPrompt,
  "ai.updatePrompt": updatePrompt,
  "ai.restorePrompt": restorePrompt,
  "ai.readBudgets": readBudgets,
  "ai.setBudget": setBudget,
  "ai.removeBudget": removeBudget,
  "ai.readUsageSummary": readUsageSummary,
  "agents.list": readAgents,
  "agents.create": createAgent,
  "agents.setEnabled": setAgentEnabled,
  "agents.bindScope": bindAgentScope,
  "agents.startRun": startAgentRun,
  "agents.readRun": readAgentRun,
  "agents.cancelRun": cancelAgentRun,
  "proposals.list": listProposedChanges,
  "proposals.bulkApply": bulkApplyProposedChanges,
  "proposals.bulkDismiss": bulkDismissProposedChanges,
  "spaces.list": listSpaces,
  "spaces.read": readSpace,
  "spaces.create": createSpace,
  "spaces.update": updateSpace,
  "spaces.archive": archiveSpace,
  "spaces.addMember": addSpaceMember,
  "spaces.setMemberRole": setSpaceMemberRole,
  "spaces.removeMember": removeSpaceMember,
  "spaces.join": joinSpace,
  "spaces.leave": leaveSpace,
  "cycles.list": listCycles,
  "cycles.current": readCurrentCycle,
  "cycles.ensureCurrent": ensureCurrentCycle,
  "cycles.create": createCycle,
  "cycles.update": updateCycle,
  "cycles.archive": archiveCycle,
  "rhythm.read": readRhythmSettings,
  "rhythm.update": updateRhythmSettings,
  "frame.read": readAnnualFrame,
  "frame.set": setAnnualFrame,
} as const;

export type ActionName = keyof typeof ACTION_MAP;

export const ACTIONS: readonly ActionDefinition[] = Object.values(
  ACTION_MAP,
) as unknown as readonly ActionDefinition[];

export function actionNames(): ActionName[] {
  return Object.keys(ACTION_MAP) as ActionName[];
}

export function getAction(name: string): ActionDefinition | undefined {
  return (ACTION_MAP as Record<string, ActionDefinition | undefined>)[name];
}

type ActionInput<K extends ActionName> = (typeof ACTION_MAP)[K] extends {
  input: { parse(value: unknown): infer I };
}
  ? I
  : never;

type ActionOutput<K extends ActionName> = Awaited<
  ReturnType<(typeof ACTION_MAP)[K]["handler"]>
>;

/**
 * The internal typed projection: call an action by name and get its own input
 * and output types, not `unknown`.
 *
 * This is what the web app uses. It is deliberately the same entry point the
 * generated surfaces will use, so a bug in permission handling shows up
 * everywhere at once rather than on five surfaces independently.
 */
export async function callAction<K extends ActionName>(
  context: ActionCallContext,
  name: K,
  input: ActionInput<K>,
): Promise<ActionOutput<K>> {
  const action = ACTION_MAP[name];
  // The cast is the one place the registry's heterogeneous shapes meet a
  // single call signature; the public types above keep callers honest.
  return (action as ActionDefinition).handler(context, input) as Promise<
    ActionOutput<K>
  >;
}
