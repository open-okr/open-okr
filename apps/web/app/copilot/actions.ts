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
import {
  type AIOffReason,
  callAction,
  hasPlanScreen,
  navigationFor,
  reportError,
} from "@openokr/core";
import { resolveAccessLevelFor } from "../../lib/access";
import { getPool } from "../../lib/auth";
import { resolveDrafterFor } from "../../lib/drafter";
import { requireWorkspace } from "../../lib/workspace";
import { type CopilotFix, copilotFixes } from "./fixes";

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

/** What the panel needs to know before it offers a box to type in. */
export interface CopilotAvailability {
  readonly available: boolean;
  readonly providerConfigured: boolean;
  readonly reason: string | null;
  readonly searchAvailable: boolean;
  readonly streaming: boolean;
  /** When a crossed budget lifts by itself, as an ISO time. */
  readonly resetsAt: string | null;
  /** The pages this reader may open that would turn the copilot back on. */
  readonly fixes: readonly CopilotFix[];
}

/**
 * What the panel says when the read itself failed (plan 0.8.1 CP8, review
 * F14): the copilot cannot answer right now, and the page renders.
 */
const UNKNOWN: CopilotAvailability = {
  available: false,
  providerConfigured: true,
  reason: null,
  searchAvailable: false,
  streaming: false,
  resetsAt: null,
  fixes: [],
};

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
 *
 * **It never throws past the session check** (plan 0.8.1 CP8, review F14). The
 * shell awaits this on every page, and an AI key sealed by a root key this
 * process does not hold took every page down with it. A failure here is the
 * copilot being unavailable, which is reported and said, never the page.
 */
export async function copilotAvailabilityAction(): Promise<CopilotAvailability> {
  const { session, workspace } = await requireWorkspace();
  const base = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  try {
    // With the reason when there is no drafter (plan 0.8.0 O1), so a cloud
    // workspace with no plan is told to choose one rather than that no
    // provider is configured.
    const outcome = await resolveDrafterFor(
      base.workspaceId,
      "balanced",
      base.actor.userId,
      { source: "copilot" },
    );
    const offReason: AIOffReason | null =
      "drafter" in outcome ? null : outcome.off;
    const availability = await callAction(
      "drafter" in outcome
        ? { ...base, drafter: outcome.drafter }
        : { ...base, aiOff: outcome.off },
      "copilot.availability",
      {},
    );
    return {
      ...availability,
      fixes: availability.available
        ? []
        : await fixesFor(base, workspace.memberId, offReason),
    };
  } catch (error) {
    reportError(error, {
      source: "request",
      action: "copilot.availability",
      workspaceId: base.workspaceId,
      userId: base.actor.userId,
    });
    return UNKNOWN;
  }
}

/** The facts `copilotFixes` decides on, read only when the copilot is off. */
async function fixesFor(
  base: {
    readonly pool: ReturnType<typeof getPool>;
    readonly workspaceId: string;
    readonly actor: { readonly kind: "human"; readonly userId: string };
  },
  memberId: string,
  offReason: AIOffReason | null,
): Promise<readonly CopilotFix[]> {
  const level = await resolveAccessLevelFor(base.workspaceId, memberId);
  // The registry's own entries, so a link is offered exactly where the
  // sidebar and the route guard would let the reader through.
  const admin = navigationFor("admin", level);
  const reachesPlan =
    admin.some((item) => item.href === "/admin/plan") &&
    (await hasPlanScreen(base.pool));
  const personalKeysOffered =
    offReason === "no_provider"
      ? (await callAction(base, "ai.readOwnCredentialStatus", {})).length > 0
      : false;
  return copilotFixes({
    available: false,
    offReason,
    reachesAiSettings: admin.some((item) => item.href === "/admin/ai"),
    reachesPlan,
    personalKeysOffered,
  });
}

/**
 * Stops a background run, keeping what it has written (plan 0.8.1 W4).
 *
 * The panel calls this before it cancels its request: cancelling alone only
 * stops listening, and the run would carry on and land the whole answer.
 */
export async function stopCopilotRunAction(answerMessageId: string) {
  return callAction(await context(), "copilot.stopRun", { answerMessageId });
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
