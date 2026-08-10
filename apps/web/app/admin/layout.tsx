import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAccessLevel } from "../../lib/access.ts";
import { AppShellLayout } from "../../lib/app-shell.tsx";

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
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await requireAccessLevel(ACCESS_LEVELS.full);
  const sections = navigationFor("admin", access.level);

  return (
    <AppShellLayout>
      <div className="mx-auto flex max-w-3xl gap-8">
        <nav aria-label="Admin sections" className="w-40 flex-none">
          <h2 className="mb-2 text-xs font-bold tracking-wider text-ink-4 uppercase">
            Admin
          </h2>
          <ul className="flex flex-col gap-0.5">
            {sections.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="block rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-2 hover:bg-raised"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </AppShellLayout>
  );
}
