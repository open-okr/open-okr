import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

/**
 * §3: "Below 768 uses a bottom tab bar (Home, Review, Inbox, Search)."
 * Visible only below Tailwind's `md` breakpoint (768px), the same
 * boundary sidebar.tsx hides itself at, so exactly one of the two is ever
 * on screen.
 */
export interface MobileTabBarItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon: ReactNode;
  readonly active?: boolean;
}

export interface MobileTabBarProps {
  readonly items: readonly MobileTabBarItem[];
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

export function MobileTabBar({ items, linkComponent }: MobileTabBarProps) {
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
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 py-1.5 text-xs font-medium text-ink-3",
            item.active && "text-brand-600",
          )}
        >
          <span className="size-5" aria-hidden="true">
            {item.icon}
          </span>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
