/**
 * The due engine: what the product should say today, and to whom (P4-T04a).
 *
 * AI-NATIVE-PLAN.md §6.3. This is the half of the nudge machinery that decides;
 * P4-T04b decides what to swallow and P4-T04c decides how far to escalate.
 * Splitting it that way keeps this function answerable to one question, which
 * is the question a facilitator would ask: what is overdue right now.
 *
 * **Every rule key is checked against the catalogue before a row is written.**
 * CLAUDE.md's hard rule is that a message citing a rule the package does not
 * define fails the build; `isTriggerKey` is where that becomes true at run time
 * as well, and the refusal is loud rather than a silent skip.
 *
 * **The ladder is not here.** `escalation` in `packages/method` computes which
 * step fires and which roles it reaches, golden-master tested with no clock and
 * no rows. This resolves a role to a member and writes the row. A scheduler that
 * carried its own copy of the day numbers is how a threshold in §11 stops being
 * the threshold.
 */
import {
  activeOnly,
  checkIns,
  cycles,
  goals,
  type NudgeKind,
  type NudgeSubjectType,
  nudgeRules,
  nudges,
  proposedChanges,
  rhythmSettings,
  spaceMembers,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import {
  acknowledgementEscalation,
  type EscalationRole,
  escalation,
  isTriggerKey,
  type ResolvedThresholds,
  type SuppressionReason,
  suppressionFor,
  trigger,
} from "@openokr/method";
import { and, asc, count, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { daysPastDue } from "../cadence/service.ts";
import { OperationError } from "../operations/errors.ts";
import { resolveCoordinator } from "../spaces/roles.ts";

/**
 * A change the agent would make, offered rather than made (P4-T05c-a).
 *
 * `action` and `payload` are exactly what `proposals.bulkApply` will call, so a
 * proposal is a deferred action call and nothing more. That is what keeps
 * "propose by default" honest: there is no second write path an agent could
 * take, only an action a human runs later under their own name.
 */
export interface NudgeProposal {
  /** A key in the action registry. Applying it calls that action verbatim. */
  readonly action: string;
  readonly payload: Record<string, unknown>;
  /** True only where a model wrote the content. §6.5's template is not AI. */
  readonly aiGenerated: boolean;
}

export interface DueNudge {
  readonly ruleKey: string;
  readonly kind: NudgeKind;
  readonly subjectType: NudgeSubjectType;
  readonly subjectId: string;
  readonly recipientMemberId: string;
  readonly channel: string;
  readonly escalationStep: number;
  /**
   * Whether §6.3 lets this one through quiet hours and past the ceiling.
   *
   * True once the ladder has widened past the champion. Steps 0 to 2 are the
   * champion's own reminders and none of them earns waking somebody up.
   */
  readonly urgent: boolean;
  /**
   * The change this nudge offers, when it offers one.
   *
   * Absent on almost every nudge: a reminder to do something yourself carries
   * no draft. Present, it is written as a `proposed_changes` row and the nudge
   * links to it, so the recipient sees one thing to act on rather than two rows
   * to correlate.
   */
  readonly proposal?: NudgeProposal;
}

/**
 * The rule key each ladder step carries.
 *
 * Step 0 is the day-before reminder and step 1 is the due day itself, both of
 * which are still "this is yours to do". From step 2 the goal is overdue and the
 * ladder widens, so the key changes: a reviewer being brought in has not missed
 * a check-in, and telling them they have would be wrong.
 */
const RULE_FOR_STEP: Record<number, string> = {
  0: "checkin.due_soon",
  1: "checkin.due",
  2: "checkin.overdue",
  3: "checkin.stale",
  4: "checkin.overdue",
  5: "checkin.overdue",
};

/**
 * Which member holds a role for a goal.
 *
 * Exported since P4-T05b, because the blocker ladder resolves the same four
 * roles against the same goal columns. A second copy of "the coordinator falls
 * back to the manager, and the sponsor lives on the cycle" is how two ladders
 * end up escalating to different people from the same row.
 *
 * The champion and the reviewer are columns. The coordinator and the sponsor are
 * space roles, and where a space has no coordinator the role resolves to the
 * space manager (TECHNICAL-PLAN §4.2). A role nobody holds resolves to nothing
 * rather than to somebody arbitrary: escalating to a person who was never given
 * the job is worse than not escalating.
 */
export async function memberForRole(
  tx: WorkspaceTx,
  goal: {
    readonly championId: string | null;
    readonly reviewerId: string | null;
    readonly spaceId: string | null;
    readonly cycleId: string | null;
  },
  role: EscalationRole,
): Promise<string | null> {
  if (role === "champion") {
    return goal.championId;
  }
  if (role === "reviewer") {
    return goal.reviewerId;
  }
  if (!goal.spaceId) {
    return null;
  }
  const holders = await tx
    .select({
      memberId: spaceMembers.memberId,
      role: spaceMembers.role,
    })
    .from(spaceMembers)
    .where(activeOnly(spaceMembers, eq(spaceMembers.spaceId, goal.spaceId)))
    .orderBy(asc(spaceMembers.createdAt));

  if (role === "coordinator") {
    // §4.2's manager fallback lives in `resolveCoordinator` and is not repeated
    // here. It is one sentence of the method and easy to get subtly wrong in a
    // second place.
    return resolveCoordinator(holders) ?? null;
  }
  // §11's ladder ends at the sponsor, and a space has no sponsor: the cycle
  // does. A goal outside a cycle has none, and the ladder stops there rather
  // than escalating to somebody who was never given the job.
  if (!goal.cycleId) {
    return null;
  }
  const [cycle] = await tx
    .select({ sponsorId: cycles.sponsorId })
    .from(cycles)
    .where(activeOnly(cycles, eq(cycles.id, goal.cycleId)))
    .limit(1);
  return cycle?.sponsorId ?? null;
}

/**
 * Every check-in nudge due in this workspace as of `today`.
 *
 * `now` is passed in rather than read from a clock. A due engine that read the
 * clock could not be tested across a fortnight of a missed check-in without
 * waiting a fortnight, and that fortnight is what the acceptance criterion asks
 * about. The timezone is the workspace's, because a due date is a local date.
 */
export async function dueCheckInNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    /** Passed in, never read from a clock: see the note above. */
    readonly now: Date;
    readonly timeZone: string;
    readonly thresholds: ResolvedThresholds;
  },
): Promise<readonly DueNudge[]> {
  const grace = input.thresholds["cadence.stalenessGraceDays"];

  const rows = await tx
    .select({
      id: goals.id,
      nextCheckInAt: goals.nextCheckInAt,
      championId: goals.championId,
      reviewerId: goals.reviewerId,
      spaceId: goals.spaceId,
      cycleId: goals.cycleId,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, input.workspaceId),
        isNotNull(goals.nextCheckInAt),
        // A closed goal owes nobody a check-in. Nudging on one is the fastest
        // way to teach a champion to ignore the product.
        isNull(goals.closedAt),
      ),
    );

  const due: DueNudge[] = [];
  for (const goal of rows) {
    if (!goal.nextCheckInAt) {
      continue;
    }
    const past = daysPastDue(goal.nextCheckInAt, input.now, input.timeZone);
    if (past === null) {
      continue;
    }
    const step = escalation(past, grace, input.thresholds);
    if (step.step === null) {
      continue;
    }
    const ruleKey = RULE_FOR_STEP[step.step];
    if (!ruleKey || !isTriggerKey(ruleKey)) {
      // Loud rather than skipped. A rule key nothing defines is a defect in the
      // catalogue or in this map, and swallowing it would ship a nudge nobody
      // can trace back to a rule.
      throw new OperationError(
        "forbidden",
        `Escalation step ${step.step} has no rule key the catalogue defines.`,
      );
    }

    for (const role of step.targets) {
      const memberId = await memberForRole(tx, goal, role);
      if (!memberId) {
        continue;
      }
      due.push({
        ruleKey,
        // Every check-in trigger is the Champion's, which is §6.4's own split
        // rather than a guess: its first table is the rhythm and its second is
        // quality, and `trigger()` carries the owner for exactly this.
        kind: trigger(ruleKey)?.owner === "coach" ? "quality" : "rhythm",
        subjectType: "goal",
        subjectId: goal.id,
        recipientMemberId: memberId,
        // The member's own channel is resolved at delivery (P4-T04b), because
        // that is where the per-rule override and the quiet hours live. In-app
        // is the floor: it is the one channel a member cannot switch off,
        // because the review inbox is an obligation rather than a message.
        channel: "in_app",
        escalationStep: step.step,
        // Urgency is a property of **this recipient**, not of the step.
        //
        // A champion at step 5 is still the champion being reminded about their
        // own goal, and their daily reminder does not earn a quiet hour or a
        // pass through the weekly ceiling. The reviewer, coordinator and sponsor
        // are the escalation: somebody other than the owner of the work is
        // being told, and that is the part §6.3 says gets through.
        //
        // Deriving it from the step instead let a month of daily reminders sail
        // past a ceiling written to stop exactly that, which is what the
        // simulated month found.
        urgent: role !== "champion",
      });
    }
  }
  return due;
}

/**
 * Write the rows, returning what was written.
 *
 * A suppressed nudge is a row with a reason and no `sent_at`, not an absence.
 * Four of the five reasons are decisions the product made, and one that drops
 * them silently cannot answer "why did nobody hear about this".
 */
export async function recordNudgesInTx(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly due: readonly {
      readonly nudge: DueNudge;
      readonly suppressedReason: SuppressionReason | null;
    }[];
    readonly at: Date;
    /**
     * The agent run these proposals belong to (P4-T05c-a).
     *
     * `proposed_changes.run_id` is not null, so without a run there is nothing
     * for a proposal to hang off and any proposal on a due nudge is skipped.
     * That is the correct behaviour rather than a gap: `nudges.run`, the hourly
     * queue an administrator can call by hand, is not an agent run and must not
     * invent one to look like it proposed something.
     */
    readonly runId?: string;
  },
): Promise<
  readonly {
    readonly id: string;
    readonly sent: boolean;
    readonly proposalId: string | null;
  }[]
> {
  const written: {
    id: string;
    sent: boolean;
    proposalId: string | null;
  }[] = [];
  for (const { nudge, suppressedReason } of input.due) {
    if (!isTriggerKey(nudge.ruleKey)) {
      throw new OperationError(
        "forbidden",
        `\`${nudge.ruleKey}\` is not a rule the method package defines.`,
      );
    }

    // The proposal is written first, so the nudge can carry its id in the same
    // insert rather than being updated a moment later. Both are on this
    // transaction, so they commit together or not at all.
    //
    // A suppressed nudge still gets its proposal. The suppression decided that
    // **the message** was noise, not that the change was unwanted, and the
    // review queue is an obligation rather than a message: P3-T08's rule that
    // a snooze never hides a review-inbox obligation is the same rule seen
    // from here.
    const proposalId =
      nudge.proposal && input.runId
        ? await recordProposalInTx(tx, {
            workspaceId: input.workspaceId,
            runId: input.runId,
            nudge,
            proposal: nudge.proposal,
          })
        : null;
    // openokr:allow-mutation: runs on the transaction the calling Operation
    // opened, so the nudge rows and that Operation's audit row commit together.
    const [row] = await tx
      .insert(nudges)
      .values({
        workspaceId: input.workspaceId,
        ruleKey: nudge.ruleKey,
        kind: nudge.kind,
        subjectType: nudge.subjectType,
        subjectId: nudge.subjectId,
        recipientMemberId: nudge.recipientMemberId,
        channel: nudge.channel,
        escalationStep: nudge.escalationStep,
        scheduledFor: input.at,
        // A suppressed nudge is a row with a reason and no `sent_at`. Both
        // halves matter: the row is what makes the silence answerable.
        sentAt: suppressedReason === null ? input.at : null,
        suppressedReason,
        proposalId,
      })
      .returning({ id: nudges.id });
    if (row) {
      written.push({
        id: row.id,
        sent: suppressedReason === null,
        proposalId,
      });
    }
  }
  return written;
}

/**
 * Writes one proposal, unless an identical one is already waiting.
 *
 * **One pending proposal per subject per action.** A run happens every hour and
 * the condition that raised it holds until somebody acts, so an unguarded
 * insert would grow the review queue by one row an hour for a KPI nobody has
 * got to yet. The deduplication window does that job for nudges; this is the
 * same idea for the queue, and it has to be a distinct check because a proposal
 * has no `scheduled_for` to compare.
 *
 * Only `pending` blocks a new one. A proposal somebody dismissed was a decision
 * about that proposal, and a KPI still unhealthy a week later is entitled to be
 * offered again rather than silently never mentioned.
 */
async function recordProposalInTx(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly runId: string;
    readonly nudge: DueNudge;
    readonly proposal: NudgeProposal;
  },
): Promise<string | null> {
  const [existing] = await tx
    .select({ id: proposedChanges.id })
    .from(proposedChanges)
    .where(
      and(
        eq(proposedChanges.workspaceId, input.workspaceId),
        eq(proposedChanges.status, "pending"),
        eq(proposedChanges.action, input.proposal.action),
        eq(proposedChanges.subjectType, input.nudge.subjectType),
        eq(proposedChanges.subjectId, input.nudge.subjectId),
      ),
    )
    .limit(1);
  if (existing) {
    // Linked to the one already waiting rather than skipped, so today's nudge
    // still points at something the recipient can act on.
    return existing.id;
  }

  // openokr:allow-mutation: the calling Operation's own transaction, so the
  // proposal, the nudge that carries it and the audit row commit together.
  const [row] = await tx
    .insert(proposedChanges)
    .values({
      workspaceId: input.workspaceId,
      runId: input.runId,
      action: input.proposal.action,
      payload: input.proposal.payload,
      subjectType: input.nudge.subjectType,
      subjectId: input.nudge.subjectId,
      aiGenerated: input.proposal.aiGenerated,
    })
    .returning({ id: proposedChanges.id });
  return row?.id ?? null;
}

/** Members who are active, so a suspended one is never nudged. */
export async function activeMemberIds(
  tx: WorkspaceTx,
  workspaceId: string,
): Promise<ReadonlySet<string>> {
  const rows = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.status, "active"),
        ),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

export interface SuppressionContext {
  readonly workspaceQuietMode: boolean;
  /** Only the rules this workspace has changed, by key. */
  readonly rules: ReadonlyMap<
    string,
    { readonly enabled: boolean; readonly quietModeExempt: boolean }
  >;
  /** Each member's timezone and quiet window. */
  readonly members: ReadonlyMap<
    string,
    {
      readonly timeZone: string;
      readonly quietHours: {
        readonly start: string;
        readonly end: string;
      } | null;
    }
  >;
  /** How many nudges each member has already had in the last seven days. */
  readonly sentThisWeek: ReadonlyMap<string, number>;
}

/**
 * Everything the suppression decision needs, loaded once for the whole run.
 *
 * Per nudge would be four queries times the number of goals, and the answer for
 * a member does not change between two nudges in the same run.
 */
export async function loadSuppressionContext(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly now: Date;
    readonly workspaceTimeZone: string;
  },
): Promise<SuppressionContext> {
  const [settings] = await tx
    .select({ quietMode: rhythmSettings.quietMode })
    .from(rhythmSettings)
    .where(eq(rhythmSettings.workspaceId, input.workspaceId))
    .limit(1);

  const ruleRows = await tx
    .select({
      ruleKey: nudgeRules.ruleKey,
      enabled: nudgeRules.enabled,
      quietModeExempt: nudgeRules.quietModeExempt,
    })
    .from(nudgeRules)
    .where(
      activeOnly(nudgeRules, eq(nudgeRules.workspaceId, input.workspaceId)),
    );

  const memberRows = await tx
    .select({
      id: workspaceMembers.id,
      timezone: workspaceMembers.timezone,
      quietHours: workspaceMembers.quietHours,
    })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, input.workspaceId),
      ),
    );

  const weekAgo = new Date(input.now.getTime() - 7 * 86_400_000);
  const weekRows = await tx
    .select({ memberId: nudges.recipientMemberId, sent: count(nudges.id) })
    .from(nudges)
    .where(
      activeOnly(
        nudges,
        and(
          eq(nudges.workspaceId, input.workspaceId),
          isNotNull(nudges.sentAt),
          gte(nudges.scheduledFor, weekAgo),
        ),
      ),
    )
    .groupBy(nudges.recipientMemberId);

  return {
    workspaceQuietMode: settings?.quietMode ?? false,
    rules: new Map(
      ruleRows.map((row) => [
        row.ruleKey,
        { enabled: row.enabled, quietModeExempt: row.quietModeExempt },
      ]),
    ),
    members: new Map(
      memberRows.map((row) => [
        row.id,
        {
          // A member with no timezone of their own follows the workspace's,
          // which is the §4.14 default rather than a guess.
          timeZone: row.timezone ?? input.workspaceTimeZone,
          quietHours: row.quietHours ?? null,
        },
      ]),
    ),
    sentThisWeek: new Map(weekRows.map((row) => [row.memberId, row.sent])),
  };
}

/** The most recent nudge this member already has about this subject. */
async function previousFor(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly nudge: DueNudge;
    readonly now: Date;
  },
): Promise<{ hoursAgo: number; escalationStep: number } | null> {
  const [row] = await tx
    .select({
      scheduledFor: nudges.scheduledFor,
      escalationStep: nudges.escalationStep,
    })
    .from(nudges)
    .where(
      activeOnly(
        nudges,
        and(
          eq(nudges.workspaceId, input.workspaceId),
          eq(nudges.recipientMemberId, input.nudge.recipientMemberId),
          eq(nudges.subjectType, input.nudge.subjectType),
          eq(nudges.subjectId, input.nudge.subjectId),
          // Only what was actually said counts. A nudge the product suppressed
          // was never heard, so treating it as a previous message would silence
          // the next one for a day on the strength of nothing.
          isNotNull(nudges.sentAt),
        ),
      ),
    )
    .orderBy(desc(nudges.scheduledFor))
    .limit(1);
  if (!row) {
    return null;
  }
  return {
    hoursAgo: (input.now.getTime() - row.scheduledFor.getTime()) / 3_600_000,
    escalationStep: row.escalationStep,
  };
}

/** The member's local hour and minute, for the quiet-hours check. */
const localTimeIn = (now: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { hour: value("hour") % 24, minute: value("minute") };
};

/**
 * The suppression decision for one due nudge, with its reason.
 *
 * Returns null to send. The reason is what the row carries, so the volume
 * dashboard can say which decision cost a workspace its messages.
 */
export async function decideSuppression(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly nudge: DueNudge;
    readonly now: Date;
    readonly context: SuppressionContext;
    readonly thresholds: ResolvedThresholds;
  },
): Promise<SuppressionReason | null> {
  const rule = input.context.rules.get(input.nudge.ruleKey);
  const member = input.context.members.get(input.nudge.recipientMemberId);
  const previous = await previousFor(tx, {
    workspaceId: input.workspaceId,
    nudge: input.nudge,
    now: input.now,
  });

  return suppressionFor(
    {
      ruleKey: input.nudge.ruleKey,
      escalationStep: input.nudge.escalationStep,
      urgent: input.nudge.urgent,
      // No row means the canon default, which is enabled. §4.14: nothing has to
      // be configured before the product works.
      ruleEnabled: rule?.enabled ?? true,
      quietModeExempt: rule?.quietModeExempt ?? false,
      workspaceQuietMode: input.context.workspaceQuietMode,
      previous,
      localTime: localTimeIn(input.now, member?.timeZone ?? "UTC"),
      quietHours: member?.quietHours ?? null,
      // A per-subject snooze is P4-T04c's provenance work; nothing sets it yet.
      snoozedUntilHoursAway: null,
      sentThisWeek:
        input.context.sentThisWeek.get(input.nudge.recipientMemberId) ?? 0,
    },
    input.thresholds,
  );
}

/**
 * Every acknowledgement nudge due in this workspace (P4-T04c).
 *
 * §11: the reviewer is asked one day after publication and the coordinator is
 * brought in at three. A published check-in nobody acknowledged is a loop left
 * open, and the person who left it open is the reviewer rather than the
 * champion who wrote it.
 *
 * The reviewer **of record** is the one on the check-in row, not whoever holds
 * the role today. P3-T08 stamped it at publication for exactly this reason: a
 * reassignment moves the obligation only while it is still open, and a closed
 * loop keeps the member who actually closed it.
 */
export async function dueAcknowledgementNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly now: Date;
    readonly thresholds: ResolvedThresholds;
  },
): Promise<readonly DueNudge[]> {
  const rows = await tx
    .select({
      id: checkIns.id,
      // The check-in's subject is always a goal today, and the column pair says
      // so rather than a foreign key named for it.
      goalId: checkIns.subjectId,
      publishedAt: checkIns.publishedAt,
      reviewerMemberId: checkIns.reviewerMemberId,
    })
    .from(checkIns)
    .where(
      activeOnly(
        checkIns,
        eq(checkIns.workspaceId, input.workspaceId),
        isNotNull(checkIns.publishedAt),
        // An acknowledged check-in is a closed loop and owes nobody anything.
        isNull(checkIns.acknowledgedAt),
      ),
    );

  const due: DueNudge[] = [];
  for (const row of rows) {
    if (!row.publishedAt || !row.reviewerMemberId) {
      continue;
    }
    const days = Math.floor(
      (input.now.getTime() - row.publishedAt.getTime()) / 86_400_000,
    );
    const step = acknowledgementEscalation(days, input.thresholds);
    if (step.step === null) {
      continue;
    }
    const ruleKey = step.step >= 2 ? "ack.overdue" : "ack.owed";
    if (!isTriggerKey(ruleKey)) {
      throw new OperationError(
        "forbidden",
        `\`${ruleKey}\` is not a rule the method package defines.`,
      );
    }

    for (const role of step.targets) {
      const memberId =
        role === "reviewer"
          ? row.reviewerMemberId
          : await memberForRole(
              tx,
              await goalRolesFor(tx, input.workspaceId, row.goalId),
              role,
            );
      if (!memberId) {
        continue;
      }
      due.push({
        ruleKey,
        kind: trigger(ruleKey)?.owner === "coach" ? "quality" : "rhythm",
        subjectType: "check_in",
        subjectId: row.id,
        recipientMemberId: memberId,
        channel: "in_app",
        escalationStep: step.step,
        // Same rule from the other side: the reviewer owns this obligation, so
        // their own reminder is not an escalation. The coordinator's is.
        urgent: role !== "reviewer",
      });
    }
  }
  return due;
}

/** The role columns a goal carries, for resolving a ladder target. */
export async function goalRolesFor(
  tx: WorkspaceTx,
  workspaceId: string,
  goalId: string,
): Promise<{
  championId: string | null;
  reviewerId: string | null;
  spaceId: string | null;
  cycleId: string | null;
}> {
  const [goal] = await tx
    .select({
      championId: goals.championId,
      reviewerId: goals.reviewerId,
      spaceId: goals.spaceId,
      cycleId: goals.cycleId,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.id, goalId),
        eq(goals.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return (
    goal ?? {
      championId: null,
      reviewerId: null,
      spaceId: null,
      cycleId: null,
    }
  );
}
