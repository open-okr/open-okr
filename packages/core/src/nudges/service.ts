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
  nudges,
  spaceMembers,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import {
  type EscalationRole,
  escalation,
  isTriggerKey,
  type ResolvedThresholds,
  trigger,
} from "@openokr/method";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
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
      });
    }
  }
  return due;
}

/**
 * Write the rows, returning what was written.
 *
 * Suppression is P4-T04b's job, so everything here is sent. The column exists
 * from this migration anyway, because a table that gained it later would have a
 * period of history where a missing row and a swallowed one look the same.
 */
export async function recordNudgesInTx(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly due: readonly DueNudge[];
    readonly at: Date;
  },
): Promise<readonly string[]> {
  const written: string[] = [];
  for (const nudge of input.due) {
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
        // Sent here because nothing suppresses yet. P4-T04b is what leaves
        // `sent_at` null and fills `suppressed_reason` instead.
        sentAt: input.at,
      })
      .returning({ id: nudges.id });
    if (row) {
      written.push(row.id);
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
