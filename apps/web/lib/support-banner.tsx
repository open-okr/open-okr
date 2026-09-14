import { endSupportSession, liveSupportSession } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "./pool";
import { requireSession } from "./session";

/**
 * Somebody from outside the organisation is in this workspace right now
 * (P8-T04b).
 *
 * **This is the one banner in the product that cannot be dismissed**, and
 * that is deliberate rather than an oversight. Every other banner can be, and
 * should be: a workspace-state notice explains something the reader already
 * knows, and a site message is news they can absorb once. This one is
 * different because the cost of forgetting it is that somebody outside the
 * organisation is reading the organisation's objectives, check-ins and
 * private comments, and nobody in the room remembers.
 *
 * **Every member sees it, not only the owner who granted it.** The person who
 * said yes is not the only person whose work is being read.
 *
 * Revoking is offered to everybody who can see it. A customer should never
 * have to find the right administrator to get their own workspace back, and
 * the worst case of a too-generous revoke control is that a support session
 * ends early.
 */
async function revoke(formData: FormData): Promise<void> {
  "use server";
  const session = await requireSession();
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (workspaceId.length === 0 || sessionId.length === 0) {
    return;
  }
  try {
    await endSupportSession(getPool(), {
      workspaceId,
      sessionId,
      reason: "revoked",
      endedByUserId: session.user.id,
    });
  } catch (error) {
    // A session that already ended is not an error worth a stack trace: two
    // people clicking revoke at once is the ordinary case.
    if (error instanceof Error) {
      return;
    }
    throw error;
  }
  revalidatePath("/", "layout");
}

/** Whole hours and minutes, because "in 3h 20m" is what somebody asks. */
function remaining(until: Date): string {
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) {
    return "less than a minute";
  }
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  if (hours === 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${hours}h ${minutes % 60}m`;
}

export async function SupportBanner({
  workspaceId,
}: {
  readonly workspaceId: string;
}) {
  const live = await liveSupportSession(getPool(), workspaceId);
  if (!live?.expiresAt) {
    return null;
  }

  return (
    <div
      className="mb-4.5 flex flex-wrap items-start gap-3 rounded-lg border-y border-r border-l-4 border-bad-dot bg-bad-bg px-4 py-3 text-bad"
      // `alert` rather than `status`: a screen reader should be told this
      // without waiting for a pause, because it is about who is reading the
      // page they are on.
      role="alert"
    >
      <div className="flex-1">
        <p className="font-semibold text-sm">
          OpenOKR support is in this workspace, for another{" "}
          {remaining(live.expiresAt)}.
        </p>
        {/* The reason is somebody's own sentence and usually ends in a
         * stop. Appending another gave "not arriving.. Everything", so the
         * two are separate paragraphs and the product never punctuates
         * words it did not write. */}
        <p className="mt-1 text-sm opacity-90">{live.reason}</p>
        <p className="mt-1 text-sm opacity-90">
          Everything they do is in your audit log, attributed to them.
        </p>
      </div>
      <form action={revoke}>
        <input name="workspaceId" type="hidden" value={workspaceId} />
        <input name="sessionId" type="hidden" value={live.id} />
        {/* No dismiss. Ending it is the only way to make this go away, which
         * is the point. */}
        <button
          className="whitespace-nowrap rounded-md border border-bad-dot px-3 py-1.5 font-medium text-sm"
          type="submit"
        >
          End it now
        </button>
      </form>
    </div>
  );
}
