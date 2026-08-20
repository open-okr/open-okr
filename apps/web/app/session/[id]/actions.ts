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
