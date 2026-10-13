"use client";

import {
  NumberInput,
  SelectInput,
  TextArea,
  useTranslations,
} from "@openokr/ui";
import {
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useRef,
} from "react";
import type { OperatorPlanState } from "./plan-actions";

/**
 * The plan control on S-46 (completeness review H-21).
 *
 * A seat count of the operator's own is allowed here and nowhere else, for a
 * contract that matches no catalogue row. Empty means the plan's own number.
 */
export function OperatorPlanForm({
  action,
  current,
  plans,
  workspaceId,
  workspaceName,
}: {
  readonly action: (formData: FormData) => Promise<OperatorPlanState>;
  readonly current: string | null;
  readonly plans: readonly { readonly key: string; readonly label: string }[];
  readonly workspaceId: string;
  readonly workspaceName: string;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    async (_previous: OperatorPlanState | null, formData: FormData) =>
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
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold text-ink text-sm">
        {t("operator.plan.title")}
      </h2>
      <form
        action={formAction}
        onSubmit={submit}
        ref={form}
        aria-busy={pending}
        className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
        key={current ?? ""}
      >
        <input name="workspaceId" type="hidden" value={workspaceId} />
        <p className="text-ink-2 text-sm">{t("operator.plan.intro")}</p>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <SelectInput
              label={t("operator.plan.plan")}
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
            </SelectInput>
          </div>
          <div className="flex flex-col gap-1.5">
            <NumberInput
              label={t("operator.plan.seats")}
              id="plan-seats"
              min={1}
              name="seats"
              step={1}
              description={t("operator.plan.seatsHint")}
              inputClassName="w-28"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <TextArea
            label={t("operator.plan.reason")}
            id="plan-reason"
            maxLength={500}
            name="reason"
            placeholder={t("operator.plan.reasonPlaceholder")}
            required
            rows={2}
          />
        </div>
        <button
          className="self-start rounded-md bg-brand px-4 py-2 font-medium text-on-brand text-sm hover:bg-brand-strong disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {t("operator.plan.apply", { workspaceName })}
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
            {t("operator.plan.done")}
          </p>
        ) : null}
      </form>
    </section>
  );
}
