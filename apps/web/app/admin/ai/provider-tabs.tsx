"use client";

import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";

/** One provider: its tab (name and chips) and the card that tab shows. */
export interface ProviderTab {
  readonly kind: string;
  readonly label: string;
  /** The on/off and key-status chips, drawn by the server. */
  readonly chips: ReactNode;
  readonly panel: ReactNode;
}

/**
 * One row of provider tabs and the one provider card it shows (S-37).
 *
 * **Every panel stays in the page and the inactive ones are hidden**, so what
 * somebody typed into one provider's settings is still there when they come
 * back from another tab. Each tab carries the provider's chips, so which are
 * on and whether the key works shows without opening any of them.
 */
export function ProviderTabs({
  tabs,
  label,
}: {
  readonly tabs: readonly ProviderTab[];
  readonly label: string;
}) {
  const [current, setCurrent] = useState(tabs[0]?.kind ?? "");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (event: KeyboardEvent, index: number) => {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (next) {
      setCurrent(next.kind);
      refs.current[next.kind]?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1.5">
        {tabs.map((tab, index) => {
          const on = tab.kind === current;
          return (
            <button
              key={tab.kind}
              ref={(element) => {
                refs.current[tab.kind] = element;
              }}
              type="button"
              role="tab"
              id={`ai-provider-tab-${tab.kind}`}
              aria-selected={on}
              aria-controls={`ai-provider-panel-${tab.kind}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setCurrent(tab.kind)}
              onKeyDown={(event) => move(event, index)}
              className={
                on
                  ? "flex min-w-32 flex-col items-start gap-1 rounded-lg border border-brand-line bg-brand-weak px-3 py-2 text-start"
                  : "flex min-w-32 flex-col items-start gap-1 rounded-lg border border-line bg-surface px-3 py-2 text-start hover:bg-raised"
              }
            >
              <span className="text-sm font-semibold text-ink">
                {tab.label}
              </span>
              <span className="flex flex-wrap gap-1">{tab.chips}</span>
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.kind}
          role="tabpanel"
          id={`ai-provider-panel-${tab.kind}`}
          aria-labelledby={`ai-provider-tab-${tab.kind}`}
          hidden={tab.kind !== current}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
