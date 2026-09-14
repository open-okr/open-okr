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
  /**
   * The skip link's own text, translated by the caller.
   *
   * This package holds no message catalogue, so the string comes in rather
   * than being written here. It has a working default for the same reason
   * every setting does: a caller that forgets still ships a usable link
   * rather than an empty one, which would be worse than no link at all.
   */
  readonly skipToContentLabel?: string;
}

export function AppShell({
  sidebar,
  topbar,
  cycleStrip,
  mobileTabBar,
  children,
  contentClassName,
  skipToContentLabel = "Skip to content",
}: AppShellProps) {
  return (
    <div className="flex h-screen bg-bg text-ink">
      {/*
       * The skip link, and it is the first thing in the document on purpose
       * (WCAG 2.4.1, added at P7-T05).
       *
       * Without one, reaching the content by keyboard means tabbing through
       * the whole sidebar on every screen, every time. The keyboard
       * walkthrough asserts three things about it, because each is a way
       * this is commonly half-built: that the first Tab lands here, that it
       * becomes visible when focused rather than staying hidden, and that
       * activating it moves focus into `main` rather than only scrolling to
       * it. The last one is why `main` carries `tabIndex={-1}`: without
       * that, the browser scrolls and focus stays where it was, so the next
       * Tab starts from the top of the navigation again.
       */}
      <a
        href="#main-content"
        className="sr-only rounded-md bg-surface px-3 py-2 text-sm font-semibold text-ink shadow-elev-card focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:outline-2 focus:outline-brand"
      >
        {skipToContentLabel}
      </a>
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {topbar}
        {cycleStrip}
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            "flex-1 overflow-y-auto p-4.5 pb-20 md:pb-4.5 focus:outline-none",
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
