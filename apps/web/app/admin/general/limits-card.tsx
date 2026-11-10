"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  NumberInput,
  useTranslations,
} from "@openokr/ui";
import { useActionState } from "react";
import { NOTHING_SAVED } from "./general-state.ts";
import { submitLimits } from "./limits-actions.ts";

const GIGABYTE = 1024 ** 3;

export interface WorkspaceLimits {
  readonly storageQuotaBytes: number;
  readonly exportInlineRowLimit: number;
  readonly importRowLimit: number;
  readonly messageLogRetentionDays: number;
  readonly agentRunCostCapUsd: number;
  readonly agentToolCallRetentionDays: number;
}

/**
 * The limits card on S-36 (plan 0.7.0 B10).
 *
 * Five settings that were declared, defaulted and honoured, and that nothing
 * could change. On a cloud the storage quota and the agent cost cap are the
 * provider's (Akmal's choice of 9 November 2026), so they show as read-only
 * lines naming who sets them, and are not posted.
 */
export function LimitsCard({
  limits,
  providerSetsTwo,
  canManage,
}: {
  readonly limits: WorkspaceLimits;
  /** A cloud: the quota and the cost cap are the operator's. */
  readonly providerSetsTwo: boolean;
  readonly canManage: boolean;
}) {
  const { t } = useTranslations();
  const [state, submit, pending] = useActionState(submitLimits, NOTHING_SAVED);
  const gigabytes =
    Math.round((limits.storageQuotaBytes / GIGABYTE) * 100) / 100;

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">
          {t("admin.general.limits.title")}
        </h2>
      </CardHeader>
      <CardBody>
        <form
          action={submit}
          aria-busy={pending}
          className="flex flex-col gap-4"
        >
          <p className="text-sm text-ink-2">
            {t("admin.general.limits.intro")}
          </p>
          {providerSetsTwo ? (
            <ul className="flex flex-col gap-1 text-sm text-ink-2">
              <li>
                {t("admin.general.limits.storageQuota")}:{" "}
                {t("admin.general.limits.providerSets", {
                  value: `${gigabytes} GB`,
                })}
              </li>
              <li>
                {t("admin.general.limits.agentCostCap")}:{" "}
                {t("admin.general.limits.providerSets", {
                  value: `${limits.agentRunCostCapUsd} USD`,
                })}
              </li>
            </ul>
          ) : (
            <div className="flex flex-wrap gap-4">
              <NumberInput
                label={t("admin.general.limits.storageQuota")}
                name="storageQuotaGigabytes"
                error={state.fields?.storageQuotaGigabytes}
                defaultValue={gigabytes}
                min={0.01}
                step={0.01}
                unit="GB"
                description={t("admin.general.limits.storageQuotaHint")}
                disabled={!canManage}
                inputClassName="w-28"
              />
              <NumberInput
                label={t("admin.general.limits.agentCostCap")}
                name="agentRunCostCapUsd"
                error={state.fields?.agentRunCostCapUsd}
                defaultValue={limits.agentRunCostCapUsd}
                min={0}
                step={0.01}
                unit="USD"
                description={t("admin.general.limits.agentCostCapHint")}
                disabled={!canManage}
                inputClassName="w-28"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-4">
            <NumberInput
              label={t("admin.general.limits.exportRows")}
              name="exportInlineRowLimit"
              error={state.fields?.exportInlineRowLimit}
              defaultValue={limits.exportInlineRowLimit}
              min={1}
              step={1}
              description={t("admin.general.limits.exportRowsHint")}
              disabled={!canManage}
              inputClassName="w-28"
            />
            <NumberInput
              label={t("admin.general.limits.importRows")}
              name="importRowLimit"
              error={state.fields?.importRowLimit}
              defaultValue={limits.importRowLimit}
              min={1}
              step={1}
              description={t("admin.general.limits.importRowsHint")}
              disabled={!canManage}
              inputClassName="w-28"
            />
            <NumberInput
              label={t("admin.general.limits.messageLogDays")}
              name="messageLogRetentionDays"
              error={state.fields?.messageLogRetentionDays}
              defaultValue={limits.messageLogRetentionDays}
              min={0}
              step={1}
              description={t("admin.general.limits.messageLogDaysHint")}
              disabled={!canManage}
              inputClassName="w-28"
            />
            <NumberInput
              label={t("admin.general.limits.agentCallDays")}
              name="agentToolCallRetentionDays"
              error={state.fields?.agentToolCallRetentionDays}
              defaultValue={limits.agentToolCallRetentionDays}
              min={0}
              step={1}
              description={t("admin.general.limits.agentCallDaysHint")}
              disabled={!canManage}
              inputClassName="w-28"
            />
          </div>
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-3">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={pending}
                name="intent"
                value="save"
              >
                {t("common.save")}
              </Button>
              <Button
                type="submit"
                variant="default"
                size="sm"
                disabled={pending}
                name="intent"
                value="reset"
              >
                {t("common.resetToDefaults")}
              </Button>
            </div>
          ) : null}
          {state.error === null ? null : (
            <p role="alert" className="max-w-sm text-xs font-medium text-bad">
              {state.error}
            </p>
          )}
          {state.saved === null ? null : (
            <p role="status" className="max-w-sm text-xs text-ink-2">
              {state.saved}
            </p>
          )}
        </form>
      </CardBody>
    </Card>
  );
}
