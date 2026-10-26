"use client";

import { SelectInput, TextArea, useTranslations } from "@openokr/ui";
import { type FormEvent, startTransition, useActionState } from "react";
import type { OperatorLifecycleState } from "./lifecycle-actions";

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
 * A refusal is said under the button, and what was chosen and typed stays to
 * be corrected (guided-inputs §5, F5): submitted through a transition, as the
 * plan form is, because React resets a form after its action.
 */

/** What each destination does, in the operator's own words. */
const OPTIONS: readonly {
  readonly value: string;
  readonly label: string;
}[] = [
  { value: "active", label: "Active. Everything works." },
  { value: "suspended", label: "Suspended. Read-only for members." },
  { value: "closed", label: "Closed. Frozen, and the retention clock starts." },
];

export function LifecycleForm({
  action,
  currentState,
  workspaceId,
  workspaceName,
}: {
  readonly action: (formData: FormData) => Promise<OperatorLifecycleState>;
  readonly currentState: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    async (_previous: OperatorLifecycleState | null, formData: FormData) =>
      action(formData),
    null,
  );
  // `action` stays on the form, so it still works before the page hydrates.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold text-ink text-sm">
        {t("operator.lifecycle.title")}
      </h2>
      <form
        action={formAction}
        onSubmit={submit}
        aria-busy={pending}
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
          <SelectInput
            label={t("operator.lifecycle.moveTo")}
            defaultValue={currentState}
            id="lifecycle-state"
            name="state"
          >
            {OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        </div>

        <div className="flex flex-col gap-1.5">
          {/* Written for the customer rather than as an internal note: this
           * is the sentence the workspace's own members are shown, and it
           * stays on their audit log after the change is lifted. Lines of
           * its own, up to the server's 500 (guided-inputs §4.3). */}
          <TextArea
            label={t("operator.lifecycle.reason")}
            id="lifecycle-reason"
            maxLength={500}
            rows={2}
            name="reason"
            placeholder={t("operator.lifecycle.reasonPlaceholder")}
            required
          />
        </div>

        {/* The workspace's name is in the button, so the last thing read
         * before the click is who this happens to. */}
        <button
          className="self-start rounded-md bg-brand px-4 py-2 font-medium text-on-brand text-sm hover:bg-brand-strong disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {t("operator.lifecycle.applyTo", { workspaceName })}
        </button>
        {state?.error ? (
          <p
            className="rounded-md bg-bad-bg px-2.5 py-1.5 text-bad text-sm"
            role="alert"
          >
            {state.error}
          </p>
        ) : state?.done ? (
          <p className="text-ok text-sm" role="status">
            {t("operator.lifecycle.done")}
          </p>
        ) : null}
      </form>
    </section>
  );
}
