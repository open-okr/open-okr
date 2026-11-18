"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  NumberInput,
  SettingsSaveBar,
  useTranslations,
} from "@openokr/ui";
import {
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useState,
} from "react";
import { NOTHING_SAVED } from "./general-state.ts";
import { submitLimits } from "./limits-actions.ts";

const GIGABYTE = 1024 ** 3;
const FORM_ID = "limits-form";

/** The six numbers as the form shows them: storage in gigabytes. */
interface Values {
  readonly storageQuotaGigabytes: number | null;
  readonly agentRunCostCapUsd: number | null;
  readonly exportInlineRowLimit: number | null;
  readonly importRowLimit: number | null;
  readonly messageLogRetentionDays: number | null;
  readonly agentToolCallRetentionDays: number | null;
}

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
 *
 * The card is one of the page's footer-saved cards (docs/design/
 * settings-page-layout.md): Reset to defaults in the header, Save changes in
 * the bar under the body, the fields in a 12-column grid, three to a row.
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
  const [acting, setActing] = useState<string | null>(null);
  const gigabytes =
    Math.round((limits.storageQuotaBytes / GIGABYTE) * 100) / 100;

  const stored: Values = {
    storageQuotaGigabytes: gigabytes,
    agentRunCostCapUsd: limits.agentRunCostCapUsd,
    exportInlineRowLimit: limits.exportInlineRowLimit,
    importRowLimit: limits.importRowLimit,
    messageLogRetentionDays: limits.messageLogRetentionDays,
    agentToolCallRetentionDays: limits.agentToolCallRetentionDays,
  };
  const storedKey = JSON.stringify(stored);
  const [baseline, setBaseline] = useState<Values>(stored);
  const [current, setCurrent] = useState<Values>(stored);
  // Bumped by Discard: a number field keeps its own state.
  const [discards, setDiscards] = useState(0);
  const change = (patch: Partial<Values>) =>
    setCurrent((previous) => ({ ...previous, ...patch }));

  // What is stored is the baseline whenever it changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialised values on purpose.
  useEffect(() => {
    setBaseline(stored);
    setCurrent(stored);
  }, [storedKey]);

  // Carries the pressed button's `intent`, which both buttons set from
  // outside the form.
  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    setActing(submitter instanceof HTMLButtonElement ? submitter.value : null);
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => submit(data));
  };

  const cell = "col-span-12 md:col-span-6 lg:col-span-4";
  const fields: readonly {
    readonly key: keyof Values;
    readonly label: string;
    readonly hint: string;
    readonly error: string | undefined;
    readonly min: number;
    readonly step: number;
    readonly unit?: string;
  }[] = [
    {
      key: "storageQuotaGigabytes",
      label: t("admin.general.limits.storageQuota"),
      hint: t("admin.general.limits.storageQuotaHint"),
      error: state.fields?.storageQuotaGigabytes,
      min: 0.01,
      step: 0.01,
      unit: "GB",
    },
    {
      key: "agentRunCostCapUsd",
      label: t("admin.general.limits.agentCostCap"),
      hint: t("admin.general.limits.agentCostCapHint"),
      error: state.fields?.agentRunCostCapUsd,
      min: 0,
      step: 0.01,
      unit: "USD",
    },
    {
      key: "exportInlineRowLimit",
      label: t("admin.general.limits.exportRows"),
      hint: t("admin.general.limits.exportRowsHint"),
      error: state.fields?.exportInlineRowLimit,
      min: 1,
      step: 1,
    },
    {
      key: "importRowLimit",
      label: t("admin.general.limits.importRows"),
      hint: t("admin.general.limits.importRowsHint"),
      error: state.fields?.importRowLimit,
      min: 1,
      step: 1,
    },
    {
      key: "messageLogRetentionDays",
      label: t("admin.general.limits.messageLogDays"),
      hint: t("admin.general.limits.messageLogDaysHint"),
      error: state.fields?.messageLogRetentionDays,
      min: 0,
      step: 1,
    },
    {
      key: "agentToolCallRetentionDays",
      label: t("admin.general.limits.agentCallDays"),
      hint: t("admin.general.limits.agentCallDaysHint"),
      error: state.fields?.agentToolCallRetentionDays,
      min: 0,
      step: 1,
    },
  ];

  const unsaved = fields
    .filter(
      (field) =>
        !(providerSetsTwo && PROVIDER_SET.includes(field.key)) &&
        current[field.key] !== baseline[field.key],
    )
    .map((field) => field.label);

  return (
    <Card data-testid="limits-card">
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-ink">
            {t("admin.general.limits.title")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.general.limits.intro")}
          </p>
        </div>
        {canManage ? (
          <Button
            type="submit"
            form={FORM_ID}
            name="intent"
            value="reset"
            variant="ghost"
            size="sm"
            disabled={pending}
            pending={pending && acting === "reset"}
          >
            {t("common.resetToDefaults")}
          </Button>
        ) : null}
      </CardHeader>
      <CardBody>
        <form
          key={`${storedKey}-${discards}`}
          id={FORM_ID}
          action={submit}
          onSubmit={send}
          onReset={() => {
            setCurrent(baseline);
            setDiscards((count) => count + 1);
          }}
          aria-busy={pending}
          className="grid grid-cols-12 gap-x-6 gap-y-4 [&>ul]:col-span-12"
        >
          {fields.map((field) =>
            providerSetsTwo && PROVIDER_SET.includes(field.key) ? (
              // The provider's own limit: named, with who sets it, and not
              // posted. It takes the cell the field would have had.
              <p key={field.key} className={`${cell} text-sm text-ink-2`}>
                {field.label}:{" "}
                {t("admin.general.limits.providerSets", {
                  value:
                    field.key === "storageQuotaGigabytes"
                      ? `${gigabytes} GB`
                      : `${limits.agentRunCostCapUsd} USD`,
                })}
              </p>
            ) : (
              <NumberInput
                key={field.key}
                label={field.label}
                name={field.key}
                error={field.error}
                defaultValue={stored[field.key] ?? undefined}
                min={field.min}
                step={field.step}
                unit={field.unit}
                description={field.hint}
                disabled={!canManage}
                className={cell}
                onValueChange={(next) => change({ [field.key]: next })}
              />
            ),
          )}
        </form>
      </CardBody>
      {canManage ? (
        <SettingsSaveBar
          mode="footer"
          formId={FORM_ID}
          unsaved={unsaved}
          saved={unsaved.length > 0 ? null : state.saved}
          error={state.error}
          pending={pending}
          savePending={pending && acting === "save"}
        />
      ) : null}
    </Card>
  );
}

/** The two the provider sets on a cloud. */
const PROVIDER_SET: readonly (keyof Values)[] = [
  "storageQuotaGigabytes",
  "agentRunCostCapUsd",
];
