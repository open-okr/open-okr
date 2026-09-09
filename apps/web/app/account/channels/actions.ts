"use server";

import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";
import type { LinkResult } from "./link-state.ts";

/**
 * A member's own channel writes (P5-T02c).
 *
 * All three are `comment` level in the registry, which the registry invariant
 * test names as an exception with its reason: these touch one row that is about
 * the member and nobody else, and each resolves the member from the session
 * rather than from an input, so there is no identifier a caller could pass to
 * reach somebody else.
 */
async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

/**
 * Issues a linking code.
 *
 * The code comes back once and is shown once. It is stored hashed, so this
 * response is the only place it exists: a member who loses it asks for another,
 * which replaces the first.
 */
export async function startLink(
  _previous: LinkResult | null,
  form: FormData,
): Promise<LinkResult> {
  const provider = String(form.get("provider") ?? "");
  try {
    const issued = await callAction(await context(), "channels.startLink", {
      provider: provider as "slack" | "teams" | "whatsapp" | "telegram",
    });
    revalidatePath("/account/channels");
    return {
      ok: true,
      code: issued.code,
      message: `Send this to the OpenOKR bot on ${provider} within ten minutes.`,
    };
  } catch (error) {
    return {
      ok: false,
      code: null,
      message: error instanceof Error ? error.message : "That did not work.",
    };
  }
}

export async function unlink(
  _previous: LinkResult | null,
  form: FormData,
): Promise<LinkResult> {
  const provider = String(form.get("provider") ?? "");
  try {
    await callAction(await context(), "channels.unlinkIdentity", {
      provider: provider as "slack" | "teams" | "whatsapp" | "telegram",
    });
  } catch (error) {
    return {
      ok: false,
      code: null,
      message: error instanceof Error ? error.message : "That did not work.",
    };
  }
  revalidatePath("/account/channels");
  return { ok: true, code: null, message: `${provider} is unlinked.` };
}

/**
 * Where messages go, and when not to send them.
 *
 * A blank window clears it rather than storing two equal times, which
 * `insideQuietHours` treats as no window anyway: somebody who typed the same
 * time twice meant to switch it off.
 */
export async function saveDelivery(
  _previous: LinkResult | null,
  form: FormData,
): Promise<LinkResult> {
  const primaryChannel = String(form.get("primaryChannel") ?? "");
  const start = String(form.get("quietStart") ?? "").trim();
  const end = String(form.get("quietEnd") ?? "").trim();

  try {
    // Only what the form actually submitted. A disabled radio sends nothing,
    // so a member whose stored primary channel has become unreachable would
    // otherwise post an empty string, the enum would refuse it, and their
    // quiet hours would silently fail to save with them.
    await callAction(await context(), "people.updateOwnProfile", {
      ...(primaryChannel
        ? {
            primaryChannel: primaryChannel as
              | "app"
              | "email"
              | "slack"
              | "teams"
              | "whatsapp"
              | "telegram",
          }
        : {}),
      quietHours: start && end ? { start, end } : null,
    });
  } catch (error) {
    return {
      ok: false,
      code: null,
      message: error instanceof Error ? error.message : "That did not work.",
    };
  }
  revalidatePath("/account/channels");
  // No success message: the revalidation can unmount the form this would be
  // rendered in. The saved values coming back on the inputs are the durable
  // confirmation, and the card's own copy already says what a quiet window
  // does to a reminder.
  return { ok: true, code: null, message: "" };
}

/**
 * Saves how often the product writes to this member (S-36 member card,
 * P6-G08).
 *
 * One write for the whole card, because the four fields are one decision: a
 * member choosing "group everything into ten minutes" is also choosing not to
 * be told immediately, and saving those separately would let the two disagree
 * between two round trips.
 *
 * The routing map arrives as one `routing.<reason>` field per reason, because
 * that is what a form can express. An empty value means "no override", which
 * is what removing a key means, and the map is rebuilt rather than patched:
 * `notifications.updateSettings` takes the whole map for the same reason.
 */
export async function saveCadence(
  _previous: LinkResult | null,
  form: FormData,
): Promise<LinkResult> {
  const routing: Record<string, string> = {};
  for (const [field, value] of form.entries()) {
    if (!field.startsWith("routing.")) {
      continue;
    }
    const channel = String(value);
    if (channel !== "") {
      routing[field.slice("routing.".length)] = channel;
    }
  }

  const summaryTime = String(form.get("dailySummaryTime") ?? "");
  try {
    await callAction(await context(), "notifications.updateSettings", {
      mentionImmediate: form.get("mentionImmediate") !== null,
      batchWindowMinutes: Number(form.get("batchWindowMinutes") ?? 30),
      dailySummary: form.get("dailySummary") !== null,
      // An empty time input submits an empty string, which the schema would
      // refuse. Absent means "leave it as it was", which is the honest reading
      // of a field somebody cleared without choosing anything.
      ...(summaryTime === "" ? {} : { dailySummaryTime: summaryTime }),
      routing: routing as Record<
        "invited" | "joined" | "mentioned" | "role" | "review" | "check_in",
        "app" | "email" | "slack" | "teams" | "whatsapp" | "telegram"
      >,
    });
  } catch (error) {
    return {
      ok: false,
      code: null,
      message: error instanceof Error ? error.message : "That did not save.",
    };
  }
  revalidatePath("/account/channels");
  return { ok: true, code: null, message: "Saved." };
}
