"use server";

/**
 * The cycle workspace's writes, each one a call into the action registry
 * (P3-T03).
 *
 * Nothing here decides anything. The registry declares the access level, the
 * Operation pipeline writes the activity, audit and outbox rows, and
 * `withGateRecompute` refreshes the six gates. This file's whole job is turning
 * a form submission into one of those calls and then revalidating the page.
 *
 * A refusal is a normal outcome, not a crash: an `OperationError` becomes a
 * message the screen shows back, which is why each of these returns a state
 * object rather than throwing into the error boundary.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "./write-state.ts";

async function run(
  fn: (context: {
    pool: ReturnType<typeof getPool>;
    workspaceId: string;
    actor: { kind: "human"; userId: string };
  }) => Promise<unknown>,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  try {
    await fn({
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/cycle");
  return NO_ERROR;
}

export async function togglePackItem(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const cycleId = String(formData.get("cycleId") ?? "");
  const itemKey = Number(formData.get("itemKey") ?? 0);
  // The checkbox reports its current state, so the write is its opposite. A
  // checkbox that posted "true" whatever it showed would make the second click
  // a no-op.
  const gathered = formData.get("gathered") !== "true";
  return run((context) =>
    callAction(context, "workflow.setPackItem", {
      cycleId,
      itemKey,
      gathered,
    }),
  );
}

export async function savePackNote(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const cycleId = String(formData.get("cycleId") ?? "");
  const itemKey = Number(formData.get("itemKey") ?? 0);
  const note = String(formData.get("note") ?? "").trim();
  const gathered = formData.get("gathered") === "true";
  return run((context) =>
    callAction(context, "workflow.setPackItem", {
      cycleId,
      itemKey,
      gathered,
      note: note === "" ? null : note,
    }),
  );
}

export async function distributePack(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const cycleId = String(formData.get("cycleId") ?? "");
  return run((context) =>
    callAction(context, "workflow.distributePack", { cycleId }),
  );
}

export async function addIssue(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const cycleId = String(formData.get("cycleId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  const impact = Number(formData.get("impact") ?? 3);
  if (text === "") {
    return { error: "An issue needs a sentence saying what it is." };
  }
  return run((context) =>
    callAction(context, "workflow.addIssue", {
      cycleId,
      text,
      impact,
      source: "manual",
    }),
  );
}

export async function rankIssue(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const cycleId = String(formData.get("cycleId") ?? "");
  const issueId = String(formData.get("issueId") ?? "");
  const impact = Number(formData.get("impact") ?? 3);
  return run((context) =>
    callAction(context, "workflow.setIssueImpact", {
      cycleId,
      issueId,
      impact,
    }),
  );
}

export async function addPriority(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const cycleId = String(formData.get("cycleId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  const successStatement = String(
    formData.get("successStatement") ?? "",
  ).trim();
  const fromIssueId = String(formData.get("fromIssueId") ?? "");
  if (text === "") {
    return { error: "A priority needs a sentence saying what it is." };
  }
  return run((context) =>
    callAction(context, "workflow.addPriority", {
      cycleId,
      text,
      successStatement: successStatement === "" ? null : successStatement,
      ...(fromIssueId === "" ? {} : { fromIssueId }),
    }),
  );
}

export async function publishCycle(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const cycleId = String(formData.get("cycleId") ?? "");
  // The override arrives only from the form that asks for a reason. Absent
  // means a plain publish, and the action refuses a red gate on its own; this
  // never decides whether the gates are met.
  const reason = String(formData.get("override.reason") ?? "").trim();
  return run((context) =>
    callAction(context, "workflow.publish", {
      cycleId,
      ...(reason === "" ? {} : { override: { reason } }),
    }),
  );
}

/**
 * The §5.4 dependency register (P6-G17).
 *
 * Publish gate 4 is "every dependency is confirmed, or logged with a named risk
 * owner", and until now no control anywhere could do either: all four writes
 * were registered actions with no caller, and the gate's own remediation link
 * pointed at the page it was already on. A cycle carrying one dependency could
 * not be published from the browser at all.
 */
export async function addDependency(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const keyResultId = String(formData.get("keyResultId") ?? "");
  const providerSpaceId = String(formData.get("providerSpaceId") ?? "");
  const providerText = String(formData.get("providerText") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  // The action refuses a register entry with no provider, and says why. The
  // form asks for one of the two rather than both, so this passes on whichever
  // was filled and lets the action be the one place that decides.
  return run((context) =>
    callAction(context, "goals.addKeyResultDependency", {
      keyResultId,
      ...(providerSpaceId ? { providerSpaceId } : {}),
      ...(providerText ? { providerText } : {}),
      ...(note ? { note } : {}),
    }),
  );
}

export async function confirmDependency(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  return run((context) =>
    callAction(context, "goals.confirmDependency", { id }),
  );
}

export async function setDependencyRiskOwner(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  // An empty choice means "nobody", which is a real answer: naming a risk owner and
  // then taking the name away is how a register entry goes back to needing a
  // confirmation.
  return run((context) =>
    callAction(context, "goals.setDependencyRiskOwner", {
      id,
      memberId: memberId === "" ? null : memberId,
    }),
  );
}

export async function removeDependency(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  return run((context) =>
    callAction(context, "goals.removeKeyResultDependency", { id }),
  );
}
