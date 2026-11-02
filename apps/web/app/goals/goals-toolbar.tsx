"use client";

import { useTranslations } from "@openokr/ui";
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
}: {
  /** The scope tabs, a named group of links. */
  readonly tabs: ReactNode;
  /** The display icons, a named group of links. */
  readonly display: ReactNode;
  readonly exportControl: ReactNode;
  /** The panel's rows, without its foot. */
  readonly panel: ReactNode;
  /** The filters in force as chips, or null when none is. */
  readonly chips: ReactNode;
  /** The link that takes every filter away, or null when none is set. */
  readonly clearAll: ReactNode;
  readonly activeCount: number;
}) {
  const { t } = useTranslations();
  const [open, setOpen] = useState(activeCount > 0);

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-2.5 border-b border-line px-4 max-md:px-3">
        <div className="-mb-px flex min-w-0 max-md:order-2 max-md:w-full">
          {tabs}
        </div>
        <div className="ml-auto flex items-center gap-2 py-1.75 max-md:w-full max-md:pt-2.5 max-md:pb-1">
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
          {display}
          {exportControl}
        </div>
      </div>
      {open ? (
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
