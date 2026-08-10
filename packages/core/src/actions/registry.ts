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
import { claimUpload, getBlobForDownload, prepareUpload } from "./blobs.ts";
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
