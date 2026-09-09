import { Chip } from "@openokr/ui";
import Link from "next/link";
import { getTranslations } from "../../lib/translations";

/**
 * The three things S-20 asks for that the grid never had (P6-G30).
 *
 * The row sparkline, the category subtotal and the filter row. All three are
 * pure rendering over what `kpis.grid` already returns, which is why they live
 * beside the page rather than inside it.
 */

export interface GridRecord {
  readonly periodStart: string;
  readonly actualValue: number | null;
}

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
}: {
  readonly records: readonly GridRecord[];
}) {
  const values = records
    .filter((record) => record.actualValue !== null)
    .map((record) => record.actualValue as number);

  if (values.length < 2) {
    return (
      <span className="text-xs text-ink-4" data-testid="sparkline-too-short">
        {values.length === 0 ? "No values yet" : "One value so far"}
      </span>
    );
  }

  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const span = highest - lowest || 1;
  const step = 100 / (values.length - 1);
  const points = values
    .map((value, index) => {
      const x = index * step;
      // Inverted, because an SVG's y grows downward and a value does not.
      const y = 20 - ((value - lowest) / span) * 20;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 20"
      preserveAspectRatio="none"
      className="h-5 w-24 text-brand"
      role="img"
      aria-label={`${values.length} periods, from ${lowest} to ${highest}`}
      data-testid="row-sparkline"
    >
      <title>{`${values.length} periods, from ${lowest} to ${highest}`}</title>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

interface StateTally {
  readonly healthy: number;
  readonly watch: number;
  readonly unhealthy: number;
  readonly recovering: number;
  readonly noData: number;
}

const tally = (states: readonly string[]): StateTally => ({
  healthy: states.filter((state) => state === "healthy").length,
  watch: states.filter((state) => state === "watch").length,
  unhealthy: states.filter((state) => state === "unhealthy").length,
  recovering: states.filter((state) => state === "recovering").length,
  noData: states.filter((state) => state === "no_data").length,
});

/**
 * What a category adds up to (P6-G30).
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
export async function CategorySubtotal({
  states,
}: {
  readonly states: readonly string[];
}) {
  // A server component, so the catalogue comes from `getTranslations` rather
  // than from the client hook (P6-G25 built that seam).
  const { t } = await getTranslations();
  const counted = tally(states);
  return (
    <span
      className="flex flex-wrap items-center gap-1.5 text-xs"
      data-testid="category-subtotal"
    >
      <span className="text-ink-3">
        {states.length} {t("kpi.subtotal.count")}
      </span>
      {counted.healthy > 0 ? (
        <Chip tone="ok">
          {counted.healthy} {t("kpi.state.healthy")}
        </Chip>
      ) : null}
      {counted.watch > 0 ? (
        <Chip tone="warn">
          {counted.watch} {t("kpi.state.watch")}
        </Chip>
      ) : null}
      {counted.unhealthy > 0 ? (
        <Chip tone="bad">
          {counted.unhealthy} {t("kpi.state.unhealthy")}
        </Chip>
      ) : null}
      {counted.recovering > 0 ? (
        <Chip tone="info">
          {counted.recovering} {t("kpi.state.recovering")}
        </Chip>
      ) : null}
      {counted.noData > 0 ? (
        <Chip tone="neutral">
          {counted.noData} {t("kpi.state.noData")}
        </Chip>
      ) : null}
    </span>
  );
}

export interface FilterChoice {
  readonly value: string;
  readonly label: string;
}

/**
 * The filter row, following the goals explorer's pattern (P6-G30).
 *
 * **Links, not a form.** The explorer puts its filters in the url so a
 * combination survives a reload and can be sent to somebody; a form with local
 * state would lose both. Every chip is the current query with one key changed,
 * so combinations compose without a control that knows about the others.
 */
export function FilterRow({
  label,
  param,
  choices,
  active,
  query,
}: {
  readonly label: string;
  readonly param: string;
  readonly choices: readonly FilterChoice[];
  readonly active: string;
  /** The whole current query, so one chip can change one key. */
  readonly query: Readonly<Record<string, string>>;
}) {
  const href = (value: string): string => {
    const next = new URLSearchParams(query);
    if (value === "") {
      next.delete(param);
    } else {
      next.set(param, value);
    }
    const text = next.toString();
    return text === "" ? "/kpis" : `/kpis?${text}`;
  };

  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-xs font-semibold text-ink-4">{label}</span>
      {[{ value: "", label: "All" }, ...choices].map((choice) => (
        <Link
          key={choice.value || "all"}
          href={href(choice.value)}
          data-testid={`filter-${param}-${choice.value || "all"}`}
          className={
            choice.value === active
              ? "rounded-full bg-brand-weak px-2 py-0.5 text-xs font-semibold text-brand-text"
              : "rounded-full bg-raised px-2 py-0.5 text-xs text-ink-3 hover:text-ink"
          }
        >
          {choice.label}
        </Link>
      ))}
    </div>
  );
}
