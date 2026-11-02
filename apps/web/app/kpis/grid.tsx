"use client";

import { type KpiFrequency, normalisePeriod } from "@openokr/method";
import {
  Avatar,
  Chip,
  NumberInput,
  Tooltip,
  useTranslations,
} from "@openokr/ui";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { recordCell } from "./actions.ts";
import { CategorySubtotal, RowSparkline } from "./grid-extras.tsx";
import { kpiCount } from "./kpi-count.ts";

/**
 * The KPI grid (UIUX-PLAN.md §4 S-20, P3-T12, redesigned 2 November 2026).
 *
 * KPIs as rows, periods as columns, driven by each KPI's own frequency. Each
 * cell holds the actual with its target under it, on its band's colour. The
 * row header carries the title, the owner, the type and the unit; then the
 * trend and the standing now, so a row is read before its months are. Each
 * category is a header row with its tally, and ends in a row that adds a KPI
 * to it.
 *
 * **On a phone it is a card per KPI**: the newest value against its target,
 * the band, the trend and the last three periods. A twelve-column table at
 * 375 pixels is a horizontal scroll nobody finishes. Entry stays on the
 * KPI's own page there, which the card opens.
 *
 * **Keyboard first, because this is a data-entry screen.** Enter commits the
 * cell and moves down the rows as drawn, the arrows move without committing,
 * Escape restores what was there. A grid that needed the mouse for every cell
 * would be slower than the spreadsheet it is meant to replace, and somebody
 * would go back to the spreadsheet.
 *
 * **A cell is coloured by its own corridor, not by the KPI's stored state.** The
 * stored state is the KPI's standing now, computed from its newest period; a cell
 * three months back has its own achievement and its own band. Colouring every
 * cell by the KPI's current state would say last quarter was healthy because this
 * one is.
 */

export interface GridKpi {
  readonly id: string;
  readonly title: string;
  readonly categoryId: string | null;
  readonly frequency: string;
  readonly unit: string | null;
  readonly direction: string;
  readonly indicatorType: string;
  /** Optional (§6.2): null when no tier was chosen. */
  readonly tier: string | null;
  /** The band, or no data (§6.4). */
  readonly state: string;
  /** An open recovery objective, shown beside the band (P9-T17b-a). */
  readonly recovering: boolean;
  readonly achievementPct: number | null;
  readonly targetDefault: number | null;
  readonly healthyPct: number;
  readonly watchPct: number;
  readonly isCalculated: boolean;
  /** The expression behind a calculated KPI, for its formula chip. */
  readonly formula: string | null;
  readonly ownerName: string | null;
  /** The one named person who owns it (§6.2), when somebody is named. */
  readonly namedOwnerName: string | null;
  readonly records: readonly {
    readonly periodStart: string;
    readonly actualValue: number | null;
    readonly targetValue: number | null;
    readonly remark: string | null;
    /** This period's band by the KPI's own rule, from the server (P9-T17a). */
    readonly band: "healthy" | "watch" | "unhealthy" | null;
  }[];
}

export interface GridCategory {
  readonly id: string | null;
  readonly name: string;
}

/**
 * The columns, oldest first so the grid reads left to right like a calendar.
 *
 * **One column set, with a dot where a column is not a period that KPI has.**
 * S-20 wants the columns driven by frequency, which strictly means one table per
 * frequency; that restructure is recorded as still to do. Mixing frequencies in
 * one set and marking the cells that do not apply is honest in the meantime, and
 * it never offers an input for a bucket the KPI does not have.
 *
 * **The current period is always a column, even with nothing in it.** Deriving
 * columns only from existing records reads well until you meet a new KPI: it has
 * no records, so it gets no columns, so there is nowhere to type the first value
 * and the screen is unusable. The browser found that within a minute of the grid
 * first rendering.
 */
function columnsFor(kpis: readonly GridKpi[], today: string): string[] {
  const seen = new Set<string>();
  for (const kpi of kpis) {
    for (const record of kpi.records) {
      seen.add(record.periodStart);
    }
    // The engine decides which bucket today falls in, so the column a value
    // lands in and the column drawn for it cannot disagree.
    seen.add(normalisePeriod(kpi.frequency as KpiFrequency, today));
  }
  return [...seen].sort();
}

/** Whether this column is a period this KPI's frequency actually has. */
function isPeriodOf(kpi: GridKpi, column: string, today: string): boolean {
  if (kpi.records.some((record) => record.periodStart === column)) {
    return true;
  }
  return normalisePeriod(kpi.frequency as KpiFrequency, today) === column;
}

/**
 * A column's heading as a reader says it: "Oct" for a month, "27 Oct" for a
 * period that starts mid-month, with the year under the first column and
 * wherever the year turns. The ISO date wrapped onto two lines in every
 * column and read as a database.
 */
function headingsFor(
  columns: readonly string[],
  locale: string,
): { readonly label: string; readonly year: string | null }[] {
  const safe = (() => {
    try {
      return new Intl.DateTimeFormat(locale).resolvedOptions().locale;
    } catch {
      return "en";
    }
  })();
  const month = new Intl.DateTimeFormat(safe, {
    month: "short",
    timeZone: "UTC",
  });
  const dayMonth = new Intl.DateTimeFormat(safe, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  let year: string | null = null;
  return columns.map((column) => {
    const date = new Date(`${column}T00:00:00Z`);
    const label = column.endsWith("-01")
      ? month.format(date)
      : dayMonth.format(date);
    const its = column.slice(0, 4);
    const shown = its === year ? null : its;
    year = its;
    return { label, year: shown };
  });
}

/**
 * The colour of one cell, from the band the server read for that period by
 * the KPI's own rule (P9-T17a). It used to work the ratio out here, which was
 * a second copy of §6.4 and the wrong answer for a KPI with thresholds.
 *
 * Softer than the chips, so twelve of them in a row read as a pattern rather
 * than as a wall; a period below the corridor also turns its figure red, so
 * colour is not the only signal.
 */
const BAND_TONE: Readonly<Record<string, string>> = {
  healthy: "bg-ok-bg/70",
  watch: "bg-warn-bg/65",
  unhealthy: "bg-bad-bg",
};

const STATE_TEXT: Readonly<Record<string, string>> = {
  healthy: "text-ok",
  watch: "text-warn",
  unhealthy: "text-bad",
  no_data: "text-ink-4",
};

const STATE_DOT: Readonly<Record<string, string>> = {
  healthy: "bg-ok-dot",
  watch: "bg-warn-dot",
  unhealthy: "bg-bad-dot",
  no_data: "bg-ink-4",
};

const STATE_CHIP = {
  healthy: "ok",
  watch: "warn",
  unhealthy: "bad",
  no_data: "neutral",
} as const;

/** The newest period with a value, or null when nothing is recorded. */
function newest(kpi: GridKpi) {
  return (
    [...kpi.records]
      .filter((record) => record.actualValue !== null)
      .sort((left, right) => right.periodStart.localeCompare(left.periodStart))
      .at(0) ?? null
  );
}

/** A number as the grid prints it: grouped, and never a long tail. */
function figure(value: number | null, locale: string): string {
  if (value === null) {
    return "–";
  }
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
      value,
    );
  } catch {
    return String(value);
  }
}

export function KpiGrid({
  categories,
  kpis,
  canEdit,
  today,
  addHref,
}: {
  readonly categories: readonly GridCategory[];
  readonly kpis: readonly GridKpi[];
  readonly canEdit: boolean;
  /**
   * Today in the workspace calendar, from the server. Never `new Date()` here:
   * the browser's clock is the reader's, and a value typed at 23:00 in Jakarta
   * would land in yesterday's bucket for a workspace on UTC.
   */
  readonly today: string;
  /**
   * The address that opens the New KPI panel, keeping the filters. A
   * category's own link adds `&in=<id>`, which preselects it.
   */
  readonly addHref: string;
}) {
  const { t, locale } = useTranslations();
  const language = locale === "pseudo" ? "en" : locale;

  const columns = columnsFor(kpis, today);
  const headings = headingsFor(columns, language);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const groups = categories
    .map((category) => ({
      category,
      rows: kpis.filter((kpi) => kpi.categoryId === category.id),
    }))
    .filter((group) => group.rows.length > 0);
  // The rows in the order they are drawn, so Enter moves to the row below on
  // screen rather than to the next one the read happened to return.
  const drawn = groups.flatMap((group) => group.rows);

  const commit = (
    kpiId: string,
    periodStart: string,
    value: number | null,
  ): void => {
    setError(null);
    startTransition(async () => {
      const state = await recordCell(kpiId, periodStart, value);
      if (state.error) {
        setError(state.error);
      }
    });
  };

  /** Enter commits and moves down, the arrows move, Escape restores. */
  const onKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    kpiId: string,
    periodStart: string,
    cell: { readonly commit: () => void; readonly revert: () => void },
  ): void => {
    const move = (rowDelta: number, columnDelta: number): void => {
      const rowIndex = drawn.findIndex((kpi) => kpi.id === kpiId);
      const columnIndex = columns.indexOf(periodStart);
      const nextRow = drawn[rowIndex + rowDelta];
      const nextColumn = columns[columnIndex + columnDelta];
      if (!nextRow || !nextColumn) {
        return;
      }
      document.getElementById(`cell-${nextRow.id}-${nextColumn}`)?.focus();
    };

    switch (event.key) {
      case "Enter":
        event.preventDefault();
        cell.commit();
        move(1, 0);
        break;
      case "Escape":
        event.preventDefault();
        cell.revert();
        break;
      case "ArrowDown":
        event.preventDefault();
        move(1, 0);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1, 0);
        break;
      case "ArrowRight":
        event.preventDefault();
        move(0, 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        move(0, -1);
        break;
      default:
        break;
    }
  };

  if (kpis.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-surface p-4 text-sm text-ink-3">
        {t("kpis.grid.noKpisYetA")}
      </p>
    );
  }

  const addInto = (categoryId: string | null) =>
    categoryId === null ? addHref : `${addHref}&in=${categoryId}`;
  const ownerOf = (kpi: GridKpi) => kpi.namedOwnerName ?? kpi.ownerName;
  const tally = (rows: readonly GridKpi[]) => (
    <CategorySubtotal
      states={rows.map((kpi) => kpi.state)}
      recovering={rows.filter((kpi) => kpi.recovering).length}
      count={kpiCount(t, rows.length)}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p
          role="alert"
          className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
        >
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface max-md:hidden">
        <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
          <caption className="sr-only">{t("kpis.grid.kpisAsRowsAnd")}</caption>
          <thead>
            <tr className="text-[11.5px] font-semibold text-ink-3">
              <th className="sticky left-0 z-10 h-8.5 w-[270px] border-r border-b border-line bg-bg px-3 text-left font-semibold">
                {t("kpis.grid.kpi")}
              </th>
              <th className="min-w-23 border-b border-line bg-bg px-2 text-left font-semibold">
                {t("kpis.grid.trend")}
              </th>
              <th className="min-w-30 border-r border-b border-line bg-bg px-2.5 text-left font-semibold">
                {t("kpis.grid.now")}
              </th>
              {columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className="min-w-16 border-b border-line bg-bg px-1 text-center leading-tight font-semibold whitespace-nowrap"
                >
                  {headings[index]?.label}
                  {headings[index]?.year ? (
                    <span className="block text-[10px] font-medium text-ink-4">
                      {headings[index]?.year}
                    </span>
                  ) : null}
                </th>
              ))}
              {/* Takes the slack, so with three periods the named columns
               * keep their widths instead of stretching apart. */}
              <td className="w-full border-b border-line bg-bg" />
            </tr>
          </thead>
          {groups.map(({ category, rows }) => (
            <tbody key={category.id ?? "uncategorised"}>
              <tr>
                <th
                  colSpan={columns.length + 4}
                  scope="colgroup"
                  className="h-10 border-b border-line bg-bg p-0 text-left font-normal"
                >
                  <span className="sticky left-0 inline-flex items-center gap-2.5 px-3 whitespace-nowrap">
                    <span className="text-[13px] font-bold text-ink">
                      {category.name}
                    </span>
                    {tally(rows)}
                  </span>
                </th>
              </tr>
              {rows.map((kpi) => {
                const latest = newest(kpi);
                const owner = ownerOf(kpi);
                const lower = kpi.direction === "lower_better";
                return (
                  <tr key={kpi.id} className="group">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 w-[270px] max-w-[270px] border-r border-b border-line bg-surface px-3 py-2 text-left font-normal group-hover:bg-bg"
                    >
                      <Link
                        href={`/kpis/${kpi.id}`}
                        className="block truncate text-[13px] font-semibold text-ink hover:text-brand-text hover:underline"
                      >
                        {kpi.title}
                      </Link>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3">
                        {owner ? (
                          <span className="flex min-w-0 items-center gap-1">
                            <Avatar
                              name={owner}
                              size="sm"
                              className="size-4 text-[7px]"
                            />
                            <span className="truncate">{owner}</span>
                          </span>
                        ) : null}
                        <Meta>{kpi.indicatorType}</Meta>
                        {kpi.unit ? <Meta>{kpi.unit}</Meta> : null}
                        {kpi.isCalculated ? (
                          <Tooltip label={kpi.formula ?? ""}>
                            <span className="flex-none rounded bg-info-bg px-1.5 text-[10.5px] font-semibold text-info">
                              {t("kpis.grid.calculated")}
                            </span>
                          </Tooltip>
                        ) : null}
                      </span>
                    </th>
                    <td className="border-b border-line px-2 group-hover:bg-bg">
                      <RowSparkline records={kpi.records} state={kpi.state} />
                    </td>
                    <td
                      data-state={kpi.state}
                      className="border-r border-b border-line px-2.5 group-hover:bg-bg"
                    >
                      {latest === null ? (
                        <span className="block text-[11.5px] whitespace-nowrap text-ink-4">
                          {t("kpis.gridExtras.noValuesYet")}
                        </span>
                      ) : (
                        <>
                          <span className="flex items-baseline gap-1 whitespace-nowrap tabular-nums">
                            <span className="text-sm font-bold text-ink">
                              {figure(latest.actualValue, language)}
                            </span>
                            {(latest.targetValue ?? kpi.targetDefault) !==
                            null ? (
                              <span className="text-[11px] text-ink-4">
                                /{" "}
                                {figure(
                                  latest.targetValue ?? kpi.targetDefault,
                                  language,
                                )}
                              </span>
                            ) : null}
                            <Tooltip
                              label={
                                lower
                                  ? t("kpis.grid.lowerIsBetter")
                                  : t("kpis.grid.higherIsBetter")
                              }
                            >
                              <span className="cursor-default text-[11px] font-semibold text-ink-4">
                                <span className="sr-only">
                                  {lower
                                    ? t("kpis.grid.lowerIsBetter")
                                    : t("kpis.grid.higherIsBetter")}
                                </span>
                                <span aria-hidden="true">
                                  {lower ? "↓" : "↑"}
                                </span>
                              </span>
                            </Tooltip>
                          </span>
                          <span
                            className={`mt-0.5 flex items-center gap-1.25 text-[11.5px] font-semibold whitespace-nowrap ${
                              STATE_TEXT[kpi.state] ?? "text-ink-4"
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`size-1.5 rounded-full ${
                                STATE_DOT[kpi.state] ?? "bg-ink-4"
                              }`}
                            />
                            {kpi.achievementPct === null
                              ? stateWord(t, kpi.state)
                              : `${kpi.achievementPct}%`}
                            {/* Beside the band, never instead of it (§6.4,
                                P9-T17b-a). */}
                            {kpi.recovering ? (
                              <span
                                data-testid="kpi-recovering"
                                className="rounded-full bg-info-bg px-1.5 text-[10px] leading-4 text-info"
                              >
                                {t("kpis.grid.recovering")}
                              </span>
                            ) : null}
                          </span>
                        </>
                      )}
                    </td>
                    {columns.map((column, index) => {
                      const record = kpi.records.find(
                        (entry) => entry.periodStart === column,
                      );
                      const actual = record?.actualValue ?? null;
                      const target =
                        record?.targetValue ?? kpi.targetDefault ?? null;
                      const tone = BAND_TONE[record?.band ?? ""] ?? "";
                      const heading = `${headings[index]?.label ?? column} ${column.slice(0, 4)}`;
                      return (
                        <td
                          key={column}
                          data-band={record?.band ?? undefined}
                          className="border-b border-line px-0.75 py-1 text-center"
                        >
                          {!isPeriodOf(kpi, column, today) ? (
                            <span className="block text-ink-4">·</span>
                          ) : (
                            <span
                              className={`block rounded-[7px] border border-transparent pt-1 pb-0.75 hover:border-line-2 focus-within:border-brand focus-within:bg-surface focus-within:ring-2 focus-within:ring-brand-line ${tone}`}
                              title={t("kpis.grid.cellTitle", {
                                period: heading,
                                value: figure(actual, language),
                                target: figure(target, language),
                              })}
                            >
                              {canEdit && !kpi.isCalculated ? (
                                <GridCell
                                  id={`cell-${kpi.id}-${column}`}
                                  label={t("kpis.grid.periodBeginning", {
                                    title: kpi.title,
                                    period: column,
                                  })}
                                  original={actual}
                                  below={record?.band === "unhealthy"}
                                  onCommit={(value) =>
                                    commit(kpi.id, column, value)
                                  }
                                  onKeyDown={(event, cell) =>
                                    onKeyDown(event, kpi.id, column, cell)
                                  }
                                />
                              ) : (
                                <span
                                  className={`block text-[13px] leading-tight font-semibold tabular-nums ${
                                    actual === null
                                      ? "font-medium text-ink-4"
                                      : record?.band === "unhealthy"
                                        ? "text-bad"
                                        : "text-ink"
                                  }`}
                                >
                                  {figure(actual, language)}
                                </span>
                              )}
                              {target !== null ? (
                                <span className="block text-[10.5px] leading-tight text-ink-4 tabular-nums">
                                  /{figure(target, language)}
                                </span>
                              ) : null}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="border-b border-line" />
                  </tr>
                );
              })}
              {canEdit ? (
                <tr>
                  <td
                    colSpan={columns.length + 4}
                    className="h-10 border-b border-line p-0"
                  >
                    <span className="sticky left-0 inline-flex px-3">
                      <AddKpiLink
                        href={addInto(category.id)}
                        label={t("kpis.grid.addTo", {
                          category: category.name,
                        })}
                      />
                    </span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          ))}
        </table>
      </div>

      {/* The phone's grid: a card per KPI. */}
      <div className="flex flex-col gap-3 md:hidden">
        {groups.map(({ category, rows }) => (
          <section
            key={category.id ?? "uncategorised"}
            aria-label={category.name}
            className="overflow-hidden rounded-xl border border-line bg-surface"
          >
            <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line bg-bg px-3 py-2.5">
              <h3 className="text-[13px] font-bold text-ink">
                {category.name}
              </h3>
              <CategorySubtotal
                states={rows.map((kpi) => kpi.state)}
                recovering={rows.filter((kpi) => kpi.recovering).length}
                count={kpiCount(t, rows.length)}
                testId="category-subtotal-phone"
              />
            </header>
            {rows.map((kpi) => {
              const latest = newest(kpi);
              const owner = ownerOf(kpi);
              const recent = columns
                .filter((column) => column <= (latest?.periodStart ?? ""))
                .slice(-3);
              return (
                <Link
                  key={kpi.id}
                  href={`/kpis/${kpi.id}`}
                  className="block border-b border-line px-3 py-3 last:border-b-0 hover:bg-bg"
                >
                  <span className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-[13px] font-semibold text-ink">
                      {kpi.title}
                    </span>
                    <Chip
                      tone={STATE_CHIP[kpi.state as "healthy"] ?? "neutral"}
                      dot
                    >
                      {stateWord(t, kpi.state)}
                    </Chip>
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3">
                    {owner ? <span className="truncate">{owner}</span> : null}
                    <Meta>{kpi.indicatorType}</Meta>
                    {kpi.unit ? <Meta>{kpi.unit}</Meta> : null}
                  </span>
                  <span className="mt-2 flex items-center gap-2.5">
                    <span className="flex items-baseline gap-1 tabular-nums">
                      <span className="text-xl font-bold text-ink">
                        {figure(latest?.actualValue ?? null, language)}
                      </span>
                      {kpi.targetDefault !== null ? (
                        <span className="text-xs text-ink-4">
                          {t("kpis.grid.targetIs", {
                            target: figure(kpi.targetDefault, language),
                          })}
                        </span>
                      ) : null}
                    </span>
                    {kpi.achievementPct !== null ? (
                      <span className="text-xs text-ink-3">
                        {kpi.achievementPct}%
                      </span>
                    ) : null}
                    <span className="ml-auto">
                      <RowSparkline
                        records={kpi.records}
                        state={kpi.state}
                        className="h-7 w-22"
                        testId={false}
                      />
                    </span>
                  </span>
                  {latest !== null ? (
                    <span className="mt-2 grid grid-cols-3 gap-1.5">
                      {recent.map((column) => {
                        const record = kpi.records.find(
                          (entry) => entry.periodStart === column,
                        );
                        const index = columns.indexOf(column);
                        return (
                          <span
                            key={column}
                            className={`rounded-[7px] py-1 text-center ${
                              BAND_TONE[record?.band ?? ""] ?? "bg-raised"
                            }`}
                          >
                            <span
                              className={`block text-[13px] font-semibold tabular-nums ${
                                record?.band === "unhealthy"
                                  ? "text-bad"
                                  : "text-ink"
                              }`}
                            >
                              {figure(record?.actualValue ?? null, language)}
                            </span>
                            <span className="block text-[10.5px] text-ink-4">
                              {headings[index]?.label}
                            </span>
                          </span>
                        );
                      })}
                    </span>
                  ) : (
                    <span className="mt-1.5 block text-xs text-ink-3">
                      {t("kpis.grid.noValuesTapToAdd")}
                    </span>
                  )}
                </Link>
              );
            })}
            {canEdit ? (
              <div className="px-3 py-2.5">
                <AddKpiLink
                  href={addInto(category.id)}
                  label={t("kpis.grid.addTo", { category: category.name })}
                />
              </div>
            ) : null}
          </section>
        ))}
      </div>

      <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-0.5 text-[11.5px] text-ink-3 max-md:hidden">
        <Swatch tone="bg-ok-bg">{stateWord(t, "healthy")}</Swatch>
        <Swatch tone="bg-warn-bg">{stateWord(t, "watch")}</Swatch>
        <Swatch tone="bg-bad-bg">{stateWord(t, "unhealthy")}</Swatch>
        <span>
          {pending
            ? t("kpis.grid.savingCalculatedReadOnly")
            : t("kpis.grid.enterCommitsCalculatedReadOnly")}
        </span>
      </p>
    </div>
  );
}

/** A band in words, from the catalogue the KPI page already uses. */
function stateWord(t: ReturnType<typeof useTranslations>["t"], state: string) {
  switch (state) {
    case "healthy":
      return t("kpis.grid.state.healthy");
    case "watch":
      return t("kpis.grid.state.watch");
    case "unhealthy":
      return t("kpis.grid.state.unhealthy");
    default:
      return t("kpis.grid.state.noData");
  }
}

/** One item of a row's meta line, after a dot. */
function Meta({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="flex flex-none items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden="true" className="text-ink-4">
        ·
      </span>
      {children}
    </span>
  );
}

function Swatch({
  tone,
  children,
}: {
  readonly tone: string;
  readonly children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.25">
      <span aria-hidden="true" className={`size-3 rounded-[3px] ${tone}`} />
      {children}
    </span>
  );
}

/** The quiet "+ Add a KPI to Customer" at the end of a category. */
function AddKpiLink({
  href,
  label,
}: {
  readonly href: string;
  readonly label: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-text hover:underline"
    >
      <span
        aria-hidden="true"
        className="grid size-4 place-items-center rounded-[5px] border border-dashed border-brand-line bg-brand-weak text-[11px] leading-none"
      >
        +
      </span>
      {label}
    </Link>
  );
}

/**
 * One cell of the grid (guided-inputs §4.8): a `NumberInput`, so a value is
 * grouped as the reader reads it and posted as the number, with the
 * spreadsheet's own keys on top. The unit is the row's, so the cell does not
 * repeat it. The arrows move between cells rather than
 * step the value: the grid's handler runs first and takes them. A value is
 * sent once, though Enter commits it and the blur that follows the move
 * would too.
 */
function GridCell({
  id,
  label,
  original,
  below,
  onCommit,
  onKeyDown,
}: {
  readonly id: string;
  readonly label: string;
  /** The recorded value, or null for none. */
  readonly original: number | null;
  /** Below the corridor, which turns the figure red as well as the cell. */
  readonly below: boolean;
  readonly onCommit: (value: number | null) => void;
  readonly onKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
    cell: { readonly commit: () => void; readonly revert: () => void },
  ) => void;
}) {
  const [draft, setDraft] = useState<number | null>(original);
  const sent = useRef<number | null>(original);
  useEffect(() => {
    setDraft(original);
    sent.current = original;
  }, [original]);
  const commit = () => {
    if (draft !== sent.current) {
      sent.current = draft;
      onCommit(draft);
    }
  };
  return (
    <NumberInput
      id={id}
      label={label}
      hideLabel
      value={draft}
      onValueChange={setDraft}
      onBlur={commit}
      onKeyDown={(event) =>
        onKeyDown(event, { commit, revert: () => setDraft(sent.current) })
      }
      placeholder="–"
      inputClassName={`h-auto w-full border-0 bg-transparent px-1 py-0 text-center text-[13px] leading-tight font-semibold tabular-nums shadow-none placeholder:font-medium placeholder:text-ink-4 focus:ring-0 focus:outline-none ${
        below ? "text-bad" : "text-ink"
      }`}
    />
  );
}
