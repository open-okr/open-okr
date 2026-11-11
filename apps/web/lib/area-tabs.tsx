import { cn } from "@openokr/ui";
import Link from "next/link";

/**
 * The screens inside one sidebar area, as tabs (navigation-five-areas.md,
 * OKRGoal UX review N1 and N2).
 *
 * Fifteen sidebar rows became five areas. The screens did not move: each tab
 * is a link to the route it always had, so a link in an email or a
 * bookmark still lands, and the area's sidebar row stays lit through the
 * registry's `parent`. `Link` rather than `<a>`, so switching tabs fetches
 * the screen alone instead of reloading the whole document.
 */
export const AREAS = {
  updates: [
    { href: "/review", key: "areaTabs.updates.toDo" },
    { href: "/inbox", key: "areaTabs.updates.activity" },
  ],
  goals: [
    { href: "/goals", key: "areaTabs.goals.okrs" },
    { href: "/kpis", key: "areaTabs.goals.kpis" },
    // The company tree, which was everybody's Home until the role homes.
    { href: "/map", key: "areaTabs.goals.map" },
  ],
  work: [
    { href: "/initiatives", key: "areaTabs.work.initiatives" },
    // Named for what it holds, the tasks, which the board shows by status
    // (UIUX-PLAN §8, Akmal, 11 November 2026). The address stays /board.
    { href: "/board", key: "areaTabs.work.tasks" },
  ],
} as const;

export type Area = keyof typeof AREAS;

/** Each area's name, written out so the catalogue coverage test can see it. */
const AREA_NAMES: Readonly<Record<Area, string>> = {
  updates: "areaTabs.updates",
  goals: "areaTabs.goals",
  work: "areaTabs.work",
};

export function AreaTabs({
  area,
  current,
  t,
}: {
  readonly area: Area;
  /** The route this screen is, which is the tab marked as open. */
  readonly current: string;
  readonly t: (key: string) => string;
}) {
  return (
    <nav
      aria-label={t(AREA_NAMES[area])}
      className="mb-3.5 flex gap-1 border-b border-line"
    >
      {AREAS[area].map((tab) => {
        const open = tab.href === current;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={open ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              open
                ? "border-brand font-semibold text-brand-text"
                : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
