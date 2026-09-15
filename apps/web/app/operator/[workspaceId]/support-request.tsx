import { requestSupportSession } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { requireOperator } from "../../../lib/operator";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";

/**
 * Asking to come in, on S-46 (P8-T04b).
 *
 * **It asks and nothing more.** There is no path in this product that lets an
 * operator into a workspace on their own, so this form's only outcome is a
 * question sitting in the customer's admin screen. Saying that here, in the
 * form, matters as much as enforcing it: an operator should not be looking
 * for the button that skips the wait, and a reader of this file should not go
 * looking for it either.
 *
 * The reason is required and it is written for the customer. They read it
 * before they decide, and it stays on the record after the session ends.
 */
async function ask(formData: FormData): Promise<void> {
  "use server";
  const operator = await requireOperator();
  const workspaceId = String(formData.get("workspaceId") ?? "");

  try {
    await requestSupportSession(getPool(), {
      workspaceId,
      operatorUserId: operator.userId,
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (error) {
    // A blank reason and a request that already exists both arrive as
    // errors, and neither should show a stack trace. The page re-renders
    // showing whatever is actually true.
    if (error instanceof Error) {
      return;
    }
    throw error;
  }
  revalidatePath(`/operator/${workspaceId}`);
}

export async function SupportRequest({
  pending,
  workspaceId,
}: {
  readonly pending: boolean;
  readonly workspaceId: string;
}) {
  const { t } = await getTranslations();

  if (pending) {
    return (
      <p className="rounded-lg border border-line bg-surface px-4 py-3 text-ink-2 text-sm">
        {t("operator.supportRequest.pending")}
      </p>
    );
  }

  return (
    <form
      action={ask}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <input name="workspaceId" type="hidden" value={workspaceId} />
      <div className="flex flex-col gap-1.5">
        {/* Distinct from the lifecycle form's own reason field, which sits
         * on this same page. Two controls sharing an id make every `for`
         * ambiguous and a screen reader announce the wrong label. */}
        <label
          className="font-medium text-ink text-sm"
          htmlFor="support-reason"
        >
          {t("operator.supportRequest.why")}
        </label>
        <input
          className="rounded-md border border-line bg-bg px-3 py-2 text-ink text-sm"
          id="support-reason"
          maxLength={500}
          name="reason"
          placeholder={t("operator.supportRequest.placeholder")}
          required
          type="text"
        />
        <p className="text-ink-3 text-xs">
          {t("operator.supportRequest.adminDecides")}
        </p>
      </div>
      <button
        className="self-start rounded-md border border-line px-4 py-2 font-medium text-ink text-sm"
        type="submit"
      >
        {t("operator.supportRequest.submit")}
      </button>
    </form>
  );
}
