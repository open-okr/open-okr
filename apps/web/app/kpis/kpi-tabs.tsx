import { callAction } from "@openokr/core";
import Link from "next/link";
import type { getPool } from "../../lib/auth";
import { KPI_TABS } from "../../lib/section-tabs.tsx";

/**
 * Grid, Trees and Recovery board as tabs inside the KPI card's toolbar (KPI
 * redesign, 2 November 2026), where the Goals list keeps its scope tabs. They
 * were a row of their own above the card, which put two rows of tabs between
 * the area tabs and the grid.
 *
 * A count is drawn only where the screen already knows it; a tab without one
 * says nothing rather than guess.
 */
export function KpiTabs({
  active,
  label,
  t,
  counts = {},
}: {
  readonly active: (typeof KPI_TABS)[number]["href"];
  /** The group's accessible name. */
  readonly label: string;
  readonly t: (key: string) => string;
  readonly counts?: Partial<Record<(typeof KPI_TABS)[number]["href"], number>>;
}) {
  return (
    <nav
      aria-label={label}
      className="flex gap-0.5 overflow-x-auto [scrollbar-width:none]"
    >
      {KPI_TABS.map((tab) => {
        const open = tab.href === active;
        const count = counts[tab.href];
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={open ? "page" : undefined}
            className={`border-b-2 px-2.5 pt-2.5 pb-2.25 text-[13px] whitespace-nowrap ${
              open
                ? "border-brand font-semibold text-brand-text"
                : "border-transparent font-medium text-ink-3 hover:text-ink"
            }`}
          >
            {t(tab.labelKey)}
            {count === undefined ? null : (
              <span
                className={`ml-1 text-[11.5px] font-medium ${
                  open ? "text-brand-text/70" : "text-ink-4"
                }`}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The counts the Grid and Recovery board tabs carry, for the screens that do
 * not read the grid themselves, so the tabs read the same on all three. One
 * period is enough: only the KPIs' states are counted.
 */
export async function kpiTabCounts(context: {
  readonly pool: ReturnType<typeof getPool>;
  readonly workspaceId: string;
  readonly actor: { readonly kind: "human"; readonly userId: string };
}): Promise<Partial<Record<(typeof KPI_TABS)[number]["href"], number>>> {
  const grid = await callAction(context, "kpis.grid", { periods: 1 });
  return {
    "/kpis": grid.kpis.length,
    "/kpis/recovery": grid.kpis.filter(
      (kpi) => kpi.state === "unhealthy" || kpi.recovering,
    ).length,
  };
}
