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
  goals,
  type NudgeKind,
  type NudgeSubjectType,
  nudgeRules,
  nudges,
  rhythmSettings,
  spaceMembers,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import {
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
 * The champion and the reviewer are columns. The coordinator and the sponsor are
 * space roles, and where a space has no coordinator the role resolves to the
 * space manager (TECHNICAL-PLAN §4.2). A role nobody holds resolves to nothing
 * rather than to somebody arbitrary: escalating to a person who was never given
 * the job is worse than not escalating.
 */
async function memberForRole(
  tx: WorkspaceTx,
  goal: {
    readonly championId: string | null;
    readonly reviewerId: string | null;
    readonly spaceId: string | null;
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
  // §11's ladder ends at the sponsor, and a space has no sponsor column: the
  // cycle does. Resolved by the caller that knows which cycle a goal is in,
  // which is P4-T04c's escalation work. Until then the ladder stops at the
  // coordinator rather than escalating to somebody arbitrary.
  return null;
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
        // Widened past the champion, so somebody other than the owner of the
        // work is being told. That is what makes it worth a quiet hour.
        urgent: step.targets.some((target) => target !== "champion"),
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
  },
): Promise<readonly { readonly id: string; readonly sent: boolean }[]> {
  const written: { id: string; sent: boolean }[] = [];
  for (const { nudge, suppressedReason } of input.due) {
    if (!isTriggerKey(nudge.ruleKey)) {
      throw new OperationError(
        "forbidden",
        `\`${nudge.ruleKey}\` is not a rule the method package defines.`,
      );
    }
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
      })
      .returning({ id: nudges.id });
    if (row) {
      written.push({ id: row.id, sent: suppressedReason === null });
    }
  }
  return written;
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
