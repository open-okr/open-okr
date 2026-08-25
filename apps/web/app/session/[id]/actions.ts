"use server";

import { callAction, richTextFromPlainText } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";

export async function openSessionAction(sessionId: string) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.open",
    { id: sessionId },
  );
  revalidatePath(`/session/${sessionId}`);
}

export async function advanceStageAction(sessionId: string) {
  const { session, workspace } = await requireWorkspace();
  const result = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.advanceStage",
    { id: sessionId },
  );
  // The action returns the realtime channel name so the route handler (SSE)
  // can publish the event. In a server action context, publishing is handled
  // by the SSE clients polling — revalidatePath triggers re-fetch for the
  // current client, and the SSE stream notifies other connected clients.
  //
  // Full realtime publish wiring (calling adapters.realtime.publish here)
  // is deferred: server actions run in the same process as the app, so once
  // a relay host exists this becomes the call site.
  void (result as { realtimeChannel: string }).realtimeChannel;
  revalidatePath(`/session/${sessionId}`);
}

export async function skipSessionAction(sessionId: string) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.skip",
    { id: sessionId },
  );
  revalidatePath(`/session/${sessionId}`);
}

export async function castVoteAction(
  sessionId: string,
  keyResultId: string,
  confidence: number,
) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.castVote",
    { sessionId, keyResultId, confidence },
  );
  revalidatePath(`/session/${sessionId}`);
}

export async function revealVotesAction(
  sessionId: string,
  keyResultId: string,
) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.revealVotes",
    { sessionId, keyResultId },
  );
  revalidatePath(`/session/${sessionId}`);
}

export async function confirmConfidenceAction(
  sessionId: string,
  keyResultId: string,
  confidence: number,
  whatChanged: string,
) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.confirmConfidence",
    { sessionId, keyResultId, confidence, whatChanged },
  );
  revalidatePath(`/session/${sessionId}`);
}

export async function closeSessionAction(sessionId: string) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.close",
    { id: sessionId },
  );
  revalidatePath(`/session/${sessionId}`);
}

/**
 * The monthly review's three writes (METHOD.md §7.5, P4-T09).
 *
 * Each one is a small form on a screen that is filled in as the meeting runs,
 * so each revalidates the session page and nothing else. A decision also moves
 * the goal page and the cycle workspace, which is where somebody looks for it
 * a month later.
 */
export async function setTrendAction(
  sessionId: string,
  goalId: string,
  trend: "improving" | "flat" | "declining",
) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.setTrend",
    { sessionId, goalId, trend },
  );
  revalidatePath(`/session/${sessionId}`);
}

export async function setShiftsAction(sessionId: string, shifts: string) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.setShifts",
    { sessionId, shifts },
  );
  revalidatePath(`/session/${sessionId}`);
}

export async function recordDecisionAction(
  sessionId: string,
  input: { goalId?: string; keyResultId?: string; text: string },
) {
  const { session, workspace } = await requireWorkspace();
  const { goalId } = (await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.recordDecision",
    { sessionId, ...input },
  )) as { goalId: string };
  revalidatePath(`/session/${sessionId}`);
  // §7.5 calls the decision log the artifact that survives the meeting, and
  // these are the two places it survives to.
  //
  // The goal's concrete path rather than the `/goals/[id]` route pattern. The
  // pattern form depends on matching Next's own route key, and the action
  // returns the goal precisely so this does not have to rely on that.
  revalidatePath(`/goals/${goalId}`);
  revalidatePath("/cycle");
}

/**
 * The quarterly review's pacing (METHOD.md §8.1, P4-T10a-a).
 *
 * Both are the facilitator's, and the actions refuse anybody else rather than
 * relying on the screen to hide the controls.
 */
export async function addMinuteAction(sessionId: string) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.addMinute",
    { id: sessionId },
  );
  revalidatePath(`/session/${sessionId}`);
}

export async function setStageNoteAction(sessionId: string, note: string) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.setStageNote",
    { id: sessionId, note },
  );
  revalidatePath(`/session/${sessionId}`);
}

/**
 * One participant's pulse and word (METHOD.md §8.2, P4-T10a-b).
 *
 * Everybody may give one. Nobody but the facilitator gets the room's read, and
 * `sessions.roomPulse` is what decides that rather than the screen.
 */
export async function givePulseAction(
  sessionId: string,
  pulse: number,
  word: string,
) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.givePulse",
    { sessionId, pulse, word },
  );
  revalidatePath(`/session/${sessionId}`);
}

/**
 * One key result's grade (METHOD.md §8.3, P4-T10b-a).
 *
 * The room grades together, so this is not the facilitator's alone. It lands on
 * `key_results.score` when the review closes and not before.
 */
export async function scoreKeyResultAction(
  sessionId: string,
  keyResultId: string,
  score: number,
  reason: string,
) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.scoreKeyResult",
    { sessionId, keyResultId, score, reason },
  );
  revalidatePath(`/session/${sessionId}`);
}

/**
 * The mic, handed on or put down (METHOD.md §8.1 stage 3, P4-T10c).
 *
 * The facilitator's control, and `sessions.passMic` is what refuses anybody
 * else. Null puts it down, which is also what marks the last owner spoken for.
 */
export async function passMicAction(sessionId: string, goalId: string | null) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.passMic",
    { sessionId, goalId },
  );
  revalidatePath(`/session/${sessionId}`);
}

/**
 * What the number does not show, for one objective (METHOD.md §8.1 stage 3,
 * P4-T10c).
 *
 * Collected as plain text and stored as editor JSON through the one shared rich
 * text module, the same path the check-in composer uses. An empty line clears the
 * note, which is a real act and does not undo that the objective was spoken for.
 */
export async function setNarrativeAction(
  sessionId: string,
  goalId: string,
  text: string,
) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.setNarrative",
    {
      sessionId,
      goalId,
      body: text.trim().length === 0 ? null : richTextFromPlainText(text),
    },
  );
  revalidatePath(`/session/${sessionId}`);
}

/**
 * Naming somebody's effort (METHOD.md §8.1 stage 4, P4-T10c).
 *
 * Anybody in the room, not the facilitator alone: §8.1 asks the room to name
 * what it saw.
 */
export async function giveKudosAction(
  sessionId: string,
  toMemberId: string,
  text: string,
) {
  const { session, workspace } = await requireWorkspace();
  await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.giveKudos",
    { sessionId, toMemberId, text },
  );
  revalidatePath(`/session/${sessionId}`);
}

/**
 * One objective's score, put out to the room (METHOD.md §8.3, P4-T10b-b).
 *
 * The facilitator's call, and `sessions.revealObjectiveScore` is what refuses
 * anybody else rather than the screen. The action returns the realtime channel
 * for the same reason `sessions.advanceStage` does, and it goes unused here for
 * the same reason: the push is an outbox row and no relay drains it yet, so this
 * client re-reads through `revalidatePath` and the others re-read when the rail
 * is live.
 */
export async function revealObjectiveScoreAction(
  sessionId: string,
  goalId: string,
) {
  const { session, workspace } = await requireWorkspace();
  const result = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.revealObjectiveScore",
    { sessionId, goalId },
  );
  void (result as { realtimeChannel: string }).realtimeChannel;
  revalidatePath(`/session/${sessionId}`);
}
