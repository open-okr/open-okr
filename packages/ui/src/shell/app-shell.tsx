import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

/**
 * Composes sidebar, topbar, the optional cycle strip and the mobile tab
 * bar into the §3 layout: `sidebar | topbar; content` on desktop, a
 * bottom tab bar with no sidebar below 768px. Each region is a slot —
 * this component only owns the grid, never the navigation content.
 */
export interface AppShellProps {
  readonly sidebar: ReactNode;
  readonly topbar: ReactNode;
  readonly cycleStrip?: ReactNode;
  readonly mobileTabBar: ReactNode;
  readonly children: ReactNode;
  /** §3: "the Work Map and lists become card lists" below 768px — a
   * screen opts a content region into that by passing padding classes
   * through here rather than this component guessing at content shape. */
  readonly contentClassName?: string;
}

export function AppShell({
  sidebar,
  topbar,
  cycleStrip,
  mobileTabBar,
  children,
  contentClassName,
}: AppShellProps) {
  return (
    <div className="flex h-screen bg-bg text-ink">
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {topbar}
        {cycleStrip}
        <main
          className={cn(
            "flex-1 overflow-y-auto p-4.5 pb-20 md:pb-4.5",
            contentClassName,
          )}
        >
          {children}
        </main>
      </div>
      {mobileTabBar}
    </div>
  );
}
