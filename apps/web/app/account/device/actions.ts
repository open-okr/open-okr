"use server";

import { callAction } from "@openokr/core";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";
import type { DecisionResult } from "./decision-state.ts";

/**
 * Approving or denying a terminal (P5-T07c-b).
 *
 * The form carries the code and one bit. It carries no scopes, because the
 * request already says what was asked for and a form field for it would be a
 * path by which a grant could become wider than the request.
 */
export async function decide(
  _previous: DecisionResult | null,
  form: FormData,
): Promise<DecisionResult> {
  const userCode = String(form.get("userCode") ?? "").trim();
  const approve = String(form.get("approve") ?? "") === "yes";

  const { session, workspace } = await requireWorkspace();
  try {
    const answer = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "tokens.approveDevice",
      { userCode, approve },
    );
    // **Deliberately no revalidation.** Answering the request is the last thing
    // this page does, and re-reading it would find nothing pending, replace the
    // card the form lives in, and unmount the form along with the only
    // confirmation the flow has. The terminal is what acts on the decision, and
    // it is already polling.
    return {
      ok: true,
      decided: true,
      approved: answer.approved,
      message: answer.approved
        ? `${answer.clientName} can now act as you. Its token is being handed to it now.`
        : `${answer.clientName} was refused.`,
    };
  } catch (error) {
    return {
      ok: false,
      decided: false,
      approved: false,
      message:
        error instanceof Error
          ? error.message
          : "That code could not be answered.",
    };
  }
}
