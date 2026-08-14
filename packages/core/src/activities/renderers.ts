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
  "cycle.pack_item_set": (p) =>
    `Input pack item ${Number(p.itemKey ?? 0)} was marked ${p.gathered ? "gathered" : "missing"}`,
  "cycle.pack_distributed": () => "The input pack was distributed",
  "cycle.issue_added": (p) =>
    `A strategic issue was added at impact ${Number(p.impact ?? 0)}`,
  "cycle.issue_reranked": (p) =>
    `A strategic issue was reranked to impact ${Number(p.impact ?? 0)}`,
  "cycle.priority_added": (p) =>
    p.promoted
      ? "An issue was promoted into a priority"
      : "A priority was added",
  "cycle.revalidated": (p) =>
    p.changed
      ? "The annual frame was revalidated with a change"
      : "The annual frame was revalidated and holds",
  "cycle.baseline_health_set": () => "Baseline health was recorded",
  "cycle.capacity_recorded": () => "What was cut was recorded",
  "cycle.calibrated": () => "The cycle was calibrated mid-flight",
  "cycle.published": (p) =>
    `Cycle "${asString(p.name, "a cycle")}" was published`,
  "frame.set": (p) =>
    `The annual frame for ${asString(p.yearLabel, "the year")} was set`,
  "goal.created": (p) =>
    `${asString(p.level, "A")} goal "${asString(p.title, "a goal")}" was created`,
  "goal.updated": (p) => `Goal "${asString(p.title, "a goal")}" was edited`,
  "goal.closed": (p) =>
    `The goal was closed as ${asString(p.successStatus, "closed")}, with a decision to ${asString(p.closeDecision, "keep")} it`,
  "goal.reopened": () => "The goal was reopened",
  "goal.role_reassigned": (p) =>
    `The goal's ${asString(p.role, "role")} was reassigned`,
  "goal.moved_to_cycle": (p) =>
    `Goal "${asString(p.title, "a goal")}" was moved to another cycle`,
  "key_result.created": (p) =>
    `Key result "${asString(p.title, "a key result")}" was added`,
  "key_result.updated": () => "A key result was edited",
  "key_result.value_recorded": (p) =>
    `A key result moved to ${Number(p.value ?? 0)}`,
  "key_result.kpi_unlinked": () =>
    "A key result was unlinked from its KPI and keeps the last value it reported",
  "check_in.draft_opened": (p) =>
    p.reopened
      ? "A draft check-in was reopened"
      : "A draft check-in was started",
  "check_in.published": (p) =>
    `A check-in was published as ${asString(p.status, "on track").replace("_", " ")}`,
  "check_in.edited": () => "A check-in was edited inside its window",
  "check_in.deleted": (p) =>
    p.rolledBack
      ? "The latest check-in was deleted and the goal rolled back to what it said before"
      : "A check-in was deleted",
  "check_in.acknowledged": (p) =>
    p.repeat
      ? "A check-in was already acknowledged"
      : "The reviewer acknowledged a check-in",
  "alignment.dependency_added": (p) =>
    p.note
      ? "Two goals were linked as depending on each other, with a note"
      : "Two goals were linked as depending on each other",
  "alignment.dependency_removed": () =>
    "A dependency between two goals was removed",
  "alignment.register_added": (p) =>
    `A key result was recorded as depending on ${String(p.provider ?? "another team")}`,
  "alignment.register_confirmed": () =>
    "The providing team confirmed a dependency",
  "alignment.register_risk_owned": () =>
    "A risk owner was named for an unconfirmed dependency",
  "alignment.register_removed": () =>
    "A dependency was removed from the register",
  "alignment.finding_dismissed": (p) =>
    `An alignment finding was dismissed (${String(p.ruleKey ?? "no rule")})`,
  "kpi.category_created": (p) =>
    `A KPI category "${String(p.name ?? "")}" was added`,
  "kpi.created": (p) =>
    `A ${String(p.frequency ?? "")} KPI "${String(p.title ?? "")}" was added`,
  "kpi.value_recorded": (p) =>
    p.created
      ? `A value was recorded for the period beginning ${String(p.periodStart ?? "")}`
      : `The value for the period beginning ${String(p.periodStart ?? "")} was updated`,
  "kpi.formula_set": (p) =>
    `A KPI became calculated from ${Number(p.references ?? 0)} other measure(s)`,
  "kpi.tree_created": (p) => `A KPI tree "${String(p.name ?? "")}" was named`,
  "kpi.updated": (p) =>
    `A KPI was edited (${(p.fields as string[] | undefined)?.join(", ") ?? "no fields"})`,
  "kpi.recovery_launched": (p) =>
    `A recovery objective with ${Number(p.keyResults ?? 0)} key result(s) was launched`,
  "check_in.vote_cast": (p) =>
    p.changed ? "A confidence vote was changed" : "A confidence vote was cast",
  "check_in.votes_revealed": (p) =>
    `${Number(p.revealed ?? 0)} confidence vote(s) were revealed together`,
  "cadence.staleness_swept": (p) =>
    `${Number(p.flipped ?? 0)} goal(s) went past their grace window and now read outdated`,
  // Comments and reactions (P3-T16)
  "comment.created": (p) =>
    `Commented on a ${asString(p.subjectType, "subject")}: ${asString(p.excerpt, "(empty)")}`,
  "comment.updated": (p) =>
    `Edited a comment on a ${asString(p.subjectType, "subject")}`,
  "comment.deleted": (p) =>
    `Deleted a comment on a ${asString(p.subjectType, "subject")}`,
  "reaction.added": (p) =>
    `Reacted ${asString(p.emoji)} on a ${asString(p.subjectType, "subject")}`,
  "reaction.removed": (p) =>
    `Removed ${asString(p.emoji)} reaction from a ${asString(p.subjectType, "subject")}`,
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
