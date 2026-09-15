import { OperationError, setLifecycleAsOperator } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { requireOperator } from "../../../lib/operator";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";

/**
 * The lifecycle control on S-46 (P8-T03b).
 *
 * **It is the one thing on this screen that changes somebody else's day, and
 * it is the only thing on the screen that looks like it.** The first version
 * rendered it as another bordered card, identical to the one showing the
 * region, so the control that can freeze a customer's workspace carried the
 * weight of a label. Here it sits apart, states its consequence before its
 * controls, and names the workspace inside the button so the last thing an
 * operator reads before clicking is who it happens to.
 *
 * A server action, so the grant is re-checked on the write rather than
 * trusted from the page that rendered the form. `requireOperator` runs again
 * here for exactly that reason: a page rendered ten minutes ago is not
 * evidence that the person is still an operator, and a revoked grant has to
 * stop a write it never saw coming.
 *
 * `setLifecycleAsOperator` checks it a third time at the domain door, and the
 * database policies underneath check it on every query. Four checks sounds
 * like three too many until you notice each one is the only check at its own
 * layer.
 */
async function move(formData: FormData): Promise<void> {
  "use server";
  const operator = await requireOperator();
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const state = String(formData.get("state") ?? "");
  const reason = String(formData.get("reason") ?? "");

  if (state !== "active" && state !== "suspended" && state !== "closed") {
    // Validated here rather than trusted from a select element, because a
    // form post is external input like any other.
    return;
  }

  try {
    await setLifecycleAsOperator(getPool(), {
      workspaceId,
      operatorUserId: operator.userId,
      state,
      reason,
    });
  } catch (error) {
    // A refusal is not a crash. A blank reason reaches here as a ZodError and
    // a missing tenant as an OperationError; neither should show the operator
    // a stack trace. The form re-renders with the workspace unchanged, which
    // is the honest result.
    if (error instanceof OperationError || error instanceof Error) {
      return;
    }
    throw error;
  }
  revalidatePath(`/operator/${workspaceId}`);
  revalidatePath("/operator");
}

/** What each destination does, in the operator's own words. */
const OPTIONS: readonly {
  readonly value: string;
  readonly label: string;
}[] = [
  { value: "active", label: "Active. Everything works." },
  { value: "suspended", label: "Suspended. Read-only for members." },
  { value: "closed", label: "Closed. Frozen, and the retention clock starts." },
];

export async function LifecycleForm({
  currentState,
  workspaceId,
  workspaceName,
}: {
  readonly currentState: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
}) {
  const { t } = await getTranslations();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold text-ink text-sm">
        {t("operator.lifecycle.title")}
      </h2>
      <form
        action={move}
        className="flex flex-col gap-4 rounded-lg border border-bad-dot/40 bg-surface p-4"
        // Keyed on the state so React remounts the select after a change.
        // Without this the chip above read "suspended" while the select still
        // read "active", because `defaultValue` applies on mount and React
        // reuses the DOM node across a re-render. Found in a browser, not by a
        // type check: a select showing the wrong current state tells a reader
        // the opposite of the truth.
        key={currentState}
      >
        <input name="workspaceId" type="hidden" value={workspaceId} />

        <p className="text-ink-2 text-sm">{t("operator.lifecycle.intro")}</p>

        <div className="flex flex-col gap-1.5">
          <label
            className="font-medium text-ink text-sm"
            htmlFor="lifecycle-state"
          >
            {t("operator.lifecycle.moveTo")}
          </label>
          <select
            className="rounded-md border border-line bg-bg px-3 py-2 text-ink text-sm"
            defaultValue={currentState}
            id="lifecycle-state"
            name="state"
          >
            {OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            className="font-medium text-ink text-sm"
            htmlFor="lifecycle-reason"
          >
            {t("operator.lifecycle.reason")}
          </label>
          {/* Written for the customer rather than as an internal note: this
           * is the sentence the workspace's own members are shown, and it
           * stays on their audit log after the change is lifted. */}
          <input
            className="rounded-md border border-line bg-bg px-3 py-2 text-ink text-sm"
            id="lifecycle-reason"
            maxLength={500}
            name="reason"
            placeholder={t("operator.lifecycle.reasonPlaceholder")}
            required
            type="text"
          />
        </div>

        {/* The workspace's name is in the button, so the last thing read
         * before the click is who this happens to. */}
        <button
          className="self-start rounded-md bg-brand px-4 py-2 font-medium text-on-brand text-sm hover:bg-brand-strong"
          type="submit"
        >
          {t("operator.lifecycle.applyTo")} {workspaceName}
        </button>
      </form>
    </section>
  );
}
