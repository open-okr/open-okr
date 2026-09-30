/**
 * Five of the Champion's §6.4 triggers that never fired (completeness review
 * H-11): `confidence.critical`, `digest.weekly`, `commitment.due`,
 * `streak.at_risk` and `cycle.phase_blocked`.
 *
 * Readers only, like every other file here. Each one decides with a pure
 * function from `packages/method/src/trigger-conditions.ts` and resolves the
 * recipient the catalogue names. Nothing here writes to the domain.
 *
 * **Bounded, so a standing condition is not a daily complaint.** The two that
 * react to an event, a critical confidence and a closed session, look back
 * only as far as §11's deduplication window: the first run after the event
 * says it once, and deduplication holds the rest of the window. The three on a
 * calendar fire on one named day.
 */
import {
  activeOnly,
  checkIns,
  commitments,
  cycles,
  goals,
  keyResults,
  okrSessions,
  sessionConfidences,
  spaceMembers,
  streaks,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import {
  commitmentDueToday,
  confidenceIsCritical,
  isTriggerKey,
  phasesClosingToday,
  type ResolvedThresholds,
  streakAtRisk,
  type TriggerKey,
  trigger,
} from "@openokr/method";
import { and, eq, gte, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import {
  type AgentScope,
  agentSeesGoal,
  agentSeesSession,
  agentSeesSpaceId,
} from "../agents/scope.ts";
import { evaluateWorkflow, loadCycleForWorkflow } from "../cycles/workflow.ts";
import { OperationError } from "../operations/errors.ts";
import { localDateOf } from "../sessions/booking.ts";
import { resolveCoordinator } from "../spaces/roles.ts";
import { spaceRoleHolders } from "./rituals.ts";
import { type DueNudge, goalRolesFor, memberForRole } from "./service.ts";
import { urgentFor } from "./sweep.ts";

const DAY_MS = 86_400_000;

/** One nudge, with the rule key refused before the row exists. */
function nudge(input: {
  readonly ruleKey: TriggerKey;
  readonly subjectType: DueNudge["subjectType"];
  readonly subjectId: string;
  readonly recipientMemberId: string;
  readonly urgent: boolean;
  readonly escalationStep?: number;
}): DueNudge {
  if (!isTriggerKey(input.ruleKey)) {
    throw new OperationError(
      "forbidden",
      `\`${input.ruleKey}\` is not a rule the method package defines.`,
    );
  }
  return {
    ruleKey: input.ruleKey,
    kind: trigger(input.ruleKey)?.owner === "coach" ? "quality" : "rhythm",
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    recipientMemberId: input.recipientMemberId,
    channel: "in_app",
    escalationStep: input.escalationStep ?? 0,
    urgent: input.urgent,
  };
}

/** The earliest instant an event may have happened and still be news. */
const windowStart = (now: Date, thresholds: ResolvedThresholds): Date =>
  new Date(
    now.getTime() - thresholds["cadence.nudgeDeduplicationHours"] * 3_600_000,
  );

/**
 * `confidence.critical`: a key result scored at or below 0.3, to the
 * coordinator the same day (§3.2, §6.4).
 *
 * "Scored" is a confidence somebody recorded: confirmed in a session's
 * confidence round, or published with a check-in. The coordinator is the
 * goal's space coordinator; a goal outside a space goes to its cycle's
 * sponsor, because §3.2 says management, and the sponsor is who that is when
 * no space is involved. It escalates, so it is urgent.
 */
export async function dueCriticalConfidenceNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly now: Date;
    readonly thresholds: ResolvedThresholds;
    readonly scope?: AgentScope;
  },
): Promise<readonly DueNudge[]> {
  const since = windowStart(input.now, input.thresholds);
  const critical = new Set<string>();

  const confirmed = await tx
    .select({
      goalId: keyResults.goalId,
      confidence: sessionConfidences.confirmedConfidence,
    })
    .from(sessionConfidences)
    .innerJoin(keyResults, eq(keyResults.id, sessionConfidences.keyResultId))
    .innerJoin(goals, eq(goals.id, keyResults.goalId))
    .where(
      activeOnly(
        sessionConfidences,
        eq(sessionConfidences.workspaceId, input.workspaceId),
        gte(sessionConfidences.createdAt, since),
        isNull(goals.deletedAt),
        isNull(goals.closedAt),
        input.scope ? agentSeesGoal(input.scope) : undefined,
      ),
    );
  for (const row of confirmed) {
    if (confidenceIsCritical(Number(row.confidence), input.thresholds)) {
      critical.add(row.goalId);
    }
  }

  // A check-in writes each key result's confidence as it publishes, so the
  // key results of a goal checked in inside the window carry what it said.
  const published = await tx
    .select({ goalId: keyResults.goalId, confidence: keyResults.confidence })
    .from(checkIns)
    .innerJoin(keyResults, eq(keyResults.goalId, checkIns.subjectId))
    .innerJoin(goals, eq(goals.id, keyResults.goalId))
    .where(
      activeOnly(
        checkIns,
        eq(checkIns.workspaceId, input.workspaceId),
        isNotNull(checkIns.publishedAt),
        gte(checkIns.publishedAt, since),
        isNull(keyResults.deletedAt),
        isNull(goals.deletedAt),
        isNull(goals.closedAt),
        input.scope ? agentSeesGoal(input.scope) : undefined,
      ),
    );
  for (const row of published) {
    if (
      confidenceIsCritical(
        row.confidence === null ? null : Number(row.confidence),
        input.thresholds,
      )
    ) {
      critical.add(row.goalId);
    }
  }

  const due: DueNudge[] = [];
  for (const goalId of critical) {
    const roles = await goalRolesFor(tx, input.workspaceId, goalId);
    const recipient = roles.spaceId
      ? await memberForRole(tx, roles, "coordinator")
      : await cycleSponsor(tx, roles.cycleId);
    if (!recipient) {
      continue;
    }
    due.push(
      nudge({
        ruleKey: "confidence.critical",
        subjectType: "goal",
        subjectId: goalId,
        recipientMemberId: recipient,
        // A step above the champion's own reminders, so a check-in nudge to
        // the same coordinator today does not swallow it.
        escalationStep: 1,
        urgent: urgentFor(
          "confidence.critical",
          recipient === roles.championId,
        ),
      }),
    );
  }
  return due;
}

async function cycleSponsor(
  tx: WorkspaceTx,
  cycleId: string | null,
): Promise<string | null> {
  if (!cycleId) {
    return null;
  }
  const [row] = await tx
    .select({ sponsorId: cycles.sponsorId })
    .from(cycles)
    .where(activeOnly(cycles, eq(cycles.id, cycleId)))
    .limit(1);
  return row?.sponsorId ?? null;
}

/**
 * `digest.weekly`: the week's digest, to the space and its leadership, after
 * the weekly session closes (§7.2 step 4, §6.4).
 *
 * The space is every person in it; leadership is the sponsor of the
 * session's cycle. Agents are space members and are not told.
 */
export async function dueWeeklyDigestNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly now: Date;
    readonly thresholds: ResolvedThresholds;
    readonly scope?: AgentScope;
  },
): Promise<readonly DueNudge[]> {
  const closed = await tx
    .select({
      id: okrSessions.id,
      spaceId: okrSessions.spaceId,
      cycleId: okrSessions.cycleId,
    })
    .from(okrSessions)
    .where(
      activeOnly(
        okrSessions,
        eq(okrSessions.workspaceId, input.workspaceId),
        eq(okrSessions.kind, "weekly"),
        eq(okrSessions.state, "closed"),
        isNotNull(okrSessions.endedAt),
        gte(okrSessions.endedAt, windowStart(input.now, input.thresholds)),
        input.scope ? agentSeesSession(input.scope) : undefined,
      ),
    );

  const due: DueNudge[] = [];
  for (const session of closed) {
    const recipients = new Set<string>();
    if (session.spaceId) {
      const people = await tx
        .select({ memberId: spaceMembers.memberId })
        .from(spaceMembers)
        .innerJoin(
          workspaceMembers,
          eq(workspaceMembers.id, spaceMembers.memberId),
        )
        .where(
          activeOnly(
            spaceMembers,
            eq(spaceMembers.spaceId, session.spaceId),
            inArray(workspaceMembers.kind, ["human", "guest"]),
            isNull(workspaceMembers.deletedAt),
          ),
        );
      for (const person of people) {
        recipients.add(person.memberId);
      }
    }
    const sponsor = await cycleSponsor(tx, session.cycleId);
    if (sponsor) {
      recipients.add(sponsor);
    }
    for (const recipient of recipients) {
      due.push(
        nudge({
          ruleKey: "digest.weekly",
          subjectType: "session",
          subjectId: session.id,
          recipientMemberId: recipient,
          urgent: false,
        }),
      );
    }
  }
  return due;
}

/**
 * `commitment.due`: an open commitment, to its owner, on the last working day
 * of its week (§7.2 step 3, §6.4). One nudge per session per owner, because
 * the subject is the session that set them.
 */
export async function dueCommitmentNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly now: Date;
    readonly timeZone: string;
    readonly scope?: AgentScope;
  },
): Promise<readonly DueNudge[]> {
  const today = localDateOf(input.now, input.timeZone);
  const open = await tx
    .select({
      sessionId: commitments.sessionId,
      ownerId: commitments.ownerId,
      weekStart: commitments.weekStart,
    })
    .from(commitments)
    .where(
      activeOnly(
        commitments,
        eq(commitments.workspaceId, input.workspaceId),
        isNull(commitments.closedAt),
        isNull(commitments.delivered),
        isNotNull(commitments.sessionId),
        input.scope
          ? agentSeesSpaceId(input.scope, commitments.spaceId)
          : undefined,
      ),
    );

  const due: DueNudge[] = [];
  const said = new Set<string>();
  for (const row of open) {
    const key = `${row.sessionId}:${row.ownerId}`;
    if (said.has(key) || !commitmentDueToday(row.weekStart, today)) {
      continue;
    }
    said.add(key);
    due.push(
      nudge({
        ruleKey: "commitment.due",
        subjectType: "session",
        subjectId: row.sessionId as string,
        recipientMemberId: row.ownerId,
        urgent: false,
      }),
    );
  }
  return due;
}

/**
 * `streak.at_risk`: to the coordinator, on the last working day of a week the
 * space has not met in, after a week it did (§7.2, §6.4).
 *
 * The subject is the space's last closed session, the one that holds the
 * streak: a space is not a nudge subject, and that session is what the
 * streak is counted from.
 */
export async function dueStreakNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly now: Date;
    readonly timeZone: string;
    readonly scope?: AgentScope;
  },
): Promise<readonly DueNudge[]> {
  const today = localDateOf(input.now, input.timeZone);
  const rows = await tx
    .select({ spaceId: streaks.spaceId, currentWeeks: streaks.currentWeeks })
    .from(streaks)
    .where(
      and(
        eq(streaks.workspaceId, input.workspaceId),
        input.scope
          ? agentSeesSpaceId(input.scope, streaks.spaceId)
          : undefined,
      ),
    );

  const due: DueNudge[] = [];
  for (const streak of rows) {
    if (streak.currentWeeks <= 0) {
      continue;
    }
    const sessions = await tx
      .select({
        id: okrSessions.id,
        state: okrSessions.state,
        scheduledFor: okrSessions.scheduledFor,
        endedAt: okrSessions.endedAt,
      })
      .from(okrSessions)
      .where(
        activeOnly(
          okrSessions,
          eq(okrSessions.workspaceId, input.workspaceId),
          eq(okrSessions.spaceId, streak.spaceId),
          ne(okrSessions.state, "skipped"),
        ),
      );
    const held = sessions
      .filter((session) => session.state === "closed" && session.endedAt)
      .sort(
        (a, b) => (b.endedAt as Date).getTime() - (a.endedAt as Date).getTime(),
      )[0];
    if (!held) {
      continue;
    }
    // Still booked for later this week, so its own reminders have it. The
    // check only matters on a Friday, so the week ends two days out.
    const sunday = localDateOf(
      new Date(Date.parse(`${today}T12:00:00Z`) + 2 * DAY_MS),
      "UTC",
    );
    const bookedLaterThisWeek = sessions.some(
      (session) =>
        (session.state === "scheduled" || session.state === "running") &&
        session.scheduledFor >= input.now &&
        localDateOf(session.scheduledFor, input.timeZone) <= sunday,
    );
    if (
      !streakAtRisk({
        today,
        currentWeeks: streak.currentWeeks,
        lastSessionOn: localDateOf(held.endedAt as Date, input.timeZone),
        bookedLaterThisWeek,
      })
    ) {
      continue;
    }
    const coordinator = resolveCoordinator(
      await spaceRoleHolders(tx, streak.spaceId),
    );
    if (!coordinator) {
      continue;
    }
    due.push(
      nudge({
        ruleKey: "streak.at_risk",
        subjectType: "session",
        subjectId: held.id,
        recipientMemberId: coordinator,
        urgent: false,
      }),
    );
  }
  return due;
}

/**
 * `cycle.phase_blocked`: to the facilitator, on the day a planning phase's
 * §2.4 window closes with its conditions unmet (§6.4).
 *
 * The workflow is evaluated only on a day some phase's window closes, and
 * only for a cycle that has not started or published, so this costs nothing
 * on the other days of the year.
 */
export async function duePhaseBlockedNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly now: Date;
    readonly timeZone: string;
    readonly thresholds: ResolvedThresholds;
  },
): Promise<readonly DueNudge[]> {
  const today = localDateOf(input.now, input.timeZone);
  const rows = await tx
    .select({
      id: cycles.id,
      mode: cycles.mode,
      startsOn: cycles.startsOn,
      facilitatorId: cycles.facilitatorId,
    })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, input.workspaceId),
        ne(cycles.status, "closed"),
        isNull(cycles.publishedAt),
        isNotNull(cycles.facilitatorId),
      ),
    );

  const due: DueNudge[] = [];
  for (const row of rows) {
    const daysUntilStart = Math.round(
      (Date.parse(`${row.startsOn}T00:00:00Z`) -
        Date.parse(`${today}T00:00:00Z`)) /
        DAY_MS,
    );
    const closing = phasesClosingToday(row.mode, daysUntilStart);
    if (closing.length === 0) {
      continue;
    }
    const cycle = await loadCycleForWorkflow(tx, input.workspaceId, row.id);
    if (!cycle) {
      continue;
    }
    const { phases } = await evaluateWorkflow(
      tx,
      input.workspaceId,
      cycle,
      input.thresholds,
    );
    const blocked = phases.some(
      (phase) => closing.includes(phase.phase) && phase.state === "todo",
    );
    if (!blocked) {
      continue;
    }
    due.push(
      nudge({
        ruleKey: "cycle.phase_blocked",
        subjectType: "cycle",
        subjectId: row.id,
        recipientMemberId: row.facilitatorId as string,
        urgent: urgentFor("cycle.phase_blocked", false),
      }),
    );
  }
  return due;
}
