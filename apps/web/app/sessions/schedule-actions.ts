"use server";

/**
 * Scheduling sessions from the browser (completeness review H-08).
 *
 * **Nothing in the interface could create a session.** `sessions.create`
 * shipped at P4-T07a and its only callers were the onboarding template and the
 * demo builder, so after week one nobody could hold a check-in, a monthly
 * review or a quarterly review, and METHOD.md §7.1's "book all of them for the
 * whole cycle" had no button. The coverage test excused it with an action that
 * did not exist.
 *
 * Refusals come back as sentences, the shape every other screen uses.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/pool";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { NO_SCHEDULE, type ScheduleState } from "./schedule-state.ts";

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

const text = (formData: FormData, name: string): string =>
  String(formData.get(name) ?? "").trim();

function refused(error: unknown): ScheduleState {
  if (error instanceof OperationError) {
    return { ...NO_SCHEDULE, error: error.message };
  }
  throw error;
}

function revalidate(): void {
  // The session list, the space home and the cycle's phase 6 all read these.
  revalidatePath("/", "layout");
}

export async function bookCycleAction(
  _previous: ScheduleState,
  formData: FormData,
): Promise<ScheduleState> {
  const { t } = await getTranslations();
  const cycleId = text(formData, "cycleId");
  let result: { booked: number; missing: string[] };
  try {
    result = await callAction(await context(), "sessions.bookCycle", {
      spaceId: text(formData, "spaceId"),
      ...(cycleId ? { cycleId } : {}),
      weekday: Number(text(formData, "weekday")),
      time: text(formData, "time"),
      facilitatorId: text(formData, "facilitatorId"),
    });
  } catch (error) {
    return refused(error);
  }
  revalidate();
  return {
    error: null,
    notice:
      result.booked === 0
        ? t("sessions.schedule.alreadyBooked")
        : t("sessions.schedule.booked", { count: result.booked }),
    details: result.missing,
  };
}

const KIND_NAMES = {
  weekly: "sessions.schedule.kind.weekly",
  monthly: "sessions.schedule.kind.monthly",
  quarterly: "sessions.schedule.kind.quarterly",
  planning: "sessions.schedule.kind.planning",
} as const;

export async function scheduleSessionAction(
  _previous: ScheduleState,
  formData: FormData,
): Promise<ScheduleState> {
  const { t } = await getTranslations();
  const kind = text(formData, "kind") as keyof typeof KIND_NAMES;
  const cycleId = text(formData, "cycleId");
  try {
    await callAction(await context(), "sessions.create", {
      spaceId: text(formData, "spaceId"),
      ...(cycleId ? { cycleId } : {}),
      kind,
      title:
        text(formData, "title") ||
        (KIND_NAMES[kind] ? t(KIND_NAMES[kind]) : kind),
      scheduledFor: text(formData, "scheduledFor"),
      facilitatorId: text(formData, "facilitatorId"),
    });
  } catch (error) {
    return refused(error);
  }
  revalidate();
  return { error: null, notice: t("sessions.schedule.scheduled"), details: [] };
}
