/**
 * One nudge run, shared by the action and by the Champion (P4-T05a).
 *
 * P4-T04a put this inside the `nudges.run` action, where it was the only
 * caller. The Champion's hourly run is the second, and a second copy of "decide
 * what is due, decide what to suppress, write the rows" is exactly the drift
 * the suppression rules cannot survive: two callers disagreeing about whether a
 * nudge was held would produce a product that is quiet for one path and noisy
 * for the other.
 *
 * It takes a transaction and writes on it. Both callers are Operations, so the
 * nudge rows, the inbox rows and the audit row commit together or not at all.
 */
import { notifications, type WorkspaceTx } from "@openokr/db";
import type { SuppressionReason } from "@openokr/method";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow, workspaceTimeZone } from "../cycles/service.ts";
import {
  activeMemberIds,
  decideSuppression,
  dueAcknowledgementNudges,
  dueCheckInNudges,
  loadSuppressionContext,
  recordNudgesInTx,
} from "./service.ts";

export interface NudgeRunInput {
  readonly workspaceId: string;
  /** The moment the run is for. Never read from a clock in here. */
  readonly at: Date;
}

export interface NudgeRunResult {
  readonly recorded: number;
  /** Written with a reason and never sent. Noise the product chose to hold. */
  readonly suppressed: number;
  readonly ruleKeys: readonly string[];
}

export async function runDueNudgesInTx(
  tx: WorkspaceTx,
  input: NudgeRunInput,
): Promise<NudgeRunResult> {
  const { workspaceId, at } = input;
  const { thresholds } = resolveRhythm(await readRhythmRow(tx, workspaceId));
  const timeZone = await workspaceTimeZone(tx, workspaceId);

  // Two ladders with rows to run against. The third, blockers, is a pure
  // function tested beside these two and has nothing to read until P4-T07c
  // creates the table.
  const due = [
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
  ];

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
      reason: "check_in",
      channel: entry.channel,
      sentAt: at,
    });
  }

  const sent = ids.filter((written) => written.sent).length;
  return {
    recorded: sent,
    suppressed: ids.length - sent,
    ruleKeys: [
      ...new Set(
        decided
          .filter((entry) => entry.suppressedReason === null)
          .map((entry) => entry.nudge.ruleKey),
      ),
    ],
  };
}
