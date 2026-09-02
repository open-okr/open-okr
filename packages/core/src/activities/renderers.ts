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
  "channel.templatesSynced": (p) =>
    `Synced ${asString(p.recorded, "0")} WhatsApp templates, withdrawing ${asString(p.withdrawn, "0")}`,
  "channel.templateMapped": (p) =>
    `The "${asString(p.ruleKey, "unnamed")}" reminder was pointed at a WhatsApp template`,
  "channel.templateUnmapped": (p) =>
    `The "${asString(p.ruleKey, "unnamed")}" reminder no longer uses a WhatsApp template`,
  "connection.revoked": () => "A connection to an external agent was ended",
  "api_token.created": (p) =>
    `An API token "${asString(p.name, "unnamed")}" was created for the ${asString(p.audience, "rest")} surface`,
  "api_token.revoked": (p) =>
    `The API token "${asString(p.name, "unnamed")}" was revoked`,
  "device.approved": (p) =>
    `${asString(p.clientName, "A terminal")} was authorised to sign in`,
  "device.denied": (p) => `${asString(p.clientName, "A terminal")} was refused`,
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
  // One line per run, not per nudge. A feed with an entry for every message
  // the product sent would bury everything a person actually did.
  "nudges.run": (p) =>
    `ran the nudge engine and recorded ${String(p.recorded)} nudge(s)`,
  "nudge.snoozed": (p) => `snoozed a nudge until ${asString(p.until, "later")}`,
  "frame.set": (p) =>
    `The annual frame for ${asString(p.yearLabel, "the year")} was set`,
  "goal.created": (p) =>
    `${asString(p.level, "A")} goal "${asString(p.title, "a goal")}" was created`,
  "goal.updated": (p) => `Goal "${asString(p.title, "a goal")}" was edited`,
  "goal.closed": (p) =>
    `The goal was closed as ${asString(p.successStatus, "closed")}, with a decision to ${asString(p.closeDecision, "keep")} it`,
  "goal.reopened": () => "The goal was reopened",
  "goal.deleted": (p) => `Removed the goal "${p.title}"`,
  "goal.role_reassigned": (p) =>
    `The goal's ${asString(p.role, "role")} was reassigned`,
  "goal.moved_to_cycle": (p) =>
    `Goal "${asString(p.title, "a goal")}" was moved to another cycle`,
  // Initiatives (P5-T10a). "Work" rather than "an initiative" where the title
  // is missing, because a feed line has to read as a sentence either way.
  "initiative.created": (p) =>
    `Initiative "${asString(p.title, "some work")}" was created`,
  "initiative.updated": () => "An initiative was edited",
  "initiative.deleted": (p) =>
    `Initiative "${asString(p.title, "some work")}" was removed`,
  "initiative.linked": () =>
    "An initiative was recorded as work that will move a key result",
  "initiative.unlinked": () =>
    "An initiative is no longer recorded against a key result",
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
  "alignment.finding_applied": () =>
    "A relink finding was applied and the goal was re-parented",
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
  "cycle.snapshotted": (p) =>
    `A cycle's performance was recorded in ${Number(p.snapshots ?? 0)} snapshot(s)${
      p.verdict ? `, reading ${String(p.verdict)}` : " and no verdict"
    }`,
  "cycle.fed_forward": (p) =>
    `The next cycle inherited ${Number(p.priorScores ?? 0)} prior score(s) and ${Number(p.issues ?? 0)} carried issue(s)`,
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
  // Sessions (P4-T07a)
  "session.created": (p) =>
    `Created a ${asString(p.kind)} session: ${asString(p.title)}`,
  "session.opened": (p) => `Opened the ${asString(p.kind)} session`,
  "session.stageAdvanced": (p) =>
    `Advanced to the ${asString(p.to, "next")} stage`,
  "session.skipped": (p) => `Skipped the ${asString(p.kind)} session`,
  "session.closed": (p) => `Closed the ${asString(p.kind)} session`,
  // Confidence round (P4-T07b)
  "session.voteCast": () => "Cast a confidence vote",
  "session.votesRevealed": (p) =>
    `Revealed ${asString(p.count, "0")} votes on a key result`,
  "session.confidenceConfirmed": (p) =>
    `Confirmed confidence at ${asString(p.confidence)}`,
  // Blockers (P4-T07c)
  "session.blockerCreated": (p) => `Opened a ${asString(p.type)} blocker`,
  "session.blockerResolved": (p) => `Resolved a ${asString(p.type)} blocker`,
  "session.blockerReassigned": (p) =>
    `A ${asString(p.type, "blocker")} blocker was handed to ${asString(p.ownerName, "somebody else")}`,
  // Commitments, digest, streaks (P4-T08)
  "session.commitmentsSet": (p) =>
    `Set ${asString(p.count, "0")} commitments for this week`,
  "session.commitmentsClosed": (p) =>
    `Closed ${asString(p.count, "0")} commitments from last week`,
  "session.coordinatorNoteSet": () => "Added a coordinator note to the digest",
  "session.trendRecorded": (p) =>
    `Recorded the trend for this objective as ${asString(p.trend, "unknown")}`,
  "session.shiftsRecorded": () =>
    "Noted the resource or priority shifts for this review",
  "session.decisionRecorded": () => "Recorded a decision in the monthly review",
  "session.minuteAdded": (p) =>
    `Gave the ${asString(p.stageKey, "current")} stage another minute`,
  "session.stageNoteSet": (p) =>
    `Made a private note on the ${asString(p.stageKey, "current")} stage`,
  "session.pulseGiven": () => "Gave their pulse for the cycle",
  "session.keyResultScored": () => "Graded a key result in the review",
  "session.objectiveScoreRevealed": () =>
    "Revealed this objective's score in the review",
  "session.micPassed": () => "Passed the mic in the review",
  "session.narrativeWritten": () => "Wrote this objective's review narrative",
  "session.kudosGiven": () => "Named somebody's effort in the review",
  "session.retroNoteAdded": () => "Added a note to the review retro",
  "session.retroNoteRemoved": () => "Removed a note from the review retro",
  "session.retroVoteCast": () => "Voted in the review retro",
  "session.managementAnswerRecorded": () =>
    "Recorded a management retro answer",
  "session.rootCauseNamed": () => "Named a root cause in the review",
  "session.processHealthSubmitted": () =>
    "Answered the review's process-health survey",
  "session.diagnosticRead": () => "Read the review's rhythm diagnostic",
  "session.objectiveDecided": () => "Closed this objective in the review",
  "session.learningCaptured": () => "Captured a learning in the review",
  "session.nextCycleDrafted": () => "Drafted an objective for the next cycle",
  "session.actionAgreed": () => "Agreed an action in the review",
  "session.actionCompleted": () => "Updated a review action",
  // Written because the map is exhaustive over the catalogue, and never read:
  // both kinds are in PRIVATE_ACTIVITY_KINDS, so no feed reaches them. Left as
  // real sentences rather than empty strings, in case a member's own history
  // screen ever wants them (P4-T14a-a).
  "copilot.asked": () => "Asked the copilot a question",
  "copilot.answered": () => "The copilot answered",
  "copilot.proposed": () => "The copilot proposed a change",
  "copilot.proposalApplied": () => "Applied a copilot proposal",
  "copilot.proposalDismissed": () => "Dismissed a copilot proposal",
  "copilot.proposalUndone": () => "Undid a copilot proposal",
  "channel.connected": (p) => `Connected ${p.provider}`,
  "channel.disconnected": (p) => `Disconnected ${p.provider}`,
  "channel.identity_linked": (p) => `Linked their ${p.provider} account`,
  "channel.identity_unlinked": (p) => `Unlinked their ${p.provider} account`,
  "channel.link_started": (p) => `Asked for a ${p.provider} linking code`,
  // Named by what it is rather than by what it says. The body is not in the
  // payload and this line is read by people who may be entitled to know a
  // message went out without being entitled to read it.
  "channel.message_queued": (p) =>
    p.duplicate
      ? `A ${p.provider} message was already queued`
      : `Queued a ${p.provider} message`,
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
