"use client";

import { Tooltip, useTranslations } from "@openokr/ui";
import Link from "next/link";
import { type ReactNode, useState } from "react";

/**
 * The OKRs toolbar (Goals revamp, 2 November 2026): whose objectives as tabs
 * on the left, and on the right one Filter button, the display as three
 * icons and Export. The filters open as a panel under it, one labelled row
 * per question; closed, the ones in force show as chips that each take one
 * filter away.
 *
 * **Only the open state lives here.** Every tab, option and chip is a link
 * the server drew, so the state is the address and a link to it opens the
 * same list. A choice reloads the page, which is why the panel opens on its
 * own while any filter is set: closing it after every press would hide the
 * next one. Done closes it and leaves the chips.
 */
export function GoalsToolbar({
  tabs,
  display,
  exportControl,
  panel,
  chips,
  clearAll,
  activeCount,
  trailing,
}: {
  /** The scope tabs, a named group of links. */
  readonly tabs: ReactNode;
  /** The displays, drawn here as icons each with its tooltip. None on KPIs. */
  readonly display?: {
    readonly label: string;
    readonly options: readonly {
      readonly key: "list" | "diagram" | "tree";
      readonly href: string;
      readonly label: string;
      readonly on: boolean;
    }[];
  };
  readonly exportControl?: ReactNode;
  /**
   * The panel's rows, without its foot. Null draws no Filter button, for a
   * screen of the same area with nothing to filter (the KPI trees).
   */
  readonly panel: ReactNode;
  /** The filters in force as chips, or null when none is. */
  readonly chips: ReactNode;
  /** The link that takes every filter away, or null when none is set. */
  readonly clearAll: ReactNode;
  readonly activeCount: number;
  /** Drawn after the controls, such as the KPI grid's keyboard hint. */
  readonly trailing?: ReactNode;
}) {
  const { t } = useTranslations();
  const [open, setOpen] = useState(activeCount > 0);

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-2.5 border-b border-line px-4 max-md:px-3">
        <div className="-mb-px flex min-w-0 max-md:order-2 max-md:w-full">
          {tabs}
        </div>
        {panel || display || exportControl || trailing ? (
          <div className="ml-auto flex items-center gap-2 py-1.75 max-md:w-full max-md:pt-2.5 max-md:pb-1">
            {panel ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls="goals-filter-panel"
                onClick={() => setOpen((now) => !now)}
                className={`inline-flex h-7.5 items-center gap-1.5 rounded-control border px-2.75 text-[12.5px] font-semibold whitespace-nowrap max-md:mr-auto ${
                  open
                    ? "border-brand-line bg-brand-weak text-brand-text"
                    : "border-line-2 bg-surface text-ink-2 hover:border-ink-4"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                  className="size-3.25"
                >
                  <path d="M3 5h18l-7 8v6l-4-2v-4z" />
                </svg>
                {/* The count is a badge beside the word, not part of a sentence a
                 * translator would order, so the two are separate elements. */}
                <span>{t("goals.filter.label")}</span>
                {activeCount > 0 ? (
                  <span className="grid h-4.5 min-w-4.5 place-items-center rounded-full bg-brand px-1.25 text-[10.5px] font-bold text-on-brand">
                    <span className="sr-only">, </span>
                    {activeCount}
                  </span>
                ) : null}
              </button>
            ) : null}
            {display ? (
              <fieldset
                aria-label={display.label}
                className="inline-flex h-7.5 gap-0.5 rounded-control bg-raised p-0.75"
              >
                {display.options.map((option) => (
                  <Tooltip key={option.key} label={option.label}>
                    <Link
                      href={option.href}
                      aria-current={option.on ? "true" : undefined}
                      className={`grid w-7 place-items-center rounded-md ${
                        option.on
                          ? "bg-surface text-brand-text shadow-control"
                          : "text-ink-3 hover:text-ink"
                      }`}
                    >
                      <span className="sr-only">{option.label}</span>
                      {DISPLAY_ICON[option.key]}
                    </Link>
                  </Tooltip>
                ))}
              </fieldset>
            ) : null}
            {exportControl}
            {trailing}
          </div>
        ) : null}
      </div>
      {open && panel ? (
        <div
          id="goals-filter-panel"
          className="grid grid-cols-1 items-center gap-x-3.5 gap-y-2.5 border-b border-line px-4 pt-3.5 pb-3 md:grid-cols-[92px_minmax(0,1fr)] max-md:gap-y-1.5 max-md:px-3"
        >
          {panel}
          <div className="flex items-center justify-end gap-2 border-t border-line pt-2.5 md:col-span-2">
            {clearAll}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-7.5 items-center rounded-control border border-line-2 bg-surface px-2.75 text-[12.5px] font-semibold text-ink-2 hover:border-ink-4"
            >
              {t("goals.filter.done")}
            </button>
          </div>
        </div>
      ) : chips ? (
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 max-md:px-3">
          {chips}
          {clearAll}
        </div>
      ) : null}
    </>
  );
}

const ICON_CLASS = "size-3.5";

const DISPLAY_ICON = {
  list: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className={ICON_CLASS}
    >
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  ),
  diagram: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className={ICON_CLASS}
    >
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v4M6 16v-4h12v4" />
    </svg>
  ),
  tree: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className={ICON_CLASS}
    >
      <path d="M4 5h6M8 12h6M8 19h6M6 5v14M6 12h2M6 19h2" />
    </svg>
  ),
} as const;
