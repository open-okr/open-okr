"use server";

/**
 * The people lifecycle: suspend, restore, convert to guest, erase (P6-G10).
 *
 * All four actions were registered at P3-T04 and had no caller anywhere in
 * `apps/web`, which is what the gap audit recorded as B-08: handling a leaver
 * meant a database session, and erasing one at a subject's request meant
 * writing a script. The domain rules are already in `packages/core`, including
 * the last-owner invariant; nothing here decides anything, it reports.
 *
 * **The refusal is passed through as written.** `refuseIfLastOwner` explains
 * what to do about it ("Give someone else full access first"), and a second
 * sentence composed here would either repeat it or contradict it.
 */

import type { ErasureExport } from "@openokr/core";
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/pool";
import { requireWorkspace } from "../../lib/workspace";
import type { LifecycleState } from "./lifecycle-state.ts";

async function actionContext() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

/**
 * Runs one lifecycle call and turns a refusal into something to read.
 *
 * An `OperationError` here is the domain saying no on purpose: the last owner,
 * a member who is not suspended, a workspace the caller does not administer.
 * Anything else is a defect and is left to the error boundary.
 */
async function lifecycle(
  memberId: string,
  done: string,
  run: (
    context: Awaited<ReturnType<typeof actionContext>>,
  ) => Promise<{ readonly export: ErasureExport | null }>,
): Promise<LifecycleState> {
  try {
    const context = await actionContext();
    const result = await run(context);
    revalidatePath(`/people/${memberId}`);
    revalidatePath("/people");
    return { kind: "done", message: done, export: result.export };
  } catch (error) {
    if (error instanceof OperationError) {
      return { kind: "refused", message: error.message };
    }
    throw error;
  }
}

export async function suspendMemberAction(
  _previous: LifecycleState,
  form: FormData,
): Promise<LifecycleState> {
  const memberId = String(form.get("memberId") ?? "");
  return lifecycle(
    memberId,
    "Suspended. Every access they held is gone until they are restored.",
    async (context) => {
      await callAction(context, "people.suspend", { memberId });
      return { export: null };
    },
  );
}

export async function restoreMemberAction(
  _previous: LifecycleState,
  form: FormData,
): Promise<LifecycleState> {
  const memberId = String(form.get("memberId") ?? "");
  return lifecycle(
    memberId,
    "Restored. The access they held before the suspension is theirs again.",
    async (context) => {
      await callAction(context, "people.restore", { memberId });
      return { export: null };
    },
  );
}

export async function convertToGuestAction(
  _previous: LifecycleState,
  form: FormData,
): Promise<LifecycleState> {
  const memberId = String(form.get("memberId") ?? "");
  return lifecycle(
    memberId,
    "Converted to a guest. Every binding they held has been removed, so " +
      "they now see only what they are invited to.",
    async (context) => {
      await callAction(context, "people.convertToGuest", { memberId });
      return { export: null };
    },
  );
}

/**
 * Erasure, which is the one that cannot be undone.
 *
 * **The name is read from the workspace, not from the form.** A hidden field
 * holding the expected name would make the whole confirmation decorative: a
 * request that sets both fields to the same string passes it. So the member is
 * read first and the typed name is compared against what the row says.
 */
export async function eraseMemberAction(
  _previous: LifecycleState,
  form: FormData,
): Promise<LifecycleState> {
  const memberId = String(form.get("memberId") ?? "");
  const typed = String(form.get("confirmName") ?? "").trim();

  let name: string;
  try {
    const context = await actionContext();
    name = (await callAction(context, "people.readMember", { memberId })).name;
  } catch (error) {
    if (error instanceof OperationError) {
      return { kind: "refused", message: error.message };
    }
    throw error;
  }

  if (typed !== name) {
    return {
      kind: "refused",
      message: `Type ${name} exactly to confirm. Nothing has been erased.`,
    };
  }

  return lifecycle(
    memberId,
    "Erased. Their personal data is gone and their history still reads " +
      "under a placeholder identity. The export below is the only copy.",
    async (context) => {
      const result = await callAction(context, "people.erase", { memberId });
      return { export: result.export };
    },
  );
}
