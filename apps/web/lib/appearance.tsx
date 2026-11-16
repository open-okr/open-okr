"use client";

import { Tooltip, useTheme, useTranslations } from "@openokr/ui";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { setAppearance } from "./appearance-action.ts";

/**
 * Theme and density, on the member rather than on the browser (P6-G23,
 * GAP-AUDIT G-09).
 *
 * **`setTheme` and `setDensity` have existed since P2-T10 and nothing ever
 * called them.** UIUX-PLAN §9 asks every interface task to verify both themes
 * and both densities, and neither state was reachable from the product: the
 * only way into dark mode was to change the operating system.
 *
 * **Written twice, on purpose.** The provider applies the change now and
 * stores it where the pre-hydration script reads it, so there is no flash on
 * the next load. The action stores it on the member, so the choice follows
 * them to another machine. Neither alone is the whole answer: a server-only
 * write would flash, and a browser-only write is what this task exists to fix.
 */

/** Each theme as an icon, its word its name and tooltip (Akmal, 11 November 2026). */
const THEMES = [
  { value: "light", label: "appearance.light", icon: <Sun /> },
  { value: "dark", label: "appearance.dark", icon: <Moon /> },
  { value: "system", label: "appearance.system", icon: <Monitor /> },
] as const;

const DENSITIES = [
  { value: "comfortable", label: "appearance.comfortable" },
  { value: "compact", label: "appearance.compact" },
] as const;

/**
 * The locales with a catalogue (P6-G22a).
 *
 * A literal list rather than `CATALOGUES`, because this is a client component
 * and importing a value from the catalogue module would pull it into the
 * bundle. The keys it would give are the same two, and `catalogue.test.tsx`
 * fails if a locale is added without a stub, so a third one cannot arrive
 * unnoticed.
 */
const LANGUAGES = [
  { value: "en", label: "appearance.english" },
  { value: "ms", label: "appearance.bahasaMelayu" },
] as const;

export function AppearanceControl({
  compact = false,
  language = null,
  layout = "stack",
}: {
  /** Laid out for the avatar menu rather than for a settings card. */
  readonly compact?: boolean;
  /**
   * `grid` is the account page's: theme, language and density side by side on
   * the 12-column grid (docs/design/settings-page-layout.md §E), each control
   * filling its column. The default is the menu's and the old card's stack.
   */
  readonly layout?: "stack" | "grid";
  /**
   * The member's stored language, or null for "follow the workspace"
   * (P6-G22a). Passed in from the server, because unlike the theme there is
   * no provider holding it: the catalogue is chosen while the page renders.
   */
  readonly language?: "en" | "ms" | null;
}) {
  const { t } = useTranslations();
  const { theme, density, setTheme, setDensity } = useTheme();
  const [problem, setProblem] = useState<string | null>(null);
  const [pendingLanguage, setPendingLanguage] = useState<"en" | "ms" | null>(
    language,
  );

  const grid = layout === "grid";
  const fieldset = grid
    ? "col-span-12 flex flex-col gap-1.5 lg:col-span-4"
    : "flex flex-col gap-1";
  const legend = grid
    ? "text-sm font-semibold text-ink-2"
    : "text-xs font-semibold text-ink-3";
  const group = grid ? "flex w-full gap-1.5" : "flex gap-1.5";
  const grow = grid ? "flex-1 justify-center" : "";

  const remember = (input: Parameters<typeof setAppearance>[0]) => {
    void setAppearance(input).then((result) => setProblem(result.error));
  };

  return (
    <div
      className={
        compact
          ? "flex flex-col gap-2 px-2 py-1.5"
          : grid
            ? "grid grid-cols-12 gap-x-6 gap-y-4"
            : "flex flex-col gap-3.5"
      }
    >
      <fieldset className={fieldset}>
        <legend className={legend}>{t("appearance.theme")}</legend>
        <div className={group}>
          {THEMES.map((option) => (
            <Tooltip key={option.value} label={t(option.label)}>
              <button
                type="button"
                data-testid={`theme-${option.value}`}
                aria-label={t(option.label)}
                aria-pressed={theme === option.value}
                onClick={() => {
                  setTheme(option.value);
                  remember({ theme: option.value });
                }}
                className={
                  theme === option.value
                    ? `flex h-8 items-center justify-center rounded-md border border-brand-600 bg-brand text-on-brand [&>svg]:size-4 ${grid ? "flex-1" : "w-8"}`
                    : `flex h-8 items-center justify-center rounded-md border border-line text-ink-2 hover:border-ink-4 [&>svg]:size-4 ${grid ? "flex-1" : "w-8"}`
                }
              >
                {option.icon}
              </button>
            </Tooltip>
          ))}
        </div>
      </fieldset>

      {/*
       * Which catalogue renders (§8, P6-G22a).
       *
       * **Not in the compact menu.** A theme applies the instant it is
       * clicked, so it belongs anywhere. A language does not: the text comes
       * from the server, so choosing one navigates, and a control that
       * navigates does not belong in a dropdown somebody opened to change
       * something else.
       */}
      {compact ? null : (
        <fieldset className={fieldset}>
          <legend className={legend}>
            {t("admin.general.generalSettingsForm.language")}
          </legend>
          <div className={group}>
            {LANGUAGES.map((option) => (
              <button
                key={option.value}
                type="button"
                data-testid={`language-${option.value}`}
                aria-pressed={pendingLanguage === option.value}
                onClick={() => {
                  setPendingLanguage(option.value);
                  remember({ language: option.value });
                }}
                className={
                  pendingLanguage === option.value
                    ? `rounded-md border border-brand-600 bg-brand px-2 py-1 text-xs font-semibold text-on-brand ${grow}`
                    : `rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2 hover:border-ink-4 ${grow}`
                }
              >
                {t(option.label)}
              </button>
            ))}
          </div>
          {grid ? null : (
            <span className="text-xs text-ink-4">
              {t("appearance.bahasaMelayuNote")}
            </span>
          )}
        </fieldset>
      )}

      <fieldset className={fieldset}>
        <legend className={legend}>{t("appearance.density")}</legend>
        <div className={group}>
          {DENSITIES.map((option) => (
            <button
              key={option.value}
              type="button"
              data-testid={`density-${option.value}`}
              aria-pressed={density === option.value}
              onClick={() => {
                setDensity(option.value);
                remember({ density: option.value });
              }}
              className={
                density === option.value
                  ? `rounded-md border border-brand-600 bg-brand px-2 py-1 text-xs font-semibold text-on-brand ${grow}`
                  : `rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2 hover:border-ink-4 ${grow}`
              }
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </fieldset>

      {grid && !compact ? (
        <p className="col-span-12 text-xs text-ink-3">
          {t("appearance.bahasaMelayuNote")}
        </p>
      ) : null}

      {problem ? (
        <span role="alert" className="col-span-12 text-xs text-bad">
          {problem}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Applies a member's stored choice to a browser that has never seen it.
 *
 * **The server value wins once, not every render.** A member who changes the
 * theme in this tab has just written both, so re-applying the stored value on
 * every render would fight the control. It runs on mount, and only where the
 * browser and the member disagree.
 *
 * Renders nothing. Mounted in the shell, so every signed-in page carries it.
 */
export function AppearanceSync({
  theme: stored,
  density: storedDensity,
}: {
  readonly theme: "light" | "dark" | "system" | null;
  readonly density: "comfortable" | "compact" | null;
}) {
  const { theme, density, setTheme, setDensity } = useTheme();
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current) {
      return;
    }
    applied.current = true;
    if (stored && stored !== theme) {
      setTheme(stored);
    }
    if (storedDensity && storedDensity !== density) {
      setDensity(storedDensity);
    }
  }, [stored, storedDensity, theme, density, setTheme, setDensity]);

  return null;
}
