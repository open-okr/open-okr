"use client";

import { useTranslations } from "@openokr/ui";
import {
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useRef,
} from "react";
import type { PlanChangeState } from "./actions";

/**
 * Moving this workspace onto another plan (completeness review H-21).
 *
 * The refusal is shown as the domain wrote it, because it names the seats in
 * use and the seats the plan has, which is what an administrator needs to
 * decide whom to remove.
 */
export function PlanForm({
  action,
  current,
  plans,
}: {
  readonly action: (formData: FormData) => Promise<PlanChangeState>;
  readonly current: string | null;
  readonly plans: readonly { readonly key: string; readonly label: string }[];
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    async (_previous: PlanChangeState | null, formData: FormData) =>
      action(formData),
    null,
  );
  // Submitted through a transition rather than left to the form's action,
  // because React resets a form after its action and a refusal would then
  // put the select back on the current plan, under the sentence explaining
  // why the other one was refused. `action` stays, so the form still works
  // before the page has hydrated. The form clears itself only on a success.
  const form = useRef<HTMLFormElement>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };
  useEffect(() => {
    if (state?.done) {
      form.current?.reset();
    }
  }, [state]);

  return (
    <form
      action={formAction}
      onSubmit={submit}
      ref={form}
      aria-busy={pending}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-3"
      key={current ?? ""}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-ink text-sm" htmlFor="plan-key">
            {t("admin.plan.change")}
          </label>
          <select
            className="rounded-md border border-line bg-bg px-3 py-2 text-ink text-sm"
            defaultValue={current ?? ""}
            id="plan-key"
            name="planKey"
          >
            <option value="">{t("admin.plan.free")}</option>
            {plans.map((plan) => (
              <option key={plan.key} value={plan.key}>
                {plan.label}
              </option>
            ))}
          </select>
        </div>
        <button
          className="rounded-md bg-brand px-4 py-2 font-medium text-on-brand text-sm hover:bg-brand-strong disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {t("admin.plan.changeButton")}
        </button>
      </div>
      <p className="text-ink-3 text-xs">{t("admin.plan.fewerSeats")}</p>
      {state?.error ? (
        <p
          className="rounded-md bg-bad-bg px-2.5 py-1.5 text-bad text-sm"
          role="alert"
        >
          {state.error}
        </p>
      ) : state?.done ? (
        <p className="text-ok text-sm" role="status">
          {t("admin.plan.changed")}
        </p>
      ) : null}
    </form>
  );
}
