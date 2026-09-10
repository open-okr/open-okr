"use client";

import { cn } from "@openokr/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { iconFor } from "../../lib/nav-icons.tsx";

/**
 * The admin section list, and the reason it is a client component.
 *
 * **A layout does not re-render when you navigate inside it.** The row you
 * are on was read from the `x-openokr-path` request header, which is how
 * `app-shell.tsx` marks the primary rail and is correct there: every
 * top-level screen sits under a different segment layout, so moving between
 * them re-renders the shell. All nine admin cards share *this* layout, so
 * navigating from General to Invitations re-renders the page and not the
 * navigation around it. The header was read once, on whichever admin page
 * the reader loaded first, and the pill stayed there for the rest of the
 * visit. General looked like the current section from every other section.
 *
 * `usePathname` is the router's own answer to the same question and it
 * changes on every navigation, so the pill follows. The list still comes
 * from the registry on the server, access-filtered before it is handed
 * across: this component decides which row is current and nothing else.
 */

export interface AdminSection {
  readonly id: string;
  readonly label: string;
  readonly href: string;
}

export function AdminSections({
  sections,
}: {
  readonly sections: readonly AdminSection[];
}) {
  const path = usePathname() ?? "";

  return (
    <ul className="-mx-0.5 flex gap-1 overflow-x-auto px-0.5 pb-1 md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0 md:pb-0">
      {sections.map((item) => {
        const active = path === item.href || path.startsWith(`${item.href}/`);
        return (
          <li key={item.id} className="flex-none md:flex-auto">
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm font-[520] whitespace-nowrap text-ink-2",
                "transition-colors duration-fast ease-out hover:bg-ink/[0.045]",
                active &&
                  "bg-brand-weak font-[650] text-brand-text shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--brand)_12%,transparent)] hover:bg-brand-weak",
              )}
            >
              <span
                className={cn(
                  "size-4 flex-none opacity-75",
                  active && "opacity-100",
                )}
                aria-hidden="true"
              >
                {iconFor(item.id)}
              </span>
              <span className="truncate">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
