"use client";

import {
  DateInput,
  guardPress,
  SelectInput,
  Spinner,
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
import type { OperatorTrialState } from "./trial-actions";

/**
 * The trial control on S-46 (docs/design/tenant-lifecycle.md §11 T2, plan
 * 0.7.0 P4). Start a trial on a plan, move its end date, or remove it.
 *
 * Choosing a plan here starts the trial on it; leaving "Keep the current
 * plan" only moves the date. A date in the future lifts a read-only mode the
 * trial caused. Submitted through a transition, as the plan control is, so a
 * refusal does not reset what was typed.
 */
export function OperatorTrialForm({
  action,
  endsOn,
  plans,
  workspaceId,
}: {
  readonly action: (formData: FormData) => Promise<OperatorTrialState>;
  /** The current end date, `YYYY-MM-DD`, or null with no trial. */
  readonly endsOn: string | null;
  readonly plans: readonly { readonly key: string; readonly label: string }[];
  readonly workspaceId: string;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    async (_previous: OperatorTrialState | null, formData: FormData) =>
      action(formData),
    null,
  );
  const form = useRef<HTMLFormElement>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
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
        {t("operator.trial.title")}
      </h2>
      <form
        action={formAction}
        onSubmit={submit}
        ref={form}
        aria-busy={pending}
        className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
        key={endsOn ?? ""}
      >
        <input name="workspaceId" type="hidden" value={workspaceId} />
        <p className="text-ink-2 text-sm">{t("operator.trial.intro")}</p>
        <div className="flex flex-wrap gap-4">
          <SelectInput
            label={t("operator.trial.plan")}
            defaultValue=""
            id="trial-plan"
            name="planKey"
          >
            <option value="">{t("operator.trial.keepPlan")}</option>
            {plans.map((plan) => (
              <option key={plan.key} value={plan.key}>
                {plan.label}
              </option>
            ))}
          </SelectInput>
          <DateInput
            label={t("operator.trial.endsOn")}
            id="trial-ends"
            name="endsOn"
            defaultValue={endsOn}
            inputClassName="w-40"
          />
        </div>
        <TextArea
          label={t("operator.trial.reason")}
          id="trial-reason"
          maxLength={500}
          name="reason"
          placeholder={t("operator.trial.reasonPlaceholder")}
          required
          rows={2}
        />
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 font-medium text-on-brand text-sm hover:bg-brand-strong aria-disabled:opacity-60"
            aria-disabled={pending || undefined}
            aria-busy={pending || undefined}
            onClick={guardPress(pending, undefined)}
            type="submit"
          >
            {pending ? <Spinner /> : null}
            <span>{t("operator.trial.save")}</span>
          </button>
          {endsOn ? (
            <button
              className="rounded-md border border-line px-4 py-2 font-medium text-ink-2 text-sm hover:bg-raised aria-disabled:opacity-60"
              aria-disabled={pending || undefined}
              onClick={guardPress(pending, undefined)}
              name="remove"
              value="1"
              type="submit"
            >
              {t("operator.trial.remove")}
            </button>
          ) : null}
        </div>
        {state?.error ? (
          <p
            className="rounded-md bg-bad-bg px-2.5 py-1.5 text-bad text-sm"
            role="alert"
          >
            {state.error}
          </p>
        ) : state?.done ? (
          <p className="text-ok text-sm" role="status">
            {t("operator.trial.done")}
          </p>
        ) : null}
      </form>
    </section>
  );
}
