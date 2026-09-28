import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";
import { MobileMore } from "./mobile-more.tsx";

/**
 * §3: "Below 768 uses a bottom tab bar (Home, Review, Inbox, Search)."
 * Visible only below Tailwind's `md` breakpoint (768px), the same
 * boundary sidebar.tsx hides itself at, so exactly one of the two is ever
 * on screen.
 *
 * **Everything else is one tap away, under More** (completeness review
 * H-16). The bar carried the first four sidebar items and nothing else, and
 * the sidebar is hidden at this width, so on a phone KPIs, Spaces, the board,
 * initiatives and admin could only be reached by typing an address.
 * REQUIREMENTS §9 says the responsive web app is how v1 covers mobile. The
 * sheet lists every destination the sidebar would have, in the sidebar's own
 * groups.
 *
 * This file stays server-safe, like sidebar.tsx, so a server component can
 * hand it a router's link component. Only the toggle is a client island, and
 * it receives the links already drawn.
 */
export interface MobileTabBarItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon: ReactNode;
  readonly active?: boolean;
}

export interface MobileTabBarGroup {
  readonly id: string;
  readonly label?: string;
  readonly items: readonly MobileTabBarItem[];
}

export interface MobileTabBarProps {
  readonly items: readonly MobileTabBarItem[];
  /** Everything else, shown under a More tab. Absent draws no More tab. */
  readonly more?: {
    readonly label: string;
    readonly icon: ReactNode;
    readonly groups: readonly MobileTabBarGroup[];
  };
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
  // Overridden with a router's own link component in every real caller;
  // see sidebar.tsx's identical note.
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

const TAB =
  "flex flex-1 flex-col items-center gap-0.5 py-1.5 text-xs font-medium text-ink-3";

export function MobileTabBar({
  items,
  more,
  linkComponent,
}: MobileTabBarProps) {
  const Link = linkComponent ?? DefaultLink;
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-10 flex h-14 flex-none items-center justify-around border-t border-line bg-surface md:hidden"
    >
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className={cn(TAB, item.active && "text-brand-text")}
        >
          <span className="size-5" aria-hidden="true">
            {item.icon}
          </span>
          {item.label}
        </Link>
      ))}
      {more ? (
        <MobileMore
          label={more.label}
          icon={more.icon}
          className={TAB}
          active={more.groups.some((group) =>
            group.items.some((item) => item.active),
          )}
        >
          {more.groups.map((group) => (
            <div key={group.id} className="py-1.5">
              {group.label ? (
                <p className="px-2 pb-1 text-xs font-bold tracking-wide text-ink-4 uppercase">
                  {group.label}
                </p>
              ) : null}
              <ul className="flex flex-col">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-md px-2 text-sm font-medium text-ink-2",
                        item.active && "bg-brand-weak text-brand-text",
                      )}
                    >
                      <span className="size-5" aria-hidden="true">
                        {item.icon}
                      </span>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </MobileMore>
      ) : null}
    </nav>
  );
}
