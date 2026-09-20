import {
  ACCESS_LEVELS,
  endSupportSession,
  grantSupportSession,
} from "@openokr/core";
import { revalidatePath } from "next/cache";
import { requireAccessLevel } from "../../../lib/access.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";

/**
 * One pending request, and the decision (P8-T04b).
 *
 * **The reason leads and the controls follow.** Somebody deciding whether to
 * let an outsider into their organisation's objectives needs to read why
 * first, and a form that puts the buttons above the sentence invites a click
 * before a read.
 *
 * Refusing is offered beside granting rather than hidden as "do nothing". A
 * request left unanswered is a request the operator is still waiting on, and
 * saying no is a real answer that belongs in the record.
 *
 * Both actions re-check the level rather than trusting the page that rendered
 * them, because a page rendered ten minutes ago is not evidence of anything.
 */
async function decide(formData: FormData): Promise<void> {
  "use server";
  const access = await requireAccessLevel(ACCESS_LEVELS.full);
  const sessionId = String(formData.get("sessionId") ?? "");
  const answer = String(formData.get("answer") ?? "");

  try {
    if (answer === "refuse") {
      await endSupportSession(getPool(), {
        workspaceId: access.workspaceId,
        sessionId,
        reason: "refused",
        endedByUserId: access.userId,
      });
    } else {
      await grantSupportSession(getPool(), {
        workspaceId: access.workspaceId,
        sessionId,
        grantedByUserId: access.userId,
        hours: Number(formData.get("hours") ?? 4),
        level: Number(formData.get("level") ?? ACCESS_LEVELS.view),
      });
    }
  } catch (error) {
    // A request somebody else already answered is the ordinary race, not a
    // crash. The page re-renders with the request gone, which is the honest
    // result.
    if (error instanceof Error) {
      return;
    }
    throw error;
  }
  revalidatePath("/admin/support");
  revalidatePath("/", "layout");
}

export async function GrantDecision({
  reason,
  requestedAt,
  sessionId,
}: {
  readonly reason: string;
  readonly requestedAt: string;
  readonly sessionId: string;
}) {
  const { t } = await getTranslations();

  return (
    <form
      action={decide}
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
    >
      <input name="sessionId" type="hidden" value={sessionId} />

      <div className="flex flex-col gap-1">
        <p className="text-ink-3 text-xs">
          {t("admin.support.grant.asked", { requestedAt })}
        </p>
        {/* The sentence the operator wrote, at reading size and first. */}
        <p className="text-ink text-sm">{reason}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-ink text-sm" htmlFor="level">
            {t("admin.support.grant.theyMay")}
          </label>
          <select
            className="rounded-md border border-line bg-bg px-3 py-2 text-ink text-sm"
            defaultValue={String(ACCESS_LEVELS.view)}
            id="level"
            name="level"
          >
            <option value={ACCESS_LEVELS.view}>
              {t("admin.support.grant.readOnly")}
            </option>
            <option value={ACCESS_LEVELS.comment}>
              {t("admin.support.grant.readAndComment")}
            </option>
            <option value={ACCESS_LEVELS.edit}>
              {t("admin.support.grant.readAndChange")}
            </option>
          </select>
          {/* Said here so nobody goes looking for the option. */}
          <p className="text-ink-3 text-xs">
            {t("admin.support.grant.neverAccessControl")}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-ink text-sm" htmlFor="hours">
            {t("admin.support.grant.for")}
          </label>
          <select
            className="rounded-md border border-line bg-bg px-3 py-2 text-ink text-sm"
            defaultValue="4"
            id="hours"
            name="hours"
          >
            <option value="1">{t("admin.support.grant.oneHour")}</option>
            <option value="4">{t("admin.support.grant.fourHours")}</option>
            <option value="8">{t("admin.support.grant.eightHours")}</option>
            <option value="24">
              {t("admin.support.grant.twentyFourHours")}
            </option>
          </select>
          <p className="text-ink-3 text-xs">
            {t("admin.support.grant.endsOnItsOwn")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md bg-brand px-4 py-2 font-medium text-on-brand text-sm hover:bg-brand-strong"
          name="answer"
          type="submit"
          value="grant"
        >
          {t("admin.support.grant.letThemIn")}
        </button>
        <button
          className="rounded-md border border-line px-4 py-2 font-medium text-ink text-sm"
          name="answer"
          type="submit"
          value="refuse"
        >
          {t("admin.support.grant.no")}
        </button>
      </div>
    </form>
  );
}
