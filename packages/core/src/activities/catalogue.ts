/**
 * The typed activity catalogue (TECHNICAL-PLAN §4.11, P2-T07).
 *
 * "Payloads snapshot human labels": a feed entry has to read like a
 * sentence without a second query, and it has to keep reading that way
 * after the thing it names is renamed, converted or erased. Every kind
 * below that can outlive its own display name carries that name in its
 * payload rather than trusting a live lookup.
 *
 * `test.*` kinds are exempt from the "unregistered kind cannot be
 * persisted" rule. Every prior Phase 2 task's tests write throwaway
 * activity kinds (`test.bind`, `test.grant-full`, and so on) as scaffolding
 * for exercising the Operation pipeline, not as product events; retrofitting
 * every one of them into this catalogue would make the catalogue describe
 * test fixtures instead of the product. A kind in this shape can never be a
 * real one: `workspace.provisioned` and `test.bind` cannot collide.
 */
import { z } from "zod";

const TEST_SCAFFOLD_KIND = /^test\./;

export const isTestScaffoldKind = (kind: string): boolean =>
  TEST_SCAFFOLD_KIND.test(kind);

/**
 * One entry per registered kind, its payload schema. `z.object({})` where a
 * kind has nothing worth snapshotting yet — an id in `subjectId` is already
 * enough to look the current row up, and nothing about it changes shape the
 * way a member's name does.
 */
export const ACTIVITY_PAYLOAD_SCHEMAS = {
  "workspace.provisioned": z.object({ name: z.string(), slug: z.string() }),
  "workspace.renamed": z.object({ from: z.string(), to: z.string() }),
  "workspace.state_changed": z.object({
    from: z.enum(["active", "read_only", "frozen"]),
    to: z.enum(["active", "read_only", "frozen"]),
  }),
  "member.profile_updated": z.object({ name: z.string() }),
  "member.updated": z.object({ name: z.string() }),
  "member.suspended": z.object({ name: z.string() }),
  "member.restored": z.object({ name: z.string() }),
  "member.converted_to_guest": z.object({ name: z.string() }),
  "member.erased": z.object({ name: z.string() }),
  "invitation.link_created": z.object({}).catchall(z.unknown()),
  "invitation.link_revoked": z.object({}),
  "invitation.accepted": z.object({}).catchall(z.unknown()),
  "invitation.joined_by_trusted_domain": z.object({}).catchall(z.unknown()),
  "blob.prepared": z.object({}),
  "blob.claimed": z.object({}).catchall(z.unknown()),
  "notification.read": z.object({}),
  "notification.snoozed": z.object({}),
  "notification_settings.updated": z.object({}),
  "subscription.added": z.object({}),
  "subscription.canceled": z.object({}),
  "workspace.general_settings_updated": z
    .object({ keys: z.array(z.string()) })
    .catchall(z.unknown()),
  "workspace.branding_updated": z.object({}).catchall(z.unknown()),
  "workspace.settings_reset": z
    .object({ keys: z.array(z.string()) })
    .catchall(z.unknown()),
  "ai.provider_config_updated": z.object({ provider: z.string() }),
  "ai.workspace_credential_set": z.object({ provider: z.string() }),
  "ai.workspace_credential_removed": z.object({ provider: z.string() }),
  "ai.personal_credential_set": z.object({ provider: z.string() }),
  "ai.personal_credential_removed": z.object({ provider: z.string() }),
  "ai.credentials_rotated": z.object({
    examined: z.number().int(),
    rewrapped: z.number().int(),
  }),
  "ai.custom_model_added": z.object({}).catchall(z.unknown()),
  "ai.custom_model_updated": z.object({}).catchall(z.unknown()),
  "ai.custom_model_removed": z.object({}),
  "ai.tier_policy_set": z.object({}).catchall(z.unknown()),
  "ai.tier_policy_removed": z.object({ tier: z.string() }),
  "ai.feature_setting_updated": z.object({ featureKey: z.string() }),
  "ai.prompt_updated": z.object({
    promptKey: z.string(),
    version: z.number().int(),
  }),
  "ai.prompt_restored": z.object({ promptKey: z.string() }),
  "ai.usage_recorded": z
    .object({ provider: z.string(), modelId: z.string() })
    .catchall(z.unknown()),
  "ai.budget_set": z.object({}).catchall(z.unknown()),
  "ai.budget_removed": z.object({}),
  "agent.created": z.object({}).catchall(z.unknown()),
  "agent.enabled_changed": z.object({ enabled: z.boolean() }),
  "agent.scope_bound": z.object({}).catchall(z.unknown()),
  "agent.run_started": z.object({}).catchall(z.unknown()),
  "agent.run_task_processed": z.object({
    taskIndex: z.number().int(),
    outcome: z.enum(["denied", "simulated", "proposed", "applied", "error"]),
  }),
  "agent.run_cancelled": z.object({}).catchall(z.unknown()),
  "agent.run_completed": z.object({}).catchall(z.unknown()),
  "agent.run_failed": z.object({}).catchall(z.unknown()),
  "proposed_change.bulk_applied": z.object({}).catchall(z.unknown()),
  "proposed_change.bulk_dismissed": z.object({}).catchall(z.unknown()),
  // Spaces (P3-T01). The name is snapshotted for the same reason a member's is:
  // a feed entry saying "renamed Marketing" has to keep saying that after the
  // space is renamed again.
  "space.created": z.object({ name: z.string() }),
  "space.updated": z.object({ name: z.string() }),
  "space.archived": z.object({ name: z.string() }),
  "space.member_added": z.object({
    name: z.string(),
    role: z.enum(["member", "manager", "coordinator"]),
  }),
  "space.member_removed": z.object({
    role: z.enum(["member", "manager", "coordinator"]),
  }),
  "space.member_role_changed": z.object({
    from: z.enum(["member", "manager", "coordinator"]),
    to: z.enum(["member", "manager", "coordinator"]),
  }),
  "space.joined": z.object({}),
  "space.left": z.object({}),
  // Cycles and the rhythm (P3-T02).
  "cycle.created": z.object({ name: z.string() }),
  "cycle.resolved": z.object({ name: z.string() }),
  "cycle.updated": z.object({ name: z.string() }),
  "cycle.archived": z.object({ name: z.string() }),
  "rhythm.updated": z.object({ keys: z.array(z.string()) }),
  "frame.set": z.object({ yearLabel: z.string() }),
  // The guided cycle workflow (P3-T03).
  "cycle.pack_item_set": z.object({
    itemKey: z.number().int(),
    gathered: z.boolean(),
  }),
  "cycle.pack_distributed": z.object({ name: z.string() }),
  "cycle.issue_added": z.object({
    impact: z.number().int(),
    source: z.string(),
  }),
  "cycle.issue_reranked": z.object({ impact: z.number().int() }),
  "cycle.priority_added": z.object({ promoted: z.boolean() }),
  "cycle.revalidated": z.object({ holds: z.boolean(), changed: z.boolean() }),
  "cycle.baseline_health_set": z.object({}),
  "cycle.capacity_recorded": z.object({}),
  "cycle.calibrated": z.object({}),
  "cycle.published": z.object({
    name: z.string(),
    // Which gates were unmet when somebody published anyway (P4-T03).
    // Empty on a normal publication, which is most of them.
    overrodeGates: z.array(z.number().int()).optional(),
  }),
  // The nudge run (P4-T04a). One activity per run rather than per nudge:
  // the nudges are rows of their own, and a feed with one entry per message
  // sent would bury everything a person actually did.
  "nudges.run": z.object({ recorded: z.number().int() }),
  // A snooze silences the nudge and never the obligation, which is why it
  // is worth recording: somebody chose to stop being messaged about a
  // thing they still owe.
  "nudge.snoozed": z.object({ until: z.string() }),
  // Goals and key results (P3-T04). A goal's title is snapshotted for the same
  // reason a member's name is: "closed Raise activation" has to keep reading that
  // way after the goal is renamed or erased.
  "goal.created": z.object({ title: z.string(), level: z.string() }),
  "goal.updated": z.object({ title: z.string() }),
  "goal.closed": z.object({
    successStatus: z.enum(["achieved", "missed"]),
    closeDecision: z.enum(["keep", "modify", "abandon"]),
  }),
  "goal.reopened": z.object({}),
  "goal.role_reassigned": z.object({ role: z.enum(["champion", "reviewer"]) }),
  "goal.moved_to_cycle": z.object({ title: z.string() }),
  "key_result.created": z.object({ title: z.string() }),
  "key_result.updated": z.object({}),
  "key_result.value_recorded": z.object({ value: z.number() }),
  "key_result.kpi_unlinked": z.object({}),
  // Check-ins (P3-T07). A draft emits only that a composer was opened; nothing
  // about the goal, because a draft is silent about the goal by design.
  "check_in.draft_opened": z.object({ reopened: z.boolean() }),
  "check_in.published": z.object({
    status: z.enum(["on_track", "caution", "off_track"]),
    valuesWritten: z.number().int(),
  }),
  "check_in.edited": z.object({}),
  "check_in.deleted": z.object({ rolledBack: z.boolean() }),
  "check_in.acknowledged": z.object({ repeat: z.boolean() }),
  // Alignment (P3-T09). Every one of these changes the structure, which is what
  // the score reads, so each is worth a line in the feed even though none of
  // them moves a number a reader watches.
  "alignment.dependency_added": z.object({ note: z.boolean() }),
  "alignment.dependency_removed": z.object({}),
  "alignment.register_added": z.object({ provider: z.string() }),
  "alignment.register_confirmed": z.object({}),
  "alignment.register_risk_owned": z.object({}),
  "alignment.register_removed": z.object({}),
  "alignment.finding_dismissed": z.object({ ruleKey: z.string() }),
  // The one finding kind with a mechanical fix (§5.3, P4-T06b-b). The re-parent
  // itself emits `goal.updated` from its own action; this records the decision
  // that caused it, which is the part a reader cannot infer from the goal.
  "alignment.finding_applied": z.object({ parentGoalId: z.string() }),
  // KPIs (P3-T12). Recording a value is worth a line: it is the one write that
  // moves a corridor state, and a state change is what a nudge reads later.
  "kpi.category_created": z.object({ name: z.string() }),
  "kpi.created": z.object({ title: z.string(), frequency: z.string() }),
  "kpi.value_recorded": z.object({
    periodStart: z.string(),
    created: z.boolean(),
  }),
  "kpi.formula_set": z.object({ references: z.number().int() }),
  // The recovery loop (P3-T14). Launching one is a commitment by the team, so
  // it belongs in the feed beside the objectives it creates.
  "kpi.tree_created": z.object({ name: z.string() }),
  "kpi.updated": z.object({ fields: z.array(z.string()) }),
  // Closing a cycle out (P3-T15). Both are worth a line in the feed: one
  // records what happened, the other decides what the next cycle inherits.
  // `cycle.archived` above is P3-T02's soft delete. This is §8.9's archive,
  // which records what the cycle achieved, so it is named for what it writes.
  "cycle.snapshotted": z.object({
    snapshots: z.number().int(),
    verdict: z.string().nullable(),
  }),
  "cycle.fed_forward": z.object({
    priorScores: z.number().int(),
    issues: z.number().int(),
  }),
  "kpi.recovery_launched": z.object({
    goalId: z.string(),
    keyResults: z.number().int(),
  }),
  "check_in.vote_cast": z.object({ changed: z.boolean() }),
  "check_in.votes_revealed": z.object({ revealed: z.number().int() }),
  // The staleness sweep (P3-T06). A health flip nobody triggered still has to be
  // visible: it is the product saying a goal went quiet, not a person acting.
  "cadence.staleness_swept": z.object({
    examined: z.number().int(),
    flipped: z.number().int(),
  }),
  // Comments and reactions (P3-T16). Each is worth a line: a comment is a
  // conversation someone started, an edit keeps the thread honest, and a
  // reaction is the lightest form of engagement that still feeds engagement
  // signals.
  "comment.created": z.object({
    subjectType: z.string(),
    excerpt: z.string(),
  }),
  "comment.updated": z.object({
    subjectType: z.string(),
    excerpt: z.string(),
  }),
  "comment.deleted": z.object({ subjectType: z.string() }),
  "reaction.added": z.object({
    emoji: z.string(),
    subjectType: z.string(),
  }),
  "reaction.removed": z.object({
    emoji: z.string(),
    subjectType: z.string(),
  }),
  // Sessions (P4-T07a)
  "session.created": z.object({ kind: z.string(), title: z.string() }),
  "session.opened": z.object({ kind: z.string() }),
  "session.stageAdvanced": z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
  }),
  "session.skipped": z.object({ kind: z.string() }),
  "session.closed": z.object({ kind: z.string() }),
  // Confidence round (P4-T07b)
  "session.voteCast": z.object({ keyResultId: z.string() }),
  "session.votesRevealed": z.object({
    keyResultId: z.string(),
    count: z.number(),
  }),
  "session.confidenceConfirmed": z.object({
    keyResultId: z.string(),
    confidence: z.number(),
  }),
  // Blockers (P4-T07c)
  "session.blockerCreated": z.object({
    keyResultId: z.string(),
    type: z.string(),
  }),
  "session.blockerResolved": z.object({ type: z.string() }),
  // Commitments, digest, streaks (P4-T08)
  "session.commitmentsSet": z.object({ count: z.number() }),
  "session.commitmentsClosed": z.object({ count: z.number() }),
  "session.coordinatorNoteSet": z.object({}),
  // The monthly review (METHOD.md §7.5, P4-T09). A trend and a decision both
  // hang off the goal rather than the session, because the goal page is where
  // somebody comes looking for them a month later.
  "session.trendRecorded": z.object({
    trend: z.string(),
    sessionId: z.string(),
  }),
  "session.shiftsRecorded": z.object({ sessionId: z.string() }),
  "session.decisionRecorded": z.object({
    sessionId: z.string(),
    keyResultId: z.string().nullable(),
  }),
  // The quarterly review's pacing (METHOD.md §8.1, P4-T10a-a). Neither payload
  // carries the note: an activity row is read by everybody who can see the
  // space, and the note is the one thing that is private.
  "session.minuteAdded": z.object({
    stageKey: z.string(),
    added: z.number(),
  }),
  "session.stageNoteSet": z.object({ stageKey: z.string() }),
  // The pulse and the word are deliberately absent: an activity row is read by
  // everybody who can see the space, and section 8.2 gives the room's read to
  // the facilitator alone.
  "session.pulseGiven": z.object({ sessionId: z.string() }),
  // No score in the payload: section 8.3 hides the objective score until the
  // room reveals it, and a feed announcing each grade would reveal it one entry
  // at a time.
  "session.keyResultScored": z.object({ sessionId: z.string() }),
  // No score in the payload: the feed reaches the whole space and the reveal
  // was to the room in the review (P4-T10b-b).
  "session.objectiveScoreRevealed": z.object({ sessionId: z.string() }),
  // No goal title, no narrative text and no recognition words: all three reach
  // the whole space and all three were written for the room (P4-T10c).
  "session.micPassed": z.object({ sessionId: z.string() }),
  "session.narrativeWritten": z.object({ sessionId: z.string() }),
  "session.kudosGiven": z.object({ sessionId: z.string() }),
  // No note text, no column and no answer: the feed reaches the whole space, an
  // anonymous retro note would lose its anonymity to it, and the management
  // retro is read by two roles inside that space (P4-T11a).
  "session.retroNoteAdded": z.object({ sessionId: z.string() }),
  "session.retroNoteRemoved": z.object({ sessionId: z.string() }),
  "session.retroVoteCast": z.object({ sessionId: z.string() }),
  "session.managementAnswerRecorded": z.object({ sessionId: z.string() }),
  // No cause number and no scores. §8.4 says look for the system, not the
  // person, and a space-wide entry naming a cause against a named key result
  // invites the opposite. The survey's payload matters more still: an activity
  // row carries its actor, so scores in it would attribute an anonymous
  // answer in the one place everybody reads (P4-T11b).
  "session.rootCauseNamed": z.object({ sessionId: z.string() }),
  "session.processHealthSubmitted": z.object({ sessionId: z.string() }),
} as const satisfies Record<string, z.ZodType>;

export type ActivityKind = keyof typeof ACTIVITY_PAYLOAD_SCHEMAS;

/**
 * The kinds a feed renderer collapses consecutive same-actor rows into one
 * entry for: an edit to something, restated five times in five minutes, is
 * one story. Every other kind is a narrative event — a status changed, a
 * relationship formed — and is never collapsed, even next to an identical
 * one, because "suspended, then restored, then suspended again" is not the
 * same event three times.
 */
export const AGGREGATABLE_KINDS: ReadonlySet<string> = new Set([
  "member.profile_updated",
  "member.updated",
  "workspace.general_settings_updated",
  "workspace.branding_updated",
  // Every real AI call writes one of these; the feed would otherwise be
  // mostly usage noise the instant a real feature calls a provider.
  "ai.usage_recorded",
]);

export class UnregisteredActivityKindError extends Error {
  constructor(kind: string) {
    super(
      `"${kind}" is not in the activity catalogue ` +
        `(packages/core/src/activities/catalogue.ts). Register it there, ` +
        `with a payload schema, before an operation can persist it.`,
    );
    this.name = "UnregisteredActivityKindError";
  }
}

export class InvalidActivityPayloadError extends Error {
  constructor(kind: string, issues: string) {
    super(`Activity "${kind}" has an invalid payload: ${issues}`);
    this.name = "InvalidActivityPayloadError";
  }
}

/**
 * Throws for a kind outside the catalogue, or a payload that does not match
 * its own kind's schema — "an event kind outside the catalogue cannot be
 * persisted" as a build-time check would only catch a typo written today;
 * this catches one written by whoever adds the nineteenth kind next year.
 */
export function validateActivityPayload(
  kind: string,
  payload: Record<string, unknown>,
): void {
  if (isTestScaffoldKind(kind)) {
    return;
  }
  const schema = (
    ACTIVITY_PAYLOAD_SCHEMAS as Record<string, z.ZodType | undefined>
  )[kind];
  if (!schema) {
    throw new UnregisteredActivityKindError(kind);
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new InvalidActivityPayloadError(kind, result.error.message);
  }
}
