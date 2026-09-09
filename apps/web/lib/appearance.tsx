"use client";

import { useTheme } from "@openokr/ui";
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

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

const DENSITIES = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
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
  { value: "en", label: "English" },
  { value: "ms", label: "Bahasa Melayu" },
] as const;

export function AppearanceControl({
  compact = false,
  language = null,
}: {
  /** Laid out for the avatar menu rather than for a settings card. */
  readonly compact?: boolean;
  /**
   * The member's stored language, or null for "follow the workspace"
   * (P6-G22a). Passed in from the server, because unlike the theme there is
   * no provider holding it: the catalogue is chosen while the page renders.
   */
  readonly language?: "en" | "ms" | null;
}) {
  const { theme, density, setTheme, setDensity } = useTheme();
  const [problem, setProblem] = useState<string | null>(null);
  const [pendingLanguage, setPendingLanguage] = useState<"en" | "ms" | null>(
    language,
  );

  const remember = (input: Parameters<typeof setAppearance>[0]) => {
    void setAppearance(input).then((result) => setProblem(result.error));
  };

  return (
    <div
      className={
        compact ? "flex flex-col gap-2 px-2 py-1.5" : "flex flex-col gap-3.5"
      }
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs font-semibold text-ink-3">Theme</legend>
        <div className="flex gap-1.5">
          {THEMES.map((option) => (
            <button
              key={option.value}
              type="button"
              data-testid={`theme-${option.value}`}
              aria-pressed={theme === option.value}
              onClick={() => {
                setTheme(option.value);
                remember({ theme: option.value });
              }}
              className={
                theme === option.value
                  ? "rounded-md border border-brand-600 bg-brand px-2 py-1 text-xs font-semibold text-on-brand"
                  : "rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2 hover:border-ink-4"
              }
            >
              {option.label}
            </button>
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
        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs font-semibold text-ink-3">Language</legend>
          <div className="flex gap-1.5">
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
                    ? "rounded-md border border-brand-600 bg-brand px-2 py-1 text-xs font-semibold text-on-brand"
                    : "rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2 hover:border-ink-4"
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-ink-4">
            Bahasa Melayu is stubbed: the keys exist and resolve, and a speaker
            has not reviewed the wording yet. Most screens are still English
            either way, which is P6-G22c.
          </span>
        </fieldset>
      )}

      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs font-semibold text-ink-3">Density</legend>
        <div className="flex gap-1.5">
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
                  ? "rounded-md border border-brand-600 bg-brand px-2 py-1 text-xs font-semibold text-on-brand"
                  : "rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2 hover:border-ink-4"
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      {problem ? (
        <span role="alert" className="text-xs text-bad">
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
