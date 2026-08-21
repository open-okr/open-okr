"use server";

import { callAction } from "@openokr/core";
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
