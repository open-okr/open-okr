/**
 * The weekly session lifecycle and the per-cycle countdown (P4-T05b).
 *
 * AI-NATIVE-PLAN.md §6.2's third and fourth Champion cadences. The weekly run
 * opens and closes a session; the per-cycle run counts down to a publication
 * deadline and prepares a review.
 *
 * **Both are readers only.** Nothing here opens a session, closes a cycle or
 * writes a proposal. The Champion's autonomy is propose-and-approve, and the
 * only thing these produce is a nudge row carrying a rule key. §6.2's "opens
 * and closes the weekly session" in the sense of changing a session's state is
 * the facilitator's action in P4-T07a's own screen; what the agent does is say
 * that it is time, and say it once.
 *
 * **Which day fires is not decided here.** Every threshold comes from
 * `packages/method/src/countdown.ts`, which takes a day count and a §11
 * parameter and returns the trigger. This counts the days in the workspace
 * calendar and resolves the recipient. Splitting it that way is why the numbers
 * stay §11 parameters instead of becoming numbers in a scheduler, and it is the
 * same split P3-T06 made for the check-in ladder.
 */
import {
  activeOnly,
  cycles,
  okrSessions,
  spaceMembers,
  type WorkspaceTx,
} from "@openokr/db";
import {
  cycleClosingDue,
  cycleStartsDue,
  isTriggerKey,
  planningOpensDue,
  publicationCountdownMilestone,
  type ResolvedThresholds,
  reviewPreparationDue,
  sessionLifecycleStage,
} from "@openokr/method";
import { asc, eq } from "drizzle-orm";
import {
  formatLocalDate,
  localDateIn,
  parseLocalDate,
} from "../cycles/generation.ts";
import { OperationError } from "../operations/errors.ts";
import { resolveCoordinator } from "../spaces/roles.ts";
import type { DueNudge } from "./service.ts";
import { urgentFor } from "./sweep.ts";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** One nudge, with the rule key refused before the row exists. */
function nudge(input: {
  readonly ruleKey: string;
  readonly subjectType: DueNudge["subjectType"];
  readonly subjectId: string;
  readonly recipientMemberId: string;
  readonly urgent: boolean;
}): DueNudge {
  if (!isTriggerKey(input.ruleKey)) {
    throw new OperationError(
      "forbidden",
      `\`${input.ruleKey}\` is not a rule the method package defines.`,
    );
  }
  return {
    ruleKey: input.ruleKey,
    kind: "rhythm",
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    recipientMemberId: input.recipientMemberId,
    channel: "in_app",
    escalationStep: 0,
    urgent: input.urgent,
  };
}

/** Whole days from one local date to another, both in the workspace calendar. */
function localDaysBetween(from: string, to: string): number {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) -
      Date.UTC(a.year, a.month - 1, a.day)) /
      MS_PER_DAY,
  );
}

/**
 * Who runs this space's session: the coordinator, or the manager covering for
 * one, through §4.2's single rule rather than a second copy of it.
 */
async function spaceCoordinator(
  tx: WorkspaceTx,
  spaceId: string,
): Promise<string | null> {
  const holders = await tx
    .select({ memberId: spaceMembers.memberId, role: spaceMembers.role })
    .from(spaceMembers)
    .where(activeOnly(spaceMembers, eq(spaceMembers.spaceId, spaceId)))
    .orderBy(asc(spaceMembers.createdAt));
  return resolveCoordinator(holders) ?? null;
}

/**
 * Every session lifecycle nudge due in this workspace (§6.4).
 *
 * Three triggers over one read: the reminder the day before, the message at the
 * scheduled hour, and the one that says nobody opened it. Which of the three,
 * or none, is `sessionLifecycleStage`'s answer.
 *
 * Every session kind, not only the weekly one. A monthly review or a quarterly
 * that nobody opened is the same lapse for the same reason, and §6.4's three
 * keys are named for the ritual rather than for its cadence.
 *
 * The recipient is the facilitator on the session row, falling back to the
 * space's coordinator where the session names none. §6.4 addresses
 * `session.due_soon` to "Coordinator + space" and `session.open` to "Space";
 * a space is not a member, and a nudge row needs one, so the person who runs
 * the ritual is who hears about it. The space-wide announcement is the digest's
 * job at P4-T08, which is the task that builds a feed to announce into.
 */
export async function dueSessionNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly now: Date;
    readonly thresholds: ResolvedThresholds;
  },
): Promise<readonly DueNudge[]> {
  const rows = await tx
    .select({
      id: okrSessions.id,
      spaceId: okrSessions.spaceId,
      scheduledFor: okrSessions.scheduledFor,
      state: okrSessions.state,
      facilitatorId: okrSessions.facilitatorId,
    })
    .from(okrSessions)
    .where(
      activeOnly(okrSessions, eq(okrSessions.workspaceId, input.workspaceId)),
    );

  const due: DueNudge[] = [];
  for (const session of rows) {
    const hours =
      (session.scheduledFor.getTime() - input.now.getTime()) / MS_PER_HOUR;
    const stage = sessionLifecycleStage(hours, session.state, input.thresholds);
    if (!stage) {
      continue;
    }
    const recipient =
      session.facilitatorId ??
      (session.spaceId ? await spaceCoordinator(tx, session.spaceId) : null);
    if (!recipient) {
      continue;
    }
    due.push(
      nudge({
        ruleKey: `session.${stage}`,
        subjectType: "session",
        subjectId: session.id,
        recipientMemberId: recipient,
        // The facilitator is the owner of their own session, so none of the
        // three is urgent to them. §6.4 escalates a missed session to the
        // sponsor, and the day it reaches somebody other than the facilitator
        // is the day `urgentFor` says yes. All three are bounded windows, so
        // the ceiling is not the thing holding them back.
        urgent: urgentFor(
          `session.${stage}`,
          recipient === session.facilitatorId,
        ),
      }),
    );
  }
  return due;
}

/**
 * Every cycle countdown nudge due in this workspace (§6.4).
 *
 * Five triggers over one read, each one a §11 parameter applied to a day count
 * in the workspace's own calendar. Dates on a cycle are local dates rather than
 * instants, which is why this compares calendar days and never subtracts
 * milliseconds: a cycle starting on the first of April starts on that date in
 * the workspace's timezone, not 24 hours after some instant.
 *
 * `cycle.phase_blocked` is not here. §6.4 fires it on "phase conditions unmet
 * as window closes", which is a question about the workflow's gate state rather
 * than about a date, and `publishGates` already answers it inside the publish
 * path (P4-T03). Firing it from a countdown would need this reader to assemble
 * a full workflow snapshot per cycle per day, and the honest place for it is the
 * Coach's own evaluation, which is P4-T06a. Recorded rather than half-built.
 */
export async function dueCycleNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly now: Date;
    readonly timeZone: string;
    readonly thresholds: ResolvedThresholds;
  },
): Promise<readonly DueNudge[]> {
  const rows = await tx
    .select({
      id: cycles.id,
      mode: cycles.mode,
      status: cycles.status,
      startsOn: cycles.startsOn,
      endsOn: cycles.endsOn,
      publicationDeadline: cycles.publicationDeadline,
      sponsorId: cycles.sponsorId,
      facilitatorId: cycles.facilitatorId,
    })
    .from(cycles)
    .where(activeOnly(cycles, eq(cycles.workspaceId, input.workspaceId)));

  const todayText = formatLocalDate(localDateIn(input.now, input.timeZone));
  const due: DueNudge[] = [];

  for (const cycle of rows) {
    const untilStart = localDaysBetween(todayText, cycle.startsOn);
    const untilEnd = localDaysBetween(todayText, cycle.endsOn);

    // Sponsor and facilitator both, where both are named. §6.4 addresses the
    // planning and deadline messages to "Sponsor + facilitator", and a cycle
    // with neither named produces no nudge rather than one to somebody who was
    // never given the job.
    const both = [cycle.sponsorId, cycle.facilitatorId].filter(
      (id): id is string => id !== null,
    );
    const uniqueBoth = [...new Set(both)];

    if (planningOpensDue(untilStart, cycle.mode, input.thresholds)) {
      for (const recipient of uniqueBoth) {
        due.push(
          nudge({
            ruleKey: "cycle.planning_opens",
            subjectType: "cycle",
            subjectId: cycle.id,
            recipientMemberId: recipient,
            urgent: urgentFor("cycle.planning_opens", false),
          }),
        );
      }
    }

    if (cycle.publicationDeadline) {
      const untilDeadline = localDaysBetween(
        todayText,
        cycle.publicationDeadline,
      );
      const milestone = publicationCountdownMilestone(
        untilDeadline,
        input.thresholds,
      );
      if (milestone !== null) {
        for (const recipient of uniqueBoth) {
          due.push(
            nudge({
              ruleKey: "cycle.deadline",
              subjectType: "cycle",
              subjectId: cycle.id,
              recipientMemberId: recipient,
              // Not urgent, even one day out. §6.4 marks the countdown as not
              // escalating, and the three milestones are three messages rather
              // than a repeating one, so the ordinary rules hold them without
              // needing a bypass. `milestone` stays read so the message can
              // name the day.
              urgent: urgentFor("cycle.deadline", false),
            }),
          );
        }
      }
    }

    // Day one, to everybody who runs the cycle. §6.4 addresses `cycle.starts`
    // to "Everyone"; as with the session, a nudge row needs a member, and the
    // workspace-wide announcement is the feed's job rather than a nudge per
    // person per cycle.
    if (cycleStartsDue(untilStart)) {
      for (const recipient of uniqueBoth) {
        due.push(
          nudge({
            ruleKey: "cycle.starts",
            subjectType: "cycle",
            subjectId: cycle.id,
            recipientMemberId: recipient,
            urgent: urgentFor("cycle.starts", false),
          }),
        );
      }
    }

    // Review preparation and the unscored close both go to the facilitator,
    // who is the person who runs the review. §6.4's `cycle.closing` widens to
    // the sponsor, and that widening is in `uniqueBoth` below it.
    if (
      cycle.facilitatorId &&
      reviewPreparationDue(untilEnd, input.thresholds)
    ) {
      due.push(
        nudge({
          ruleKey: "cycle.review_due",
          subjectType: "cycle",
          subjectId: cycle.id,
          recipientMemberId: cycle.facilitatorId,
          urgent: urgentFor("cycle.review_due", false),
        }),
      );
    }

    if (cycleClosingDue(-untilEnd, cycle.status)) {
      for (const recipient of uniqueBoth) {
        due.push(
          nudge({
            ruleKey: "cycle.closing",
            subjectType: "cycle",
            subjectId: cycle.id,
            recipientMemberId: recipient,
            // Not urgent, though it is the thing on this list that gets worse
            // by waiting. It repeats every day until somebody closes the
            // cycle, and a daily message that also bypasses the weekly ceiling
            // is unbounded noise. The ceiling is what stops an unclosed cycle
            // from drowning out everything else.
            urgent: urgentFor("cycle.closing", false),
          }),
        );
      }
    }
  }

  return due;
}
