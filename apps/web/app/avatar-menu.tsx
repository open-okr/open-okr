"use client";

import { Menu } from "@base-ui-components/react/menu";
import { Avatar } from "@openokr/ui";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The topbar's avatar menu (UIUX-PLAN.md §3). Base UI's `Menu` supplies the
 * keyboard and focus behaviour (§2: "all accessibility behaviour... comes
 * from Base UI") — arrow-key navigation between items, `Escape` to close,
 * focus return to the trigger.
 */
export function AvatarMenu({
  name,
  items,
  signOut,
}: {
  readonly name: string;
  /**
   * The account pages, in the order they appear.
   *
   * A list rather than one href per page (P5-T07a): there are three of these
   * now, and a fourth prop named after its own destination is how a menu ends
   * up with pages that exist and cannot be reached. Both channels and tokens
   * were unreachable from anywhere in the interface before this.
   */
  readonly items: readonly { readonly href: string; readonly label: string }[];
  readonly signOut: ReactNode;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Account menu"
        className="rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand"
      >
        <Avatar name={name} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup className="min-w-45 rounded-lg border border-line bg-surface p-1 shadow-(--shadow-popover)">
            {items.map((item) => (
              <Menu.Item
                key={item.href}
                render={<Link href={item.href} />}
                className="block rounded-md px-2.5 py-1.5 text-sm text-ink-2 data-highlighted:bg-raised"
              >
                {item.label}
              </Menu.Item>
            ))}
            <Menu.Separator className="my-1 h-px bg-line" />
            {/* Not a Menu.Item: signing out is a real form submission (a
             * Server Function), and Base UI's item semantics expect to be
             * the interactive element itself rather than wrap one. */}
            <div className="px-1 py-0.5">{signOut}</div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
