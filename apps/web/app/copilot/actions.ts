"use server";

/**
 * What the copilot panel reads (screen S-39, P4-T14a-b).
 *
 * Reads only. The two writes a conversation makes, `copilot.ask` and
 * `copilot.recordAnswer`, both happen inside the streaming route, because the
 * question and the answer belong to the same request the reader can stop.
 *
 * Every one of these resolves the caller from the session cookie and goes
 * through `callAction`, so the panel cannot reach a thread that is not the
 * reader's: the actions answer not-found for somebody else's.
 */
import { callAction } from "@openokr/core";
import { getPool } from "../../lib/auth";
import { drafterFor } from "../../lib/drafter";
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
  const drafter = await drafterFor(base.workspaceId);
  return callAction(
    drafter ? { ...base, drafter } : base,
    "copilot.availability",
    {},
  );
}
