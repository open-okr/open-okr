"use client";

import type { ReactNode, Ref } from "react";
import { Kbd } from "../components/kbd.tsx";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";

/**
 * The topbar (UIUX-PLAN.md §3): "Breadcrumb, global search (`/` focuses,
 * ⌘K opens the palette), `+ New`, Ask AI (⌘J), the live notification bell,
 * the avatar menu." Height 50px per the mockups' `.topbar`.
 *
 * `search`/`newAction`/`askAi`/`notifications`/`avatarMenu` are slots, not
 * built-in buttons: a slot that simply is not filled in is the honest state
 * for a feature that does not exist yet, rather than a button wired to
 * nothing. The palette (S-32) and live notifications (S-03) are still their
 * own unbuilt screens. `askAi` is filled now, by S-39's copilot panel from
 * `apps/web`, which is where a slot's content belongs.
 */
export interface TopbarProps {
  readonly breadcrumb: ReactNode;
  /**
   * A short mark that belongs to the whole instance, such as "Demo" (plan
   * 0.8.0 D1). Drawn after the breadcrumb and never shrunk with it, so it
   * stays at phone width.
   */
  readonly badge?: ReactNode;
  readonly search?: ReactNode;
  readonly newAction?: ReactNode;
  readonly askAi?: ReactNode;
  readonly notifications?: ReactNode;
  readonly avatarMenu?: ReactNode;
  readonly className?: string;
}

export function Topbar({
  breadcrumb,
  badge,
  search,
  newAction,
  askAi,
  notifications,
  avatarMenu,
  className,
}: TopbarProps) {
  return (
    <header
      className={cn(
        "topbar-shell flex h-12.5 flex-none items-center gap-3 border-b border-line bg-surface/80 px-4.5 backdrop-blur-md backdrop-saturate-150",
        className,
      )}
    >
      <div className="min-w-0 truncate text-sm text-ink-3">{breadcrumb}</div>
      {badge ? <div className="flex-none">{badge}</div> : null}
      {search}
      <div className="ml-auto flex items-center gap-2.5">
        {newAction}
        {askAi}
        {notifications}
        {avatarMenu}
      </div>
    </header>
  );
}

export interface TopbarSearchProps {
  readonly placeholder?: string;
  readonly inputRef?: Ref<HTMLInputElement>;
  /**
   * The page Enter sends what was typed to, as `?q=` (plan 0.7.0, U2). Left
   * out, the box searches nothing, which only a preview of the shell wants.
   */
  readonly action?: string;
}

/** `.searchbox`/`.kbd` from the mockups. With an `action`, a search form of
 * its own: the application points it at its search page, and `/` puts the
 * caret in it. */
export function TopbarSearch({
  placeholder,
  inputRef,
  action,
}: TopbarSearchProps) {
  const { t } = useTranslations();
  const box = (
    <label className="ml-3.5 hidden h-7.75 w-75 items-center gap-1.5 rounded-[9px] border border-line bg-bg px-2.5 text-sm text-ink-4 transition-colors duration-fast ease-out hover:border-line-2 sm:flex">
      <span className="sr-only">{t("shell.search.label")}</span>
      <input
        ref={inputRef}
        type="search"
        {...(action ? { name: "q" } : {})}
        placeholder={placeholder ?? t("shell.search.placeholder")}
        className="w-full bg-transparent text-ink outline-none placeholder:text-ink-4"
      />
      <Kbd className="ml-auto">⌘K</Kbd>
    </label>
  );
  // `contents`, so the form adds no box to the topbar's row.
  return action ? (
    <form action={action} className="contents">
      {box}
    </form>
  ) : (
    box
  );
}
