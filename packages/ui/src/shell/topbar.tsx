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
 * built-in buttons: the palette (S-32), Ask AI (S-39) and live
 * notifications (S-03) are each their own unbuilt screen, and a slot that
 * simply is not filled in is the honest state for a feature that does not
 * exist yet, rather than a button wired to nothing.
 */
export interface TopbarProps {
  readonly breadcrumb: ReactNode;
  readonly search?: ReactNode;
  readonly newAction?: ReactNode;
  readonly askAi?: ReactNode;
  readonly notifications?: ReactNode;
  readonly avatarMenu?: ReactNode;
  readonly className?: string;
}

export function Topbar({
  breadcrumb,
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
}

/** `.searchbox`/`.kbd` from the mockups. A plain input today: it has
 * nowhere to search yet (S-32's own palette and index are unbuilt), so it
 * renders the affordance without pretending to be wired to results. */
export function TopbarSearch({ placeholder, inputRef }: TopbarSearchProps) {
  const { t } = useTranslations();
  return (
    <label className="ml-3.5 hidden h-7.75 w-75 items-center gap-1.5 rounded-[9px] border border-line bg-bg px-2.5 text-sm text-ink-4 transition-colors duration-fast ease-out hover:border-line-2 sm:flex">
      <span className="sr-only">{t("shell.search.label")}</span>
      <input
        ref={inputRef}
        type="search"
        placeholder={placeholder ?? t("shell.search.placeholder")}
        className="w-full bg-transparent text-ink outline-none placeholder:text-ink-4"
      />
      <Kbd className="ml-auto">⌘K</Kbd>
    </label>
  );
}
