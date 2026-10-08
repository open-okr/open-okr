"use client";

import { type KpiFrequency, normalisePeriod } from "@openokr/method";
import { useTranslations } from "@openokr/ui";
import { useState, useTransition } from "react";
import { recordCell } from "./actions.ts";

/**
 * The KPI grid (UIUX-PLAN.md §4 S-20, P3-T12).
 *
 * KPIs as rows, periods as columns, driven by each KPI's own frequency. Each cell
 * holds the actual against its target with a corridor background.
 *
 * **Keyboard first, because this is a data-entry screen.** Enter commits the cell
 * and moves down, the arrows move without committing, Escape restores what was
 * there. A grid that needed the mouse for every cell would be slower than the
 * spreadsheet it is meant to replace, and somebody would go back to the
 * spreadsheet.
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
 * The colour of one cell, from the band the server read for that period by
 * the KPI's own rule (P9-T17a). It used to work the ratio out here, which was
 * a second copy of §6.4 and the wrong answer for a KPI with thresholds.
 */
const BAND_TONE: Readonly<Record<string, string>> = {
  healthy: "bg-ok-bg",
  watch: "bg-warn-bg",
  unhealthy: "bg-bad-bg",
};

const STATE_TONE: Readonly<Record<string, string>> = {
  healthy: "text-ok",
  watch: "text-warn",
  unhealthy: "text-bad",
  recovering: "text-brand-text",
  no_data: "text-ink-4",
};

export function KpiGrid({
  categories,
  kpis,
  canEdit,
  today,
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
}) {
  const { t } = useTranslations();

  const columns = columnsFor(kpis, today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const commit = (kpiId: string, periodStart: string, raw: string): void => {
    const text = raw.trim();
    setError(null);
    startTransition(async () => {
      const state = await recordCell(
        kpiId,
        periodStart,
        text === "" ? null : Number(text),
      );
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
    original: string,
  ): void => {
    const move = (rowDelta: number, columnDelta: number): void => {
      const rowIndex = kpis.findIndex((kpi) => kpi.id === kpiId);
      const columnIndex = columns.indexOf(periodStart);
      const nextRow = kpis[rowIndex + rowDelta];
      const nextColumn = columns[columnIndex + columnDelta];
      if (!nextRow || !nextColumn) {
        return;
      }
      document.getElementById(`cell-${nextRow.id}-${nextColumn}`)?.focus();
    };

    switch (event.key) {
      case "Enter":
        event.preventDefault();
        commit(kpiId, periodStart, event.currentTarget.value);
        move(1, 0);
        break;
      case "Escape":
        event.preventDefault();
        event.currentTarget.value = original;
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
      <p className="p-3 text-sm text-ink-3">{t("kpis.grid.noKpisYetA")}</p>
    );
  }

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
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">{t("kpis.grid.kpisAsRowsAnd")}</caption>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-surface p-2 text-left font-bold text-ink-2">
                {t("kpis.grid.kpi")}
              </th>
              <th className="p-2 text-right font-bold text-ink-2">
                {t("kpis.grid.now")}
              </th>
              {columns.map((column) => (
                <th
                  key={column}
                  className="p-2 text-right font-semibold text-ink-3"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          {categories.map((category) => {
            const rows = kpis.filter((kpi) => kpi.categoryId === category.id);
            if (rows.length === 0) {
              return null;
            }
            return (
              <tbody key={category.id ?? "uncategorised"}>
                <tr>
                  <th
                    colSpan={columns.length + 2}
                    className="bg-raised p-1.5 text-left text-xs font-bold uppercase tracking-wide text-ink-3"
                  >
                    {category.name}
                  </th>
                </tr>
                {rows.map((kpi) => (
                  <tr key={kpi.id} className="border-t border-line">
                    <th className="sticky left-0 z-10 bg-surface p-2 text-left font-normal">
                      <span className="flex flex-col">
                        <a
                          href={`/kpis/${kpi.id}`}
                          className="font-semibold text-ink hover:text-brand-text hover:underline"
                        >
                          {kpi.title}
                        </a>
                        <span className="text-ink-4">
                          {kpi.frequency} · {kpi.direction.replace("_", " ")} ·{" "}
                          {kpi.indicatorType}
                          {kpi.tier ? ` · ${kpi.tier}` : ""}
                          {kpi.unit ? ` · ${kpi.unit}` : ""}
                          {kpi.isCalculated ? (
                            <> · {t("kpis.grid.calculated")}</>
                          ) : null}
                        </span>
                      </span>
                    </th>
                    <td
                      data-state={kpi.state}
                      className={`p-2 text-right font-semibold ${
                        STATE_TONE[kpi.state] ?? "text-ink-4"
                      }`}
                    >
                      {kpi.achievementPct === null
                        ? kpi.state.replace("_", " ")
                        : `${kpi.achievementPct}%`}
                      {/* Beside the band, never instead of it (§6.4,
                          P9-T17b-a). */}
                      {kpi.recovering ? (
                        <span
                          data-testid="kpi-recovering"
                          className="block text-[10px] font-semibold text-brand-text"
                        >
                          {t("kpis.grid.recovering")}
                        </span>
                      ) : null}
                    </td>
                    {columns.map((column) => {
                      const record = kpi.records.find(
                        (entry) => entry.periodStart === column,
                      );
                      const actual = record?.actualValue ?? null;
                      const original = actual === null ? "" : String(actual);
                      return (
                        <td
                          key={column}
                          data-band={record?.band ?? undefined}
                          className={`p-0.5 ${
                            BAND_TONE[record?.band ?? ""] ?? "bg-surface"
                          }`}
                        >
                          {!isPeriodOf(kpi, column, today) ? (
                            <span className="block px-1.5 py-1 text-right text-ink-4">
                              ·
                            </span>
                          ) : canEdit && !kpi.isCalculated ? (
                            <input
                              id={`cell-${kpi.id}-${column}`}
                              defaultValue={original}
                              inputMode="decimal"
                              aria-label={t("kpis.grid.periodBeginning", {
                                title: kpi.title,
                                period: column,
                              })}
                              onKeyDown={(event) =>
                                onKeyDown(event, kpi.id, column, original)
                              }
                              onBlur={(event) => {
                                if (event.currentTarget.value !== original) {
                                  commit(
                                    kpi.id,
                                    column,
                                    event.currentTarget.value,
                                  );
                                }
                              }}
                              className="w-16 bg-transparent px-1.5 py-1 text-right text-ink focus:outline focus:outline-2 focus:outline-brand-strong"
                            />
                          ) : (
                            <span className="block px-1.5 py-1 text-right text-ink-2">
                              {original || "—"}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
      <p className="text-xs text-ink-4">
        {pending
          ? t("kpis.grid.savingCalculatedReadOnly")
          : t("kpis.grid.enterCommitsCalculatedReadOnly")}
      </p>
    </div>
  );
}
