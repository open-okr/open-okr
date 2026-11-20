"use client";

import { useDirection } from "@base-ui-components/react/direction-provider";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { horizontalArrowStep } from "../../../lib/reading-direction.ts";

/** One agent: its tab (face, name and chips) and the cards that tab shows. */
export interface AgentTab {
  readonly id: string;
  readonly label: string;
  /** The agent's face, drawn by the server. */
  readonly face: ReactNode;
  /** The on/off, schedule and write policy chips, drawn by the server. */
  readonly chips: ReactNode;
  readonly panel: ReactNode;
}

/**
 * One row of agent tabs and the cards of the one agent it shows (S-36, S-38).
 *
 * **Every panel stays in the page and the inactive ones are hidden**, so a
 * write policy somebody picked, or instructions somebody typed, are still
 * there when they come back from another tab. Each tab carries the agent's
 * chips, so which agents are on, how often they run and what they may write
 * shows without opening any of them.
 */
export function AgentTabs({
  tabs,
  label,
}: {
  readonly tabs: readonly AgentTab[];
  readonly label: string;
}) {
  const direction = useDirection();
  const [current, setCurrent] = useState(tabs[0]?.id ?? "");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (event: KeyboardEvent, index: number) => {
    const step = horizontalArrowStep(event.key, direction);
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (next) {
      setCurrent(next.id);
      refs.current[next.id]?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1.5">
        {tabs.map((tab, index) => {
          const on = tab.id === current;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                refs.current[tab.id] = element;
              }}
              type="button"
              role="tab"
              id={`agent-tab-${tab.id}`}
              aria-selected={on}
              aria-controls={`agent-panel-${tab.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setCurrent(tab.id)}
              onKeyDown={(event) => move(event, index)}
              className={
                on
                  ? "flex min-w-32 flex-col items-start gap-1 rounded-lg border border-brand-line bg-brand-weak px-3 py-2 text-start"
                  : "flex min-w-32 flex-col items-start gap-1 rounded-lg border border-line bg-surface px-3 py-2 text-start hover:bg-raised"
              }
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                {tab.face}
                {tab.label}
              </span>
              <span className="flex flex-wrap gap-1">{tab.chips}</span>
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`agent-panel-${tab.id}`}
          aria-labelledby={`agent-tab-${tab.id}`}
          hidden={tab.id !== current}
          className="flex flex-col gap-4"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
