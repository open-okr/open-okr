"use client";

/**
 * A KPI suggested from a sentence, beside the form it saves you filling in
 * (AI-NATIVE-PLAN §2.2, UIUX-PLAN S-20, completeness review M-09).
 *
 * `kpis.suggest` was built at P4-T15b-b and nothing called it. The add form
 * above is the manual path and is unchanged. The suggestion arrives as the
 * same fields, filled and editable, and nothing is created until the person
 * presses Add. A formula §6's parser refused is not offered at all; the reason
 * is shown instead, and the metric can still be added by hand-entry.
 */
import { Button, Chip, useTranslations } from "@openokr/ui";
import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import {
  addSuggestedKpiAction,
  type KeptKpi,
  suggestKpiAction,
} from "./actions.ts";

type Suggested = NonNullable<Awaited<ReturnType<typeof suggestKpiAction>>>;

interface Editing {
  readonly title: string;
  readonly unit: string;
  readonly frequency: KeptKpi["frequency"];
  readonly direction: KeptKpi["direction"];
  readonly tier: KeptKpi["tier"];
  readonly target: string;
  readonly healthy: string;
  readonly watch: string;
  readonly formula: unknown;
  readonly references: readonly string[];
  readonly keepFormula: boolean;
  readonly formulaRefused: string | null;
  readonly why: string;
}

const editable = (suggested: Suggested): Editing => ({
  title: suggested.title,
  unit: suggested.unit ?? "",
  frequency: suggested.frequency,
  direction: suggested.direction,
  tier: suggested.tier,
  target:
    suggested.targetDefault === null ? "" : String(suggested.targetDefault),
  healthy: suggested.healthyPct === null ? "" : String(suggested.healthyPct),
  watch: suggested.watchPct === null ? "" : String(suggested.watchPct),
  formula: suggested.formula,
  references: suggested.formulaReferences,
  keepFormula: suggested.formula !== null,
  formulaRefused: suggested.formulaRefused,
  why: suggested.why,
});

const numberOrNull = (text: string): number | null => {
  if (text.trim() === "") {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

const FIELD =
  "rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink";

export function KpiSuggestion() {
  const { t } = useTranslations();
  const [pending, start] = useTransition();
  const [sentence, setSentence] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = (next: Partial<Editing>) =>
    setEditing((current) =>
      current === null ? null : { ...current, ...next },
    );

  return (
    <section
      className="flex flex-col gap-2 border-t border-line pt-3"
      data-testid="kpi-suggestion"
      aria-label={t("kpis.suggestion.heading")}
    >
      <h3 className="text-xs font-semibold text-ink-2">
        {t("kpis.suggestion.heading")}
      </h3>
      {editing === null ? (
        <>
          <label className="sr-only" htmlFor="kpi-sentence">
            {t("kpis.suggestion.describeIt")}
          </label>
          <textarea
            id="kpi-sentence"
            rows={2}
            maxLength={1000}
            value={sentence}
            disabled={pending}
            placeholder={t("kpis.suggestion.describeIt")}
            onChange={(event) => setSentence(event.target.value)}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-4"
          />
          <Button
            type="button"
            variant="ai"
            size="sm"
            className="self-start"
            disabled={pending || sentence.trim() === ""}
            onClick={() => {
              setNotice(null);
              start(async () => {
                try {
                  const suggested = await suggestKpiAction(sentence.trim());
                  if (suggested) {
                    setEditing(editable(suggested));
                  } else {
                    setNotice(t("assists.reading.nothingThisTime"));
                  }
                } catch {
                  setNotice(t("assists.reading.couldNotRun"));
                }
              });
            }}
          >
            <Sparkles className="size-3" />
            {pending
              ? t("assists.reading.working")
              : t("kpis.suggestion.suggest")}
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
          <span className="flex items-center gap-2">
            <Chip tone="agent">{t("common.ai")}</Chip>
            <span className="text-xs text-ink-4">
              {t("kpis.suggestion.editBeforeAdding")}
            </span>
          </span>
          {editing.why === "" ? null : (
            <p className="text-xs text-ink-3">{editing.why}</p>
          )}
          <label className="flex flex-col gap-1 text-xs text-ink-3">
            {t("kpis.whatIsBeingMeasured")}
            <input
              value={editing.title}
              maxLength={500}
              disabled={pending}
              onChange={(event) => set({ title: event.target.value })}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <div className="flex flex-wrap items-end gap-2.5">
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              {t("kpis.suggestion.unit")}
              <input
                value={editing.unit}
                maxLength={60}
                disabled={pending}
                onChange={(event) => set({ unit: event.target.value })}
                className={`w-24 ${FIELD}`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              {t("common.frequency")}
              <select
                value={editing.frequency}
                disabled={pending}
                onChange={(event) =>
                  set({
                    frequency: event.target.value as KeptKpi["frequency"],
                  })
                }
                className={FIELD}
              >
                <option value="daily">{t("common.daily")}</option>
                <option value="weekly">{t("common.weekly")}</option>
                <option value="monthly">{t("common.monthly")}</option>
                <option value="quarterly">{t("common.quarterly")}</option>
                <option value="yearly">{t("common.yearly")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              {t("common.betterWhen")}
              <select
                value={editing.direction}
                disabled={pending}
                onChange={(event) =>
                  set({
                    direction: event.target.value as KeptKpi["direction"],
                  })
                }
                className={FIELD}
              >
                <option value="higher_better">{t("common.higher")}</option>
                <option value="lower_better">{t("common.lower")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              {t("common.standingTarget")}
              <input
                type="number"
                step="any"
                value={editing.target}
                disabled={pending}
                onChange={(event) => set({ target: event.target.value })}
                className={`w-24 ${FIELD}`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              {t("kpis.suggestion.healthyAt")}
              <input
                type="number"
                step="any"
                min={0}
                max={200}
                value={editing.healthy}
                disabled={pending}
                onChange={(event) => set({ healthy: event.target.value })}
                className={`w-20 ${FIELD}`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              {t("kpis.suggestion.watchAt")}
              <input
                type="number"
                step="any"
                min={0}
                max={200}
                value={editing.watch}
                disabled={pending}
                onChange={(event) => set({ watch: event.target.value })}
                className={`w-20 ${FIELD}`}
              />
            </label>
          </div>
          {editing.formula !== null ? (
            <label className="flex items-center gap-2 text-xs text-ink-3">
              <input
                type="checkbox"
                checked={editing.keepFormula}
                disabled={pending}
                onChange={(event) => set({ keepFormula: event.target.checked })}
              />
              {t("kpis.suggestion.calculatedFrom", {
                sources: editing.references.join(", "),
              })}
            </label>
          ) : null}
          {editing.formulaRefused ? (
            <p className="text-xs text-ink-4">
              {t("kpis.suggestion.formulaRefused", {
                reason: editing.formulaRefused,
              })}
            </p>
          ) : null}
          <span className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={pending || editing.title.trim() === ""}
              onClick={() => {
                setNotice(null);
                start(async () => {
                  const result = await addSuggestedKpiAction({
                    title: editing.title,
                    unit: editing.unit,
                    frequency: editing.frequency,
                    direction: editing.direction,
                    tier: editing.tier,
                    targetDefault: numberOrNull(editing.target),
                    healthyPct: numberOrNull(editing.healthy),
                    watchPct: numberOrNull(editing.watch),
                    formula: editing.keepFormula ? editing.formula : null,
                  });
                  if (result.error) {
                    setNotice(result.error);
                    return;
                  }
                  setEditing(null);
                  setSentence("");
                  setNotice(t("kpis.suggestion.added"));
                });
              }}
            >
              {t("kpis.suggestion.addIt")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setEditing(null)}
            >
              {t("common.dismiss")}
            </Button>
          </span>
        </div>
      )}
      {notice ? (
        <p role="status" className="text-xs text-ink-4">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
