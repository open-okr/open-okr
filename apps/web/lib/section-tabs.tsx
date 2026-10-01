import Link from "next/link";
import { getTranslations } from "./translations";

/**
 * Navigation between the screens of one module (UIUX-PLAN.md §4).
 *
 * The sidebar carries one entry per module, not one per screen: Cycle, Goals,
 * KPIs, Work. That is the plan's own list, and it is what keeps the rail
 * readable as the product grows past forty screens. The cost is that a module
 * with several screens has no way to move between them, which is how the KPI
 * trees and the recovery board ended up reachable only by typing their URL.
 *
 * This is that way. One strip, at the top of every screen in a module, naming
 * its siblings. A link rather than client state, so a tab is a URL somebody can
 * send, which is the same rule the explorer's filters follow.
 */
export async function SectionTabs({
  items,
  active,
}: {
  readonly items: readonly {
    readonly href: string;
    /** A catalogue key, so the tab is named in the reader's language. */
    readonly labelKey: string;
  }[];
  /** The `href` of the screen being rendered. */
  readonly active: string;
}) {
  const { t } = await getTranslations();
  return (
    <nav
      aria-label={t("lib.sectionTabs.section")}
      className="flex flex-wrap items-center gap-1.5 border-line border-b pb-2"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.href === active ? "page" : undefined}
          className={
            item.href === active
              ? "rounded-full bg-brand-weak px-2.5 py-1 text-xs font-semibold text-brand-text"
              : "rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand"
          }
        >
          {t(item.labelKey)}
        </Link>
      ))}
    </nav>
  );
}

/** The KPI module's screens, in the order somebody works through them. */
export const KPI_TABS = [
  { href: "/kpis", labelKey: "lib.sectionTabs.grid" },
  { href: "/kpis/trees", labelKey: "lib.sectionTabs.trees" },
  { href: "/kpis/recovery", labelKey: "kpis.recovery.recoveryBoard" },
] as const;

/** The goal module's screens. The detail page is a leaf and has no tab. */
export const GOAL_TABS = [
  { href: "/goals", labelKey: "lib.sectionTabs.explorer" },
  { href: "/goals/studio", labelKey: "goals.studio.alignmentStudio" },
] as const;
