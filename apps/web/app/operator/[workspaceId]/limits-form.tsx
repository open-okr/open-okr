"use client";

import {
  guardPress,
  NumberInput,
  Spinner,
  TextArea,
  useTranslations,
} from "@openokr/ui";
import { type FormEvent, startTransition, useActionState } from "react";
import type { OperatorLimitsState } from "./limits-actions";

const GIGABYTE = 1024 ** 3;

/**
 * The provider's two limits on S-46 (plan 0.7.0 B10): the storage quota and
 * the agent cost cap. The workspace's own administrators see them on their
 * limits card and cannot change them on a cloud. A reason is required,
 * because the customer reads it in their own audit log.
 */
export function OperatorLimitsForm({
  action,
  storageQuotaBytes,
  agentRunCostCapUsd,
  workspaceId,
}: {
  readonly action: (formData: FormData) => Promise<OperatorLimitsState>;
  readonly storageQuotaBytes: number;
  readonly agentRunCostCapUsd: number;
  readonly workspaceId: string;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    async (_previous: OperatorLimitsState | null, formData: FormData) =>
      action(formData),
    null,
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold text-ink text-sm">
        {t("operator.limits.title")}
      </h2>
      <form
        action={formAction}
        onSubmit={submit}
        aria-busy={pending}
        className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
      >
        <input name="workspaceId" type="hidden" value={workspaceId} />
        <p className="text-ink-2 text-sm">{t("operator.limits.intro")}</p>
        <div className="flex flex-wrap gap-4">
          <NumberInput
            label={t("operator.limits.storageQuota")}
            id="limits-storage"
            name="storageQuotaGigabytes"
            defaultValue={
              Math.round((storageQuotaBytes / GIGABYTE) * 100) / 100
            }
            min={0.01}
            step={0.01}
            unit="GB"
            inputClassName="w-28"
          />
          <NumberInput
            label={t("operator.limits.agentCostCap")}
            id="limits-cost-cap"
            name="agentRunCostCapUsd"
            defaultValue={agentRunCostCapUsd}
            min={0}
            step={0.01}
            unit="USD"
            inputClassName="w-28"
          />
        </div>
        <TextArea
          label={t("operator.limits.reason")}
          id="limits-reason"
          maxLength={500}
          name="reason"
          placeholder={t("operator.limits.reasonPlaceholder")}
          required
          rows={2}
        />
        <button
          className="inline-flex items-center gap-1.5 self-start rounded-md bg-brand px-4 py-2 font-medium text-on-brand text-sm hover:bg-brand-strong disabled:opacity-60 aria-disabled:opacity-60"
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
          onClick={guardPress(pending, undefined)}
          type="submit"
        >
          {pending ? <Spinner /> : null}
          <span>{t("operator.limits.save")}</span>
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
            {t("operator.limits.saved")}
          </p>
        ) : null}
      </form>
    </section>
  );
}
