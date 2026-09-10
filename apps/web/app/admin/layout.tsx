import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import { cn } from "@openokr/ui";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAccessLevel } from "../../lib/access.ts";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { iconFor } from "../../lib/nav-icons.tsx";
import { getTranslations } from "../../lib/translations";

/**
 * The admin shell (screen S-36 skeleton, P2-T08, restyled P2-T10).
 *
 * Two levels: this layout is the left-hand section navigation, and each
 * page under it is one card on the right with its own save. Gated once here
 * rather than in every page: a member below `full` never reaches anything
 * this layout wraps, which is the "route is denied" half of the P2-T08
 * acceptance criterion. `navigationFor` supplies the "item is hidden" half,
 * filtering the section list itself to what this member's own level
 * reaches — today that is every admin item, because every one of them
 * requires `full`, but a lower-requirement card added later is hidden here
 * without this file changing.
 *
 * This is a *second*, nested navigation, distinct from the primary
 * sidebar's own single "Admin" link (`app-shell.tsx`): the primary sidebar
 * never expands a submenu for it, matching §3's diagram, which shows
 * "Admin" as one row with no visible children.
 *
 * **It borrows the primary sidebar's row grammar rather than inventing a
 * second one.** The same 8px radius, the same 16px icon at three quarters
 * opacity, the same `bg-brand-weak` pill with its hairline inset ring for the
 * row you are on. A reader who has learned the left rail should not have to
 * learn a different vocabulary 200 pixels to its right. What it does not
 * borrow is the panel: the rail sits on a gradient with a border because it
 * bounds the window, and a second bounded panel inside the content area would
 * read as two sidebars arguing. This one is transparent and the gap does the
 * separating, which is the mockups' own two-column composition.
 *
 * **The row you are on was the missing half.** Nine labels rendered in one
 * uniform weight with no active state at all, so the section navigation could
 * not answer the one question a section navigation exists to answer. The path
 * arrives as a request header from `proxy.ts`, the same way `app-shell.tsx`
 * marks the primary rail, because a server component cannot ask the router
 * where it is.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = await getTranslations();

  const access = await requireAccessLevel(ACCESS_LEVELS.full);
  const sections = navigationFor("admin", access.level);
  const path = (await headers()).get("x-openokr-path") ?? "";

  return (
    <AppShellLayout>
      {/* The mockups' own composition: a fixed side column and a flexible
       * pane (`02-cycle-workspace` is `250px 1fr`), filling the body rather
       * than centred inside it. This nav plus content was already the right
       * shape; the `mx-auto max-w-3xl` around it made admin the narrowest
       * screen in the product, a 160px nav and 580px of content on a 1920px
       * display.
       *
       * Below `md` it stacks, because that is where the primary sidebar hands
       * over to the mobile tab bar and a 208px column would otherwise be half
       * a phone. Stacked, the sections are a scrolling strip rather than nine
       * stacked rows: a reader on a phone should meet the card they came for,
       * not scroll past the whole menu to reach it. */}
      <div className="flex flex-col gap-4 md:flex-row md:gap-8">
        <nav
          aria-label={t("admin.layout.adminSections")}
          // Sticky from `md` up, so the sections stay put while a long card
          // scrolls. Agents and runs, Invitations and Import all outrun the
          // viewport, and losing the navigation halfway down a list is how a
          // reader ends up using the browser's back button as a menu.
          className="md:sticky md:top-0 md:w-52 md:flex-none md:self-start"
        >
          <h2 className="mb-1 hidden px-2.5 text-[10.5px] font-bold tracking-wider text-ink-4 uppercase md:block">
            {t("admin.layout.admin")}
          </h2>
          <ul className="-mx-0.5 flex gap-1 overflow-x-auto px-0.5 pb-1 md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0 md:pb-0">
            {sections.map((item) => {
              const active =
                path === item.href || path.startsWith(`${item.href}/`);
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
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </AppShellLayout>
  );
}
