import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

/**
 * `.strip` from the mockups (UIUX-PLAN.md §3): "When a cycle is in
 * planning, a slim persistent strip sits under the topbar: the phase
 * name, what is blocking it, and the days until the publication
 * deadline. It disappears once the cycle is published and running."
 *
 * A placeholder in this task, per its own card: no cycle exists yet
 * (that is P3-T03), so nothing in `apps/web` renders this with real data
 * today. The component itself is the specification §3 asks for — the
 * caller's job is simply not rendering it when there is no cycle in
 * planning, which "no cycle exists at all" already satisfies.
 */
export interface CycleStripProps {
  readonly phase: string;
  readonly blocking?: ReactNode;
  readonly dueInDays: number;
  readonly className?: string;
}

export function CycleStrip({
  phase,
  blocking,
  dueInDays,
  className,
}: CycleStripProps) {
  return (
    <div
      className={cn(
        // The three hand-mixed indigo tints this strip used to carry are
        // gone: they were the light theme's brand hue written out by hand,
        // so they survived a theme change and a workspace brand override
        // unchanged. --brand-weak fading to --surface gets the same wash
        // from tokens that follow both.
        "cycle-strip flex flex-none items-center gap-3 border-b border-brand-line bg-gradient-to-r from-brand-weak to-surface px-4.5 py-1.5 text-sm text-brand-text",
        className,
      )}
    >
      <span className="rounded-full border border-brand-line bg-surface/80 px-2.5 py-px font-bold shadow-control">
        {phase}
      </span>
      {blocking ? (
        <>
          <span className="text-brand-line">·</span>
          <span className="font-semibold text-warn">{blocking}</span>
        </>
      ) : null}
      <span className="ml-auto font-bold">
        {dueInDays === 0
          ? "Due today"
          : dueInDays > 0
            ? `${dueInDays} day${dueInDays === 1 ? "" : "s"} to publish`
            : `${Math.abs(dueInDays)} day${dueInDays === -1 ? "" : "s"} overdue`}
      </span>
    </div>
  );
}
