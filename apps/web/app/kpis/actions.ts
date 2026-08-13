"use server";

/**
 * The KPI grid's writes (S-20, P3-T12).
 *
 * One cell at a time. The period is normalised on the server from the column's
 * own period start, so a client cannot decide which bucket a value lands in.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "../cycle/write-state.ts";

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
  revalidatePath("/kpis");
  return NO_ERROR;
}

export async function recordCell(
  kpiId: string,
  periodStart: string,
  actualValue: number | null,
): Promise<WriteState> {
  if (actualValue !== null && !Number.isFinite(actualValue)) {
    return { error: "A value has to be a number, or empty to clear it." };
  }
  return run((context) =>
    callAction(context, "kpis.record", {
      kpiId,
      // The column's own period start. Normalising it again is a no-op, and it
      // is what stops a client naming a period the frequency does not have.
      on: periodStart,
      actualValue,
    }),
  );
}

export async function addKpi(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const title = String(formData.get("title") ?? "").trim();
  const frequency = String(formData.get("frequency") ?? "monthly");
  const direction = String(formData.get("direction") ?? "higher_better");
  const targetRaw = String(formData.get("targetDefault") ?? "").trim();
  if (title === "") {
    return { error: "A KPI needs a title. What is being measured?" };
  }
  const target = Number(targetRaw);
  return run((context) =>
    callAction(context, "kpis.create", {
      title,
      frequency: frequency as
        | "daily"
        | "weekly"
        | "monthly"
        | "quarterly"
        | "yearly",
      direction: direction as "higher_better" | "lower_better",
      // Every field with a schema default has to be named: callAction types on
      // the schema output, so a default is a value the caller still states.
      indicatorType: "lagging",
      tier: "output",
      aggregate: "sum",
      ownerKind: "workspace",
      ...(targetRaw !== "" && Number.isFinite(target)
        ? { targetDefault: target }
        : {}),
    }),
  );
}

export async function addCategory(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const name = String(formData.get("name") ?? "").trim();
  if (name === "") {
    return { error: "A category needs a name." };
  }
  return run((context) => callAction(context, "kpis.createCategory", { name }));
}
