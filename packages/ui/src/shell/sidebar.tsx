import type { ReactNode } from "react";
import { Chip } from "../components/chip.tsx";
import { cn } from "../lib/cn.ts";

/**
 * The sidebar (UIUX-PLAN.md §3). Purely presentational: it draws whatever
 * groups it is given, in the order it is given them. Which items exist —
 * today `packages/core`'s module registry has only "Overview" and
 * "Security" under the general sidebar section, plus whatever admin items
 * a member can reach — is the caller's decision, driven by
 * `navigationFor()`, not this component's. §3's full target IA (Home,
 * Review, Inbox · Cycle, Goals, KPIs, Work · Spaces · Admin) is what this
 * component is shaped for; most of those groups render empty today because
 * the modules that would populate them (Phase 3 and 4) do not exist yet —
 * rendering them as dead links instead would be worse.
 *
 * Responsive per §3 without any JS breakpoint logic: hidden below `md`
 * (768px, the mobile tab bar takes over instead — see mobile-tab-bar.tsx),
 * an icon-only rail from `md` to below `xl` (768–1279px), full width with
 * labels from `xl` (1280px) up. These are Tailwind's own default `md`/`xl`
 * breakpoints, which happen to land exactly on §3's own numbers.
 */

export interface SidebarNavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon: ReactNode;
  readonly active?: boolean;
  /** A live count (e.g. Review's overdue badge, §3). Omitted renders no badge. */
  readonly badge?: number;
}

export interface SidebarGroup {
  readonly id: string;
  readonly label?: string;
  readonly items: readonly SidebarNavItem[];
}

export interface SidebarProps {
  readonly groups: readonly SidebarGroup[];
  readonly workspaceSwitcher: ReactNode;
  readonly footer?: ReactNode;
  readonly linkComponent?: (props: {
    href: string;
    className: string;
    children: ReactNode;
  }) => ReactNode;
}

function DefaultLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  // A caller wiring this into a router (Next's <Link>, via linkComponent)
  // is the normal path; this plain <a> only serves the preview page and
  // non-router consumers.
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

export function Sidebar({
  groups,
  workspaceSwitcher,
  footer,
  linkComponent,
}: SidebarProps) {
  const Link = linkComponent ?? DefaultLink;
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "side hidden flex-col gap-1 overflow-y-auto border-r border-line bg-surface p-2 md:flex",
        "md:w-17 xl:w-59",
      )}
    >
      <div className="mb-1 px-1">{workspaceSwitcher}</div>
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          {group.label ? (
            <div className="hidden px-2.5 pt-3.5 pb-1 text-[10.5px] font-bold tracking-wider text-ink-4 uppercase xl:block">
              {group.label}
            </div>
          ) : null}
          {group.items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-2 transition-colors duration-fast ease-out",
                "hover:bg-ink/[0.045] md:justify-center xl:justify-start",
                item.active &&
                  "bg-brand-weak font-semibold text-brand-text shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--brand)_12%,transparent)] hover:bg-brand-weak",
              )}
            >
              <span
                className={cn(
                  "relative size-[15px] flex-none opacity-75",
                  item.active && "opacity-100",
                )}
                aria-hidden="true"
              >
                {item.icon}
                {/* Below xl the rail is icons only, and the count beside the
                    label goes with the label. A dot on the icon keeps the
                    signal: a badge that disappears at laptop widths is a badge
                    that fails exactly the people it is for. The number returns
                    with the label, and the accessible name below carries it at
                    every width. */}
                {item.badge !== undefined ? (
                  <span className="absolute -top-1 -right-1 size-2 rounded-full bg-bad ring-2 ring-surface xl:hidden" />
                ) : null}
              </span>
              <span className="hidden truncate xl:inline">{item.label}</span>
              {item.badge !== undefined ? (
                <>
                  {/* Read out at every width, including the collapsed rail
                      where the dot alone says "something", not "how much". */}
                  <span className="sr-only">{item.badge} waiting on you</span>
                  <Chip
                    tone={item.active ? "brand" : "bad"}
                    className="ml-auto hidden xl:inline-flex"
                  >
                    {item.badge}
                  </Chip>
                </>
              ) : null}
            </Link>
          ))}
        </div>
      ))}
      {footer ? <div className="mt-auto pt-2">{footer}</div> : null}
    </nav>
  );
}
