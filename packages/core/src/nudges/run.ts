/**
 * One nudge run, shared by the action and by the Champion (P4-T05a, P4-T05b).
 *
 * P4-T04a put this inside the `nudges.run` action, where it was the only
 * caller. The Champion's runs are the others, and a second copy of "decide
 * what is due, decide what to suppress, write the rows" is exactly the drift
 * the suppression rules cannot survive: two callers disagreeing about whether a
 * nudge was held would produce a product that is quiet for one path and noisy
 * for the other.
 *
 * P4-T05b added the cadence. AI-NATIVE-PLAN.md §6.2 gives the Champion four,
 * and **only the readers change between them**: the suppression decision, the
 * active-member filter, the row writing and the inbox insert are one path for
 * all four, below. A cadence holding its own copy of any of that is how a
 * morning summary ends up ignoring quiet hours.
 *
 * It takes a transaction and writes on it. Both callers are Operations, so the
 * nudge rows, the inbox rows and the audit row commit together or not at all.
 */
import {
  activeOnly,
  cycles,
  notifications,
  type WorkspaceTx,
} from "@openokr/db";
import type { SuppressionReason } from "@openokr/method";
import { desc, eq, ne } from "drizzle-orm";
import { sweepStaleness } from "../cadence/service.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow, workspaceTimeZone } from "../cycles/service.ts";
import { dueQualityNudges } from "./quality.ts";
import { dueCycleNudges, dueSessionNudges } from "./rituals.ts";
import {
  activeMemberIds,
  type DueNudge,
  decideSuppression,
  dueAcknowledgementNudges,
  dueCheckInNudges,
  loadSuppressionContext,
  recordNudgesInTx,
} from "./service.ts";
import {
  dueBlockerNudges,
  dueDailyDigestNudges,
  dueKpiCorridorNudges,
} from "./sweep.ts";

/**
 * Which of §6.2's four Champion cadences this run is.
 *
 * `hourly` is the nudge queue and is the default, so every caller written
 * before P4-T05b keeps the behaviour it had. The other three each read a
 * different set of rows and none of them overlaps another: a nudge fired twice
 * by two cadences would be held by the deduplication window, but the run log
 * would still show a product that could not say which clock speaks when.
 */
export type NudgeCadence =
  | "hourly"
  | "daily"
  | "weekly"
  | "cycle"
  /**
   * The Coach's quality pass (P4-T06a).
   *
   * Not one of §6.2's four, because §6.2 is the Champion's table. §6.1 gives the
   * Coach `continuous` and the continuous half already happens: P4-T02a
   * evaluates every goal inside the transaction that writes it. This is the run
   * that turns the standing verdicts into messages, and it is separate from the
   * rhythm cadences because a quality complaint and a missed check-in are
   * different clocks with different owners.
   */
  | "quality";

export interface NudgeRunInput {
  readonly workspaceId: string;
  /** The moment the run is for. Never read from a clock in here. */
  readonly at: Date;
  /** Defaults to `hourly`, which is what P4-T04a and P4-T05a both meant. */
  readonly cadence?: NudgeCadence;
  /**
   * The agent run any proposal belongs to (P4-T05c-a).
   *
   * Absent for `nudges.run`, the hourly queue an administrator can call by
   * hand. That path is not an agent run and proposes nothing rather than
   * inventing a run row to look as though it did.
   */
  readonly runId?: string;
}

export interface NudgeRunResult {
  readonly recorded: number;
  /** Written with a reason and never sent. Noise the product chose to hold. */
  readonly suppressed: number;
  readonly ruleKeys: readonly string[];
  /**
   * Goals whose health the daily sweep flipped to `outdated`.
   *
   * Zero for every other cadence. Reported rather than counted into `recorded`
   * because flipping a goal's health is a write to the domain, not a message to
   * a person, and a run log adding the two together could not say which
   * happened.
   */
  readonly staleFlipped: number;
  /** Changes written into the review queue, pending a human. */
  readonly proposed: number;
}

/**
 * The cycle a proposed recovery objective would live in.
 *
 * The one a `planning`, `active` or `closing` cycle names, newest first. A
 * closed cycle is not somewhere to put new work, and a workspace between cycles
 * gets nothing rather than a proposal into a cycle that has ended.
 */
async function openCycleId(
  tx: WorkspaceTx,
  workspaceId: string,
): Promise<{ cycleId?: string }> {
  const [row] = await tx
    .select({ id: cycles.id })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        ne(cycles.status, "closed"),
      ),
    )
    .orderBy(desc(cycles.startsOn))
    .limit(1);
  return row ? { cycleId: row.id } : {};
}

export async function runDueNudgesInTx(
  tx: WorkspaceTx,
  input: NudgeRunInput,
): Promise<NudgeRunResult> {
  const { workspaceId, at } = input;
  const cadence = input.cadence ?? "hourly";
  const { thresholds } = resolveRhythm(await readRhythmRow(tx, workspaceId));
  const timeZone = await workspaceTimeZone(tx, workspaceId);

  let staleFlipped = 0;
  const due: DueNudge[] = [];

  if (cadence === "hourly") {
    // Two ladders with rows to run against. The third, blockers, is a pure
    // function tested beside these two and has nothing to read until P4-T07c
    // creates the table.
    due.push(
      ...(await dueCheckInNudges(tx, {
        workspaceId,
        now: at,
        timeZone,
        thresholds,
      })),
      ...(await dueAcknowledgementNudges(tx, {
        workspaceId,
        now: at,
        thresholds,
      })),
    );
  }

  if (cadence === "daily") {
    // The staleness sweep, and it is P3-T06's function rather than a second
    // one. `pnpm cadence:sweep` calls the same code, so a health flip means the
    // same thing whether a human typed the command or the agent reached it. It
    // writes on this transaction, so the flip and this run's audit row commit
    // together.
    staleFlipped = (await sweepStaleness(tx, workspaceId, thresholds, at))
      .flipped;
    due.push(
      ...(await dueBlockerNudges(tx, { workspaceId, now: at, thresholds })),
      ...(await dueKpiCorridorNudges(tx, {
        workspaceId,
        thresholds,
        // Resolved once for the run rather than per KPI. `undefined` is a real
        // answer: a workspace with no open cycle has nothing to propose a
        // recovery objective into.
        ...(await openCycleId(tx, workspaceId)),
      })),
      ...(await dueDailyDigestNudges(tx, {
        workspaceId,
        now: at,
        workspaceTimeZone: timeZone,
      })),
    );
  }

  if (cadence === "weekly") {
    due.push(
      ...(await dueSessionNudges(tx, { workspaceId, now: at, thresholds })),
    );
  }

  if (cadence === "quality") {
    due.push(...(await dueQualityNudges(tx, { workspaceId, thresholds })));
  }

  if (cadence === "cycle") {
    due.push(
      ...(await dueCycleNudges(tx, {
        workspaceId,
        now: at,
        timeZone,
        thresholds,
      })),
    );
  }

  // A suspended member is never nudged. §4.3's access getter excludes them from
  // every read, and a nudge to somebody who cannot open the product is an email
  // to a former colleague.
  const active = await activeMemberIds(tx, workspaceId);
  const deliverable = due.filter((entry) =>
    active.has(entry.recipientMemberId),
  );

  // Suppression decided before anything is written, so a swallowed nudge is a
  // row with a reason rather than an absence.
  const context = await loadSuppressionContext(tx, {
    workspaceId,
    now: at,
    workspaceTimeZone: timeZone,
  });
  const decided: {
    nudge: (typeof deliverable)[number];
    suppressedReason: SuppressionReason | null;
  }[] = [];
  for (const nudge of deliverable) {
    decided.push({
      nudge,
      suppressedReason: await decideSuppression(tx, {
        workspaceId,
        nudge,
        now: at,
        context,
        thresholds,
      }),
    });
  }

  const ids = await recordNudgesInTx(tx, {
    workspaceId,
    due: decided,
    at,
    ...(input.runId ? { runId: input.runId } : {}),
  });

  // The in-app inbox, one row per nudge that was actually sent, linked by the
  // `nudge_id` the notifications table has carried since 0013. A suppressed
  // nudge gets no inbox row: the point of suppressing it was that nobody sees
  // it.
  for (const [index, written] of ids.entries()) {
    if (!written.sent) {
      continue;
    }
    const entry = decided[index]?.nudge;
    if (!entry) {
      continue;
    }
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx.insert(notifications).values({
      workspaceId,
      recipientMemberId: entry.recipientMemberId,
      nudgeId: written.id,
      // The notifications table's reason list predates the four cadences, and
      // every nudge on any of them is a reminder about something the recipient
      // owes. One reason across all four keeps the inbox honest about what it
      // is: a list of obligations, not a taxonomy of clocks. The rule key on
      // the nudge row is what says which trigger fired.
      reason: "check_in",
      channel: entry.channel,
      sentAt: at,
    });
  }

  const sent = ids.filter((written) => written.sent).length;
  return {
    recorded: sent,
    suppressed: ids.length - sent,
    staleFlipped,
    // Distinct rows, not linked nudges: two nudges pointing at one already
    // pending proposal proposed nothing new, and counting them twice would
    // report activity the run did not cause.
    proposed: new Set(ids.map((written) => written.proposalId).filter(Boolean))
      .size,
    ruleKeys: [
      ...new Set(
        decided
          .filter((entry) => entry.suppressedReason === null)
          .map((entry) => entry.nudge.ruleKey),
      ),
    ],
  };
}
