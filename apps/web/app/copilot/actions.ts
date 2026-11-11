"use server";

/**
 * What the copilot panel reads (screen S-39, P4-T14a-b).
 *
 * The conversation's own two writes, `copilot.ask` and `copilot.recordAnswer`,
 * are not here: they happen inside the streaming route, because the question and
 * the answer belong to the same request the reader can stop. What is here is
 * every read the panel makes, plus the proposal decisions, which are ordinary
 * writes with nothing to stream (P4-T14b-a). Asking for a proposal is not here
 * either since plan 0.8.1 A2: it happens in the answer's own run, before the
 * answer, so the answer knows whether a card was made.
 *
 * Every one of these resolves the caller from the session cookie and goes
 * through `callAction`, so the panel cannot reach a thread that is not the
 * reader's: the actions answer not-found for somebody else's.
 */
import { callAction } from "@openokr/core";
import { getPool } from "../../lib/auth";
import { resolveDrafterFor } from "../../lib/drafter";
import { requireWorkspace } from "../../lib/workspace";

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

/** The reader's own conversations, most recently used first. */
export async function listCopilotThreadsAction() {
  return callAction(await context(), "copilot.threads", { limit: 20 });
}

/** One conversation, with the citations this reader may see right now. */
export async function readCopilotThreadAction(threadId: string) {
  return callAction(await context(), "copilot.thread", { threadId });
}

/**
 * Whether the copilot can answer, and why not when it cannot.
 *
 * Re-read when the panel opens rather than only rendered once by the server, so
 * a workspace that spends its budget while a tab is open stops offering an
 * answer it can no longer give.
 *
 * The drafter has to be on the context. Without it the read cannot tell a
 * provider-off workspace from one whose provider simply was not passed to this
 * call, and it would report AI off for a workspace that has a key.
 */
export async function copilotAvailabilityAction() {
  const base = await context();
  // With the reason when there is no drafter (plan 0.8.0 O1), so a cloud
  // workspace with no plan is told to choose one rather than that no provider
  // is configured.
  const outcome = await resolveDrafterFor(
    base.workspaceId,
    "balanced",
    base.actor.userId,
    { source: "copilot" },
  );
  return callAction(
    "drafter" in outcome
      ? { ...base, drafter: outcome.drafter }
      : { ...base, aiOff: outcome.off },
    "copilot.availability",
    {},
  );
}

/** The proposals in one of the reader's own conversations. */
export async function listCopilotProposalsAction(threadId: string) {
  return callAction(await context(), "copilot.proposals", { threadId });
}

/** Applies one, as the reader. The proposed action's own access decides. */
export async function applyCopilotProposalAction(id: string) {
  return callAction(await context(), "copilot.applyProposal", { id });
}

export async function dismissCopilotProposalAction(id: string) {
  return callAction(await context(), "copilot.dismissProposal", { id });
}

/** Reverses an applied one, where the action it applied has a reverse. */
export async function undoCopilotProposalAction(id: string) {
  return callAction(await context(), "copilot.undoProposal", { id });
}
