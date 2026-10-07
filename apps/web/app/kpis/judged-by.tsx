"use client";

import { useTranslations } from "@openokr/ui";
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

const asText = (value: number | null) => (value === null ? "" : String(value));

const FIELD =
  "w-24 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink";

export function JudgedBy({
  idPrefix,
  initial,
}: {
  /** Keeps the inputs' ids apart where two forms share a page. */
  readonly idPrefix: string;
  readonly initial?: Rule;
}) {
  const { t } = useTranslations();
  const [type, setType] = useState<TargetType>(
    initial?.targetType ?? "at_least",
  );
  const one = (low: number | null, high: number | null) =>
    asText(lowIsGood(initial?.targetType ?? "at_least") ? high : low);
  const [green, setGreen] = useState(
    initial ? one(initial.greenLow, initial.greenHigh) : "",
  );
  const [red, setRed] = useState(
    initial ? one(initial.redLow, initial.redHigh) : "",
  );
  const [bandLow, setBandLow] = useState(asText(initial?.greenLow ?? null));
  const [bandHigh, setBandHigh] = useState(asText(initial?.greenHigh ?? null));
  const [redBelow, setRedBelow] = useState(asText(initial?.redLow ?? null));
  const [redAbove, setRedAbove] = useState(asText(initial?.redHigh ?? null));

  const none =
    type === "range"
      ? bandLow.trim() === "" && bandHigh.trim() === ""
      : green.trim() === "" && red.trim() === "";
  const id = (name: string) => `${idPrefix}-${name}`;

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
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="text-xs text-ink-3" htmlFor={id("bandLow")}>
            {t("kpis.rule.greenFrom")}
          </label>
          <input
            id={id("bandLow")}
            name="bandLow"
            type="number"
            step="any"
            value={bandLow}
            onChange={(event) => setBandLow(event.target.value)}
            className={FIELD}
          />
          <label className="text-xs text-ink-3" htmlFor={id("bandHigh")}>
            {t("kpis.rule.greenTo")}
          </label>
          <input
            id={id("bandHigh")}
            name="bandHigh"
            type="number"
            step="any"
            value={bandHigh}
            onChange={(event) => setBandHigh(event.target.value)}
            className={FIELD}
          />
          <label className="text-xs text-ink-3" htmlFor={id("redBelow")}>
            {t("kpis.rule.redBelow")}
          </label>
          <input
            id={id("redBelow")}
            name="redBelow"
            type="number"
            step="any"
            value={redBelow}
            onChange={(event) => setRedBelow(event.target.value)}
            className={FIELD}
          />
          <label className="text-xs text-ink-3" htmlFor={id("redAbove")}>
            {t("kpis.rule.redAbove")}
          </label>
          <input
            id={id("redAbove")}
            name="redAbove"
            type="number"
            step="any"
            value={redAbove}
            onChange={(event) => setRedAbove(event.target.value)}
            className={FIELD}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="text-xs text-ink-3" htmlFor={id("green")}>
            {lowIsGood(type)
              ? t("kpis.rule.greenAtOrBelow")
              : t("kpis.rule.greenAtOrAbove")}
          </label>
          <input
            id={id("green")}
            name="green"
            type="number"
            step="any"
            value={green}
            onChange={(event) => setGreen(event.target.value)}
            className={FIELD}
          />
          <label className="text-xs text-ink-3" htmlFor={id("red")}>
            {lowIsGood(type)
              ? t("kpis.rule.redAbove")
              : t("kpis.rule.redBelow")}
          </label>
          <input
            id={id("red")}
            name="red"
            type="number"
            step="any"
            value={red}
            onChange={(event) => setRed(event.target.value)}
            className={FIELD}
          />
        </div>
      )}

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
