/**
 * The Champion opens and skips weekly sessions, as proposals (plan 0.7.0 A13).
 *
 * `docs/design/sessions.md` §2.1: "The Champion opens and closes by default. A
 * coordinator can override", and "scheduled -> skipped (when the Champion marks
 * it missed)". Akmal approved this on 9 November 2026 **as proposals into the
 * review queue**: the Champion never moves a session itself. It attaches the
 * change to the message it already sends, and the person that message reaches
 * applies or dismisses it in the review inbox.
 *
 * | Message (§6.4, unchanged) | Window (`sessionLifecycleStage`) | Proposal |
 * |---|---|---|
 * | `session.open` | The scheduled start to a day after it, still `scheduled` | `sessions.open` |
 * | `session.missed` | The day after that, still `scheduled` | `sessions.skip` |
 *
 * **No new message and no new threshold.** Both windows are the ones the
 * lifecycle messages have fired on since P4-T05b, read from `packages/method`.
 * What this adds is the change the message offers.
 *
 * **Closing is not proposed.** A session left running has no message in the
 * §6.4 catalogue to carry a proposal, and adding one is a new proactive message
 * kind, which CLAUDE.md keeps for a human. Recorded in sessions.md §2.1.
 *
 * **Weekly sessions only.** §2.1 is the weekly session's state machine. A
 * monthly or quarterly review keeps its messages and is the facilitator's to
 * open, and a skipped review is not a decision the Champion offers.
 */
import { proposedChanges, type WorkspaceTx } from "@openokr/db";
import type { SessionLifecycleStage } from "@openokr/method";
import { and, eq, inArray, ne } from "drizzle-orm";

/** The two actions the Champion proposes on a session, as registry keys. */
export const OPEN_SESSION_ACTION = "sessions.open";
export const SKIP_SESSION_ACTION = "sessions.skip";
/** Carried by `session.left_open` (plan 0.7.0 A13, approved 9 November). */
export const CLOSE_SESSION_ACTION = "sessions.close";

const LIFECYCLE_ACTIONS = [
  OPEN_SESSION_ACTION,
  SKIP_SESSION_ACTION,
  CLOSE_SESSION_ACTION,
];

/**
 * The change a lifecycle message offers, or null.
 *
 * The day before is a reminder and offers nothing: opening a session before
 * its time is not what the room booked.
 */
export function sessionProposalFor(
  stage: SessionLifecycleStage,
  kind: string,
):
  | typeof OPEN_SESSION_ACTION
  | typeof SKIP_SESSION_ACTION
  | typeof CLOSE_SESSION_ACTION
  | null {
  if (kind !== "weekly") {
    return null;
  }
  if (stage === "open") {
    return OPEN_SESSION_ACTION;
  }
  if (stage === "missed") {
    return SKIP_SESSION_ACTION;
  }
  if (stage === "left_open") {
    return CLOSE_SESSION_ACTION;
  }
  return null;
}

/** The key `decidedSessionProposalsInTx` answers in. */
export const sessionProposalKey = (action: string, sessionId: string) =>
  `${action} ${sessionId}`;

/**
 * Every session proposal somebody already decided, by action and session.
 *
 * **A decision about a session's step is not asked again.** The lifecycle
 * windows are a day wide and the Champion's weekly cadence reads them every
 * hour, while the proposal path only refuses a second *pending* proposal. So a
 * facilitator who dismissed "open the session" at ten would be asked again at
 * eleven. A session leaves `scheduled` once, so one proposal per session per
 * action, whatever became of it, is the honest count.
 */
export async function decidedSessionProposalsInTx(
  tx: WorkspaceTx,
  workspaceId: string,
  sessionIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (sessionIds.length === 0) {
    return new Set();
  }
  const rows = await tx
    .select({
      action: proposedChanges.action,
      subjectId: proposedChanges.subjectId,
    })
    .from(proposedChanges)
    .where(
      // No `activeOnly`: `proposed_changes` carries no `deleted_at`.
      and(
        eq(proposedChanges.workspaceId, workspaceId),
        eq(proposedChanges.subjectType, "session"),
        inArray(proposedChanges.subjectId, [...sessionIds]),
        inArray(proposedChanges.action, LIFECYCLE_ACTIONS),
        ne(proposedChanges.status, "pending"),
      ),
    );
  return new Set(
    rows.map((row) => sessionProposalKey(row.action, row.subjectId ?? "")),
  );
}

/**
 * Settles the Champion's pending proposals on a session that just left
 * `scheduled`, as dismissed by whoever moved it.
 *
 * Opened or skipped, by hand or by applying one of them, the other is moot:
 * leaving it in the inbox would ask for a decision already made. The same
 * settling `kpis.recordResponse` does for a recovery answered another way.
 *
 * `applying` is the proposal this call applies, when it does. It is left
 * alone: `proposals.apply` marks it applied itself, and holds a lock on its row
 * until then, so touching it here would wait on that lock forever.
 */
export async function settleSessionProposalsInTx(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly sessionId: string;
    readonly memberId: string;
    readonly applying?: string;
  },
): Promise<readonly string[]> {
  // openokr:allow-mutation: the calling Operation's own transaction, so the
  // session's new state and the settled proposals commit together.
  const settled = await tx
    .update(proposedChanges)
    .set({
      status: "dismissed",
      decidedByMemberId: input.memberId,
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(proposedChanges.workspaceId, input.workspaceId),
        eq(proposedChanges.status, "pending"),
        eq(proposedChanges.subjectType, "session"),
        eq(proposedChanges.subjectId, input.sessionId),
        inArray(proposedChanges.action, LIFECYCLE_ACTIONS),
        ...(input.applying ? [ne(proposedChanges.id, input.applying)] : []),
      ),
    )
    .returning({ id: proposedChanges.id });
  return settled.map((row) => row.id);
}
