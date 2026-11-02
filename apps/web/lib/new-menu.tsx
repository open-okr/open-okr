"use client";

import { Menu } from "@base-ui-components/react/menu";
import { buttonVariants, useTranslations } from "@openokr/ui";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, type ReactNode, useEffect } from "react";

/**
 * The topbar's `+ New` (UIUX-PLAN §3): one menu, the same on every screen,
 * of what this member may create (2 November 2026).
 *
 * It was a link to `/goals?new=objective` on every screen, so "+ New" on the
 * KPIs or the board made an objective somewhere else, beside each screen's
 * own way to add its thing. Now it names the things, and the one the current
 * screen is about comes first.
 *
 * **Arriving at the form.** Only an objective opens its form from the address
 * (`?new=objective`). For the others the item names the form's field by id
 * (`/kpis#title`) and, once the screen has drawn, the field takes the focus.
 * On the same screen there is no navigation at all: the field is focused at
 * once. Only a choice made here moves the focus, so a link elsewhere that
 * carries a fragment still only scrolls.
 */

export interface NewMenuItem {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  /** Where the form is, with `#id` naming the field to focus. */
  readonly href: string;
  /** Path prefixes of the screens this item belongs to, for the ordering. */
  readonly screens: readonly string[];
}

/** The field a choice from this menu is waiting to focus, across a navigation. */
let pending: string | null = null;

function focusField(id: string): boolean {
  const target = document.getElementById(id);
  if (!target) {
    return false;
  }
  // The first field a person types in: a form's hidden inputs (a server
  // action's own) cannot take the focus.
  const fields = 'input:not([type="hidden"]), textarea, select';
  const field = target.matches(fields)
    ? target
    : target.querySelector<HTMLElement>(fields);
  target.scrollIntoView({ block: "center" });
  (field ?? target).focus({ preventScroll: true });
  return true;
}

export function NewMenu({ items }: { readonly items: readonly NewMenuItem[] }) {
  const { t } = useTranslations();
  const pathname = usePathname();
  const router = useRouter();

  // A choice made on another screen focuses its field once this one draws.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the path is the trigger, a new screen to look for the field on, not a value the effect reads.
  useEffect(() => {
    if (pending === null) {
      return;
    }
    const id = pending;
    let tries = 0;
    const attempt = () => {
      if (focusField(id) || tries > 20) {
        pending = null;
        return;
      }
      tries += 1;
      window.setTimeout(attempt, 100);
    };
    attempt();
  }, [pathname]);

  const here = (item: NewMenuItem) =>
    item.screens.some(
      (screen) => pathname === screen || pathname.startsWith(`${screen}/`),
    );
  const ordered = [...items.filter(here), ...items.filter((x) => !here(x))];

  const choose = (item: NewMenuItem) => {
    const [path, id] = item.href.split("#");
    if (id && path === pathname) {
      // After the menu has closed, which hands the focus back to its trigger.
      window.setTimeout(() => focusField(id), 50);
      return;
    }
    pending = id ?? null;
    router.push(item.href);
  };

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("newMenu.trigger")}
        className={buttonVariants({ variant: "primary", size: "sm" })}
      >
        <span aria-hidden="true">+</span>
        {t("okrList.newInTopbar")}
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className="size-2.5 opacity-80"
        >
          <path
            d="m3 4.5 3 3 3-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup className="min-w-52 rounded-lg border border-line-2 bg-surface p-1 shadow-(--shadow-popover)">
            {ordered.map((item, index) => (
              <Fragment key={item.key}>
                {index > 0 &&
                here(ordered[index - 1] as NewMenuItem) &&
                !here(item) ? (
                  <Menu.Separator className="my-1 h-px bg-line" />
                ) : null}
                <Menu.Item
                  onClick={() => choose(item)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.75 text-left text-[13px] text-ink-2 outline-none data-[highlighted]:bg-brand-weak data-[highlighted]:text-brand-text"
                >
                  <span aria-hidden="true" className="size-4 flex-none">
                    {item.icon}
                  </span>
                  {item.label}
                </Menu.Item>
              </Fragment>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
