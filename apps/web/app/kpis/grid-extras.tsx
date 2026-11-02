"use client";

import { Chip, useTranslations } from "@openokr/ui";

/**
 * Two of the things S-20 asks for in the row and group headers (P6-G30): the
 * row sparkline and the category subtotal. Pure rendering over what
 * `kpis.grid` already returns.
 *
 * **Client components since the KPI redesign (2 November 2026)**, because
 * they now sit inside the grid's own rows, which the browser draws. They were
 * a separate "By category" card beside the grid, which said the same thing a
 * second time.
 */

export interface GridRecord {
  readonly periodStart: string;
  readonly actualValue: number | null;
}

/** The colour of the newest point: the KPI's band, so the line ends in it. */
const END_DOT: Readonly<Record<string, string>> = {
  healthy: "fill-ok-dot",
  watch: "fill-warn-dot",
  unhealthy: "fill-bad-dot",
};

/**
 * Twelve periods of one KPI, as a line.
 *
 * **A KPI with one value draws no line and says why.** Two points are the
 * fewest a trend can be made of, and a single dot stretched across a box reads
 * as a flat trend, which is a claim nobody made.
 *
 * Inline SVG rather than a chart library: twelve points and one path need no
 * dependency, and the grid draws one of these per row.
 */
export function RowSparkline({
  records,
  state,
  className = "h-6 w-20",
  testId = true,
}: {
  readonly records: readonly GridRecord[];
  /** The KPI's band, which colours the newest point. */
  readonly state: string;
  readonly className?: string;
  /** False on the phone's copy, so a test id names one element. */
  readonly testId?: boolean;
}) {
  const { t } = useTranslations();
  const values = [...records]
    .sort((left, right) => left.periodStart.localeCompare(right.periodStart))
    .filter((record) => record.actualValue !== null)
    .map((record) => record.actualValue as number);

  if (values.length < 2) {
    return (
      <span
        className="text-[11px] whitespace-nowrap text-ink-4"
        data-testid={testId ? "sparkline-too-short" : undefined}
      >
        {values.length === 0
          ? t("kpis.gridExtras.noValuesYet")
          : t("kpis.gridExtras.oneValueSoFar")}
      </span>
    );
  }

  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const span = highest - lowest || 1;
  const step = 96 / (values.length - 1);
  const points = values.map((value, index) => {
    // Inverted, because an SVG's y grows downward and a value does not.
    const y = 21 - ((value - lowest) / span) * 18;
    return [2 + index * step, y] as const;
  });
  const last = points[points.length - 1] as readonly [number, number];

  const described = t("kpis.gridExtras.periodsFromTo", {
    count: values.length,
    lowest,
    highest,
  });

  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className={`${className} overflow-visible text-brand`}
      role="img"
      aria-label={described}
      data-testid={testId ? "row-sparkline" : undefined}
    >
      <title>{described}</title>
      <polyline
        points={points
          .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
          .join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={last[0]}
        cy={last[1]}
        r="2.6"
        vectorEffect="non-scaling-stroke"
        className={END_DOT[state] ?? "fill-ink-4"}
      />
    </svg>
  );
}

/**
 * What a set of KPIs adds up to (P6-G30): a category's, in its header row, and
 * the whole grid's, under the page title.
 *
 * **It is a tally of corridor states, not a sum of values, and that is a
 * decision rather than a shortcut.** UIUX-PLAN §4 asks for subtotals and
 * METHOD.md defines none: there is no aggregate rule for a category, and
 * `packages/method`'s own `aggregateForPeriod` folds one KPI across
 * frequencies rather than several KPIs together. Adding a revenue figure to a
 * response time would be the product inventing a number, and every category in
 * this product may hold mixed units. What a reader wants from a grouped grid
 * is how the group is doing, and §6.4's corridor states answer exactly that.
 */
export function CategorySubtotal({
  states,
  recovering,
  count,
  testId = "category-subtotal",
}: {
  readonly states: readonly string[];
  /** How many of them have an open recovery objective. */
  readonly recovering: number;
  /** The "4 KPIs" in front of the chips, or nothing. */
  readonly count?: string;
  readonly testId?: string;
}) {
  const { t } = useTranslations();
  // Counted beside the bands rather than as one of them since P9-T17b-a: a
  // recovering KPI is also in its real band, and both are true at once.
  const of = (state: string) => states.filter((one) => one === state).length;
  const healthy = of("healthy");
  const watch = of("watch");
  const unhealthy = of("unhealthy");
  const noData = of("no_data");
  return (
    <span
      className="flex flex-wrap items-center gap-1.5 text-xs"
      data-testid={testId}
    >
      {count ? <span className="mr-0.5 text-ink-3">{count}</span> : null}
      {healthy > 0 ? (
        <Chip tone="ok" dot>
          {t("kpi.state.healthy", { healthy })}
        </Chip>
      ) : null}
      {watch > 0 ? (
        <Chip tone="warn" dot>
          {t("kpi.state.watch", { watch })}
        </Chip>
      ) : null}
      {unhealthy > 0 ? (
        <Chip tone="bad" dot>
          {t("kpi.state.unhealthy", { unhealthy })}
        </Chip>
      ) : null}
      {recovering > 0 ? (
        <Chip tone="info">{t("kpi.state.recovering", { recovering })}</Chip>
      ) : null}
      {noData > 0 ? (
        <Chip tone="neutral" dot>
          {t("kpi.state.noData", { noData })}
        </Chip>
      ) : null}
    </span>
  );
}
