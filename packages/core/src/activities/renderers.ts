/**
 * Per-kind feed renderers (TECHNICAL-PLAN §4.11, screen S-31, P2-T07).
 *
 * One function per registered kind, turning its payload into the sentence a
 * feed row reads. Plain strings rather than the rich-text renderer: a feed
 * line is generated from data the product already trusts (a name it stored
 * itself), never from a member's own written content, so there is nothing
 * here for the sanitising allow-list to do.
 */
import type { ActivityKind } from "./catalogue.ts";

export type ActivityRenderer = (payload: Record<string, unknown>) => string;

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

export const ACTIVITY_RENDERERS: Record<ActivityKind, ActivityRenderer> = {
  "workspace.provisioned": (p) => `Workspace "${asString(p.name)}" created`,
  "workspace.renamed": (p) =>
    `Workspace renamed from "${asString(p.from)}" to "${asString(p.to)}"`,
  "workspace.state_changed": (p) =>
    `Workspace state changed from "${asString(p.from)}" to "${asString(p.to)}"`,
  "member.profile_updated": (p) =>
    `${asString(p.name, "A member")} updated their profile`,
  "member.updated": (p) => `${asString(p.name, "A member")} was updated`,
  "member.suspended": (p) => `${asString(p.name, "A member")} was suspended`,
  "member.restored": (p) => `${asString(p.name, "A member")} was restored`,
  "member.converted_to_guest": (p) =>
    `${asString(p.name, "A member")} was converted to a guest`,
  "member.erased": (p) => `${asString(p.name, "A member")}'s data was erased`,
  "invitation.link_created": () => "An invitation link was created",
  "invitation.link_revoked": () => "An invitation link was revoked",
  "invitation.accepted": () => "An invitation was accepted",
  "invitation.joined_by_trusted_domain": () =>
    "Someone joined through a trusted email domain",
  "blob.prepared": () => "A file upload was started",
  "blob.claimed": () => "A file was uploaded",
  "notification.read": () => "A notification was read",
  "notification.snoozed": () => "A notification was snoozed",
  "notification_settings.updated": () => "Notification settings were updated",
  "subscription.added": () => "Someone subscribed",
  "subscription.canceled": () => "Someone unsubscribed",
  "workspace.general_settings_updated": (p) =>
    `Workspace settings were updated (${
      Array.isArray(p.keys) ? p.keys.join(", ") : "general"
    })`,
  "workspace.branding_updated": () => "Workspace branding was updated",
  "workspace.settings_reset": (p) =>
    `Workspace settings were reset to their defaults (${
      Array.isArray(p.keys) ? p.keys.join(", ") : "general"
    })`,
  "ai.provider_config_updated": (p) =>
    `${asString(p.provider, "A provider")}'s configuration was updated`,
  "ai.workspace_credential_set": (p) =>
    `A workspace key was set for ${asString(p.provider, "a provider")}`,
  "ai.workspace_credential_removed": (p) =>
    `The workspace key for ${asString(p.provider, "a provider")} was removed`,
  "ai.personal_credential_set": (p) =>
    `A personal key was set for ${asString(p.provider, "a provider")}`,
  "ai.personal_credential_removed": (p) =>
    `A personal key for ${asString(p.provider, "a provider")} was removed`,
  "ai.credentials_rotated": (p) =>
    `${Number(p.rewrapped ?? 0)} of ${Number(p.examined ?? 0)} AI credential(s) were re-wrapped onto the current key`,
  "ai.custom_model_added": () => "A custom model was added to the catalogue",
  "ai.custom_model_updated": () => "A custom model was updated",
  "ai.custom_model_removed": () =>
    "A custom model was removed from the catalogue",
  "ai.tier_policy_set": (p) =>
    `The "${asString(p.tier, "a")}" tier was mapped to ${asString(p.provider)}/${asString(p.modelId)}`,
  "ai.tier_policy_removed": (p) =>
    `The "${asString(p.tier, "a")}" tier's policy was removed`,
  "ai.feature_setting_updated": (p) =>
    `"${asString(p.featureKey, "A feature")}" settings were updated`,
  "ai.prompt_updated": (p) =>
    `A new version of "${asString(p.promptKey, "a prompt")}" was saved`,
  "ai.prompt_restored": (p) =>
    `"${asString(p.promptKey, "A prompt")}" was restored to its default`,
  "ai.usage_recorded": (p) =>
    `An AI call ran against ${asString(p.provider, "a provider")}/${asString(p.modelId, "a model")}`,
  "ai.budget_set": (p) =>
    `An AI budget was set for the "${asString(p.scope, "workspace")}" scope`,
  "ai.budget_removed": () => "An AI budget was removed",
  "agent.created": (p) =>
    `Agent "${asString(p.name, "New agent")}" was created`,
  "agent.enabled_changed": (p) =>
    `An agent was turned ${p.enabled ? "on" : "off"}`,
  "agent.scope_bound": (p) =>
    `An agent was granted access to a ${asString(p.resourceType, "resource")}`,
  "agent.run_started": () => "An agent run started",
  "agent.run_task_processed": (p) =>
    `An agent run's task ${Number(p.taskIndex ?? 0) + 1} was ${asString(p.outcome, "processed")}`,
  "agent.run_cancelled": () => "An agent run was cancelled",
  "agent.run_completed": () => "An agent run completed",
  "agent.run_failed": (p) =>
    `An agent run failed${p.error ? `: ${asString(p.error)}` : ""}`,
  "proposed_change.bulk_applied": (p) =>
    `${Number(p.appliedCount ?? 0)} proposed change(s) were applied`,
  "proposed_change.bulk_dismissed": (p) =>
    `${Number(p.dismissedCount ?? 0)} proposed change(s) were dismissed`,
  "space.created": (p) =>
    `Space "${asString(p.name, "New space")}" was created`,
  "space.updated": (p) => `Space "${asString(p.name, "A space")}" was updated`,
  "space.archived": (p) =>
    `Space "${asString(p.name, "A space")}" was archived`,
  "space.member_added": (p) =>
    `${asString(p.name, "A member")} joined this space as ${asString(p.role, "a member")}`,
  "space.member_removed": () => "A member was removed from this space",
  "space.member_role_changed": (p) =>
    `A member's role changed from ${asString(p.from, "member")} to ${asString(p.to, "member")}`,
  "space.joined": () => "Someone joined this space",
  "space.left": () => "Someone left this space",
  "cycle.created": (p) =>
    `Cycle "${asString(p.name, "a new cycle")}" was created`,
  "cycle.resolved": (p) =>
    `Cycle "${asString(p.name, "the current cycle")}" was opened`,
  "cycle.updated": (p) => `Cycle "${asString(p.name, "a cycle")}" was updated`,
  "cycle.archived": (p) =>
    `Cycle "${asString(p.name, "a cycle")}" was archived`,
  "rhythm.updated": (p) =>
    `Rhythm settings were updated (${Array.isArray(p.keys) ? p.keys.join(", ") : "thresholds"})`,
  "frame.set": (p) =>
    `The annual frame for ${asString(p.yearLabel, "the year")} was set`,
};

/** Renders any registered kind; a kind without one is a build-time bug, not a runtime one, since the catalogue is exhaustive. */
export function renderActivity(
  kind: string,
  payload: Record<string, unknown>,
): string {
  const renderer = (
    ACTIVITY_RENDERERS as Record<string, ActivityRenderer | undefined>
  )[kind];
  return renderer ? renderer(payload) : kind;
}
