"use client";

import { thresholdsComplete, thresholdsProblem } from "@openokr/method";
import { NumberInput, useTranslations } from "@openokr/ui";
import { useState } from "react";

/**
 * How a KPI is judged (METHOD.md §6.2, §6.4, P9-T17b-b): its target type, and
 * green and red values in its own units, or a green band for a range.
 *
 * One component for the add form and the KPI page, so the two cannot ask
 * differently. The fields it posts are read by `kpiRuleFrom` on the server,
 * which turns a one-sided green and red value into the pair the type uses.
 *
 * With no green and red values the KPI is judged by the ratio of current to
 * target, and §6.4 says the form says so: that rule suits a positive number
 * counted from zero and nothing else.
 *
 * **The values are number fields, and their order is checked as they are
 * typed** (guided-inputs §4.8), by the method's own `thresholdsProblem`, the
 * check the server refuses a save with, once the set is complete enough to
 * judge.
 */

export type TargetType =
  | "at_least"
  | "at_most"
  | "increase_to"
  | "decrease_to"
  | "range";

export interface Rule {
  readonly targetType: TargetType;
  readonly greenLow: number | null;
  readonly greenHigh: number | null;
  readonly redLow: number | null;
  readonly redHigh: number | null;
}

const TYPES: readonly { value: TargetType; key: string }[] = [
  { value: "at_least", key: "kpis.rule.atLeast" },
  { value: "at_most", key: "kpis.rule.atMost" },
  { value: "increase_to", key: "kpis.rule.increaseTo" },
  { value: "decrease_to", key: "kpis.rule.decreaseTo" },
  { value: "range", key: "kpis.rule.range" },
];

const lowIsGood = (type: TargetType) =>
  type === "at_most" || type === "decrease_to";

const FIELD = "h-auto w-24 py-1 text-xs";

export function JudgedBy({
  idPrefix,
  initial,
  unit,
}: {
  /** Keeps the inputs' ids apart where two forms share a page. */
  readonly idPrefix: string;
  readonly initial?: Rule;
  /** The KPI's unit, beside each value where it is known. */
  readonly unit?: string | null;
}) {
  const { t } = useTranslations();
  const [type, setType] = useState<TargetType>(
    initial?.targetType ?? "at_least",
  );
  const one = (low: number | null, high: number | null) =>
    lowIsGood(initial?.targetType ?? "at_least") ? high : low;
  const [green, setGreen] = useState<number | null>(
    initial ? one(initial.greenLow, initial.greenHigh) : null,
  );
  const [red, setRed] = useState<number | null>(
    initial ? one(initial.redLow, initial.redHigh) : null,
  );
  const [bandLow, setBandLow] = useState(initial?.greenLow ?? null);
  const [bandHigh, setBandHigh] = useState(initial?.greenHigh ?? null);
  const [redBelow, setRedBelow] = useState(initial?.redLow ?? null);
  const [redAbove, setRedAbove] = useState(initial?.redHigh ?? null);

  // The pair `kpiRuleFrom` makes on the server, so the check here is the one
  // the action makes.
  const thresholds =
    type === "range"
      ? {
          greenLow: bandLow,
          greenHigh: bandHigh,
          redLow: redBelow,
          redHigh: redAbove,
        }
      : lowIsGood(type)
        ? { greenLow: null, greenHigh: green, redLow: null, redHigh: red }
        : { greenLow: green, greenHigh: null, redLow: red, redHigh: null };
  const none =
    type === "range"
      ? bandLow === null && bandHigh === null
      : green === null && red === null;
  const problem =
    !none && thresholdsComplete(type, thresholds)
      ? thresholdsProblem(type, thresholds)
      : null;
  const id = (name: string) => `${idPrefix}-${name}`;
  const value = (
    name: string,
    label: string,
    current: number | null,
    set: (next: number | null) => void,
  ) => (
    <NumberInput
      id={id(name)}
      label={label}
      name={name}
      value={current}
      onValueChange={set}
      unit={unit}
      inputClassName={FIELD}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="text-xs text-ink-3" htmlFor={id("targetType")}>
          {t("kpis.rule.targetType")}
        </label>
        <select
          id={id("targetType")}
          name="targetType"
          value={type}
          onChange={(event) => setType(event.target.value as TargetType)}
          className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2"
        >
          {TYPES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {t(entry.key)}
            </option>
          ))}
        </select>
      </div>

      {type === "range" ? (
        <div className="flex flex-wrap items-end gap-2.5">
          {value("bandLow", t("kpis.rule.greenFrom"), bandLow, setBandLow)}
          {value("bandHigh", t("kpis.rule.greenTo"), bandHigh, setBandHigh)}
          {value("redBelow", t("kpis.rule.redBelow"), redBelow, setRedBelow)}
          {value("redAbove", t("kpis.rule.redAbove"), redAbove, setRedAbove)}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2.5">
          {value(
            "green",
            lowIsGood(type)
              ? t("kpis.rule.greenAtOrBelow")
              : t("kpis.rule.greenAtOrAbove"),
            green,
            setGreen,
          )}
          {value(
            "red",
            lowIsGood(type) ? t("kpis.rule.redAbove") : t("kpis.rule.redBelow"),
            red,
            setRed,
          )}
        </div>
      )}

      {problem ? (
        <p
          role="status"
          data-testid="kpi-threshold-order"
          className="text-xs font-medium text-bad"
        >
          {problem}
        </p>
      ) : null}
      {none ? (
        <p data-testid="kpi-fallback-note" className="text-xs text-ink-3">
          {type === "range"
            ? t("kpis.rule.rangeNeedsBand")
            : t("kpis.rule.fallbackNote")}
        </p>
      ) : null}
    </div>
  );
}
