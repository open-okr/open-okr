"use client";

import { Menu } from "@base-ui-components/react/menu";
import { Avatar, Chip, initialsOf, useTranslations } from "@openokr/ui";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { startTourAgain } from "../lib/product-tour.tsx";
import { menuRowClass } from "./menu-row-class.ts";

/**
 * One row in the avatar menu.
 *
 * Exported because the sign-out row is a form submission rather than a
 * `Menu.Item` (see below), and a bare `<button>` inherits the body's 16px
 * while its neighbours sit at 13px. It shipped that way: "Sign out" was
 * visibly larger than "API tokens" above it. Two rows in one menu need one
 * source of truth for how a row looks, not two.
 */
/**
 * The topbar's avatar menu (UIUX-PLAN.md §3). Base UI's `Menu` supplies the
 * keyboard and focus behaviour (§2: "all accessibility behaviour... comes
 * from Base UI") — arrow-key navigation between items, `Escape` to close,
 * focus return to the trigger.
 */
/** A mark beside the role that changes what the person should expect. */
export type AccountBadge = "guest" | "demo" | "support";

// Whole keys rather than a template, so the catalogue coverage test sees each
// one consumed.
const BADGE_LABEL: Readonly<Record<AccountBadge, string>> = {
  guest: "avatarMenu.badge.guest",
  demo: "avatarMenu.badge.demo",
  support: "avatarMenu.badge.support",
};

export function AvatarMenu({
  name,
  avatarUrl,
  email,
  roleName,
  badge,
  items,
  signOut,
  appearance,
  sourceUrl,
}: {
  /**
   * The signed-in person's own name (plan 0.8.0 Y1). The circle showed the
   * workspace's initials, and nothing in the menu said who was signed in.
   */
  readonly name: string;
  /** Their picture, or nothing for their initials. */
  readonly avatarUrl?: string | null;
  /** The address they sign in with. */
  readonly email: string;
  /** Their role in this workspace by its name, or nothing for a guest. */
  readonly roleName?: string | null;
  readonly badge?: AccountBadge | null;
  /**
   * Where this instance's source is. AGPL-3.0 §13 asks that every person using
   * the instance over a network is offered it, so this is for every member, not
   * for administrators, and a provider who changed the code names their own. It
   * sat in the footer as "Built on OpenOKR, open source" until the owner moved it
   * here (4 November 2026).
   */
  readonly sourceUrl: string;
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
  /**
   * The theme and density control (P6-G23).
   *
   * Passed in rather than imported, so this file stays a menu: the control
   * writes to the member as well as to the browser, and the shell is where
   * that reads its current value from.
   */
  readonly appearance: ReactNode;
}) {
  const { t } = useTranslations();

  return (
    <Menu.Root>
      {/* The initials are the trigger's whole face, so they are in its name
       * too: a speech user says what they see (WCAG 2.5.3, label in name). */}
      <Menu.Trigger
        aria-label={t("avatarMenu.accountMenu", {
          name,
          initials: initialsOf(name),
        })}
        className="rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand"
        data-testid="account-menu"
      >
        <Avatar name={name} src={avatarUrl ?? undefined} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup className="min-w-45 max-w-72 rounded-lg border border-line bg-surface p-1 shadow-(--shadow-popover)">
            {/* Who is signed in, and what as (plan 0.8.0 Y1). The whole
             * header is the way to Your account. */}
            <Menu.Item
              render={<Link href="/account" />}
              className="flex flex-col items-start gap-0.5 rounded-md px-2.5 py-2 outline-none data-highlighted:bg-raised"
              data-testid="account-menu-header"
            >
              <span className="text-sm font-semibold text-ink">{name}</span>
              <span className="max-w-full truncate text-xs text-ink-3">
                {email}
              </span>
              {roleName || badge ? (
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  {roleName ? (
                    <span className="text-xs text-ink-2">{roleName}</span>
                  ) : null}
                  {badge ? (
                    <Chip
                      tone={badge === "support" ? "warn" : "info"}
                      data-testid={`account-badge-${badge}`}
                    >
                      {t(BADGE_LABEL[badge])}
                    </Chip>
                  ) : null}
                </span>
              ) : null}
            </Menu.Item>
            <Menu.Separator className="my-1 h-px bg-line" />
            {items.map((item) => (
              <Menu.Item
                key={item.href}
                render={<Link href={item.href} />}
                className={menuRowClass}
              >
                {item.label}
              </Menu.Item>
            ))}
            <Menu.Separator className="my-1 h-px bg-line" />
            {/* Not a Menu.Item either: these are buttons that stay on the
             * page rather than rows that navigate, and item semantics would
             * close the menu on the first click. */}
            {appearance}
            <Menu.Separator className="my-1 h-px bg-line" />
            {/* So an early Skip is never final (plan 0.8.0 T1). The menu
             * closes and the tour starts over from its first step. */}
            <Menu.Item
              onClick={startTourAgain}
              className={menuRowClass}
              data-testid="tour-again"
            >
              {t("tour.again")}
            </Menu.Item>
            <Menu.Item
              render={<a href={sourceUrl} target="_blank" rel="noreferrer" />}
              className={`${menuRowClass} flex items-center justify-between gap-3`}
            >
              {t("avatarMenu.sourceCode")}
              <ExternalLink
                aria-hidden="true"
                className="size-3.5 text-ink-4"
              />
            </Menu.Item>
            {/* Not a Menu.Item: signing out is a real form submission (a
             * Server Function), and Base UI's item semantics expect to be
             * the interactive element itself rather than wrap one. The row
             * styling comes from `menuRowClass` inside `SignOut` so it reads
             * as one of the rows above it. */}
            {signOut}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
