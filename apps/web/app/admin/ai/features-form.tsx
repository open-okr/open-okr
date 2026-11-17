"use client";

import { SelectInput, SettingsSaveBar, useTranslations } from "@openokr/ui";
import { useState, useTransition } from "react";
import { saveFeature } from "./actions.ts";
import { NOTHING_YET } from "./form-state.ts";

export interface FeatureRow {
  readonly featureKey: string;
  /** The assist's name, already in the reader's language. */
  readonly label: string;
  readonly enabled: boolean;
  /** Empty means "whatever the assist asks for". */
  readonly tier: string;
}

export interface TierChoice {
  readonly value: string;
  readonly label: string;
}

/**
 * Every assist's switch and tier in one card with one footer save bar
 * (docs/design/settings-page-layout.md). The server action is the one each row
 * had before: Save changes calls it once per row that changed, so what is
 * stored, authorised and audited is unchanged.
 */
export function FeaturesForm({
  rows,
  tiers,
}: {
  readonly rows: readonly FeatureRow[];
  readonly tiers: readonly TierChoice[];
}) {
  const { t } = useTranslations();
  const formId = "ai-features-form";
  const [saved, setSaved] = useState<
    Readonly<Record<string, { enabled: boolean; tier: string }>>
  >(() =>
    Object.fromEntries(
      rows.map((row) => [
        row.featureKey,
        { enabled: row.enabled, tier: row.tier },
      ]),
    ),
  );
  const [values, setValues] = useState(saved);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const changed = rows.filter((row) => {
    const now = values[row.featureKey];
    const was = saved[row.featureKey];
    return now?.enabled !== was?.enabled || now?.tier !== was?.tier;
  });

  const submit = () => {
    startTransition(async () => {
      setMessage(null);
      setError(null);
      const stored: Record<string, { enabled: boolean; tier: string }> = {};
      let refusal: string | null = null;
      let lastOk: string | null = null;
      for (const row of changed) {
        const now = values[row.featureKey];
        if (!now) {
          continue;
        }
        const form = new FormData();
        form.set("featureKey", row.featureKey);
        if (now.enabled) {
          form.set("enabled", "on");
        }
        form.set("tierOverride", now.tier);
        const result = await saveFeature(NOTHING_YET, form);
        if (result.ok) {
          stored[row.featureKey] = now;
          lastOk = result.message;
        } else {
          refusal = `${row.label}: ${result.message}`;
          break;
        }
      }
      setSaved((previous) => ({ ...previous, ...stored }));
      setMessage(lastOk);
      setError(refusal);
    });
  };

  return (
    <>
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onReset={(event) => {
          event.preventDefault();
          setValues(saved);
          setMessage(null);
          setError(null);
        }}
        aria-busy={pending}
        className="flex flex-col gap-2 p-3.5"
      >
        {rows.map((row) => {
          const now = values[row.featureKey];
          return (
            <div
              key={row.featureKey}
              data-testid={`ai-feature-${row.featureKey}`}
              className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line pt-2 first:border-0 first:pt-0"
            >
              <label className="flex min-w-64 items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name={`enabled-${row.featureKey}`}
                  checked={now?.enabled ?? true}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      [row.featureKey]: {
                        enabled: event.target.checked,
                        tier: previous[row.featureKey]?.tier ?? "",
                      },
                    }))
                  }
                  className="size-4"
                />
                <span className="text-sm">{row.label}</span>
              </label>
              <SelectInput
                label={t("admin.ai.governance.tier")}
                name={`tierOverride-${row.featureKey}`}
                value={now?.tier ?? ""}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    [row.featureKey]: {
                      enabled: previous[row.featureKey]?.enabled ?? true,
                      tier: event.target.value,
                    },
                  }))
                }
                className="flex-row items-center gap-1.5"
                inputClassName="w-auto"
              >
                <option value="">
                  {t("admin.ai.governance.whateverTheAssistAsks")}
                </option>
                {tiers.map((tier) => (
                  <option key={tier.value} value={tier.value}>
                    {tier.label}
                  </option>
                ))}
              </SelectInput>
            </div>
          );
        })}
      </form>
      <SettingsSaveBar
        mode="footer"
        formId={formId}
        unsaved={changed.map((row) => row.label)}
        saved={message}
        error={error}
        pending={pending}
      />
    </>
  );
}
