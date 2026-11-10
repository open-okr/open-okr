"use client";

import { guardPress, Spinner, TextArea, useTranslations } from "@openokr/ui";
import { type FormEvent, startTransition, useActionState } from "react";
import type { DefaultPlanFillState } from "./actions";

/**
 * The confirm under the review (plan 0.8.0 O2). Submitted through a
 * transition, as the plan form on S-46 is, so a refusal keeps the reason the
 * operator typed. The result lists each workspace that did not move and why.
 */
export function DefaultPlanForm({
  action,
  planName,
  workspaces,
}: {
  readonly action: (formData: FormData) => Promise<DefaultPlanFillState>;
  readonly planName: string;
  readonly workspaces: readonly {
    readonly id: string;
    readonly name: string;
  }[];
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    async (_previous: DefaultPlanFillState | null, formData: FormData) =>
      action(formData),
    null,
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };

  if (state?.done) {
    const { moved, refused, skipped } = state.done;
    return (
      <section
        className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 text-sm"
        data-testid="default-plan-result"
        role="status"
      >
        <p className="font-semibold text-ink">
          {moved === 1
            ? t("operator.defaultPlan.movedOne", { plan: planName })
            : t("operator.defaultPlan.movedOther", {
                count: moved,
                plan: planName,
              })}
        </p>
        {[...refused, ...skipped].length > 0 ? (
          <ul className="flex flex-col gap-1 text-ink-2">
            {[...refused, ...skipped].map((row) => (
              <li key={row.name}>
                {t("operator.defaultPlan.notMoved", {
                  name: row.name,
                  reason: row.reason,
                })}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  if (workspaces.length === 0) {
    return null;
  }

  return (
    <form
      action={formAction}
      onSubmit={submit}
      aria-busy={pending}
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
    >
      {workspaces.map((workspace) => (
        <span key={workspace.id} hidden>
          <input name="workspaceId" type="hidden" value={workspace.id} />
          <input name="workspaceName" type="hidden" value={workspace.name} />
        </span>
      ))}
      <TextArea
        label={t("operator.plan.reason")}
        id="default-plan-reason"
        maxLength={500}
        name="reason"
        defaultValue={t("operator.defaultPlan.reasonDefault")}
        error={state?.fields?.reason}
        required
        rows={2}
      />
      <button
        className="inline-flex items-center gap-1.5 self-start rounded-md bg-brand px-4 py-2 font-medium text-on-brand text-sm hover:bg-brand-strong disabled:opacity-60 aria-disabled:opacity-60"
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        onClick={guardPress(pending, undefined)}
        type="submit"
        data-testid="default-plan-confirm"
      >
        {pending ? <Spinner /> : null}
        <span>
          {workspaces.length === 1
            ? t("operator.defaultPlan.confirmOne", { plan: planName })
            : t("operator.defaultPlan.confirmOther", {
                count: workspaces.length,
                plan: planName,
              })}
        </span>
      </button>
      {state?.error ? (
        <p
          className="rounded-md bg-bad-bg px-2.5 py-1.5 text-bad text-sm"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
