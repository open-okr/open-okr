"use client";

/**
 * Takes over theme and density after theme-script.ts's inline bootstrap has
 * already set the DOM attributes it reads. Persists to `localStorage`
 * only: TECHNICAL-PLAN.md §4.14 names a per-member `theme`/`density`
 * setting backed by the member profile, but nothing writes those columns
 * yet (P2-T03 built only timezone/avatar/bio on `updateOwnProfile`, and
 * this task's own card scopes dark mode as a design-system capability, not
 * a settings-storage one) — wiring this to a real per-member write is a
 * follow-up for whichever task adds those columns, flagged in STATUS.md
 * rather than built here as scope creep into P2-T03's domain.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import {
  type ContentWidth,
  DENSITY_STORAGE_KEY,
  type Density,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
  WIDTH_STORAGE_KEY,
} from "./theme-script.ts";

export type { ContentWidth, Density, ThemePreference };

interface ThemeContextValue {
  readonly theme: ThemePreference;
  readonly resolvedTheme: "light" | "dark";
  readonly density: Density;
  readonly width: ContentWidth;
  setTheme(theme: ThemePreference): void;
  setDensity(density: Density): void;
  setWidth(width: ContentWidth): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStored<T extends string>(
  key: string,
  fallback: T,
  valid: readonly T[],
): T {
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = window.localStorage.getItem(key);
  return (valid as readonly string[]).includes(value ?? "")
    ? (value as T)
    : fallback;
}

const THEME_VALUES: readonly ThemePreference[] = ["light", "dark", "system"];
const DENSITY_VALUES: readonly Density[] = ["comfortable", "compact"];
const WIDTH_VALUES: readonly ContentWidth[] = ["compact", "full"];

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() =>
    readStored(THEME_STORAGE_KEY, "system", THEME_VALUES),
  );
  const [density, setDensityState] = useState<Density>(() =>
    readStored(DENSITY_STORAGE_KEY, "comfortable", DENSITY_VALUES),
  );
  const [width, setWidthState] = useState<ContentWidth>(() =>
    readStored(WIDTH_STORAGE_KEY, "compact", WIDTH_VALUES),
  );
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  const resolvedTheme = resolveTheme(theme, systemDark);

  // The server renders the defaults, because it has no localStorage, and
  // React keeps the server's attributes where hydration disagrees. A member
  // whose browser holds Full width then saw the pressed state of Compact on
  // the controls after a reload while the page itself was Full. Reading the
  // stored values once after mount makes the state, and so the controls,
  // match. Equal values bail out, so a browser on the defaults re-renders
  // nothing.
  useLayoutEffect(() => {
    setThemeState(readStored(THEME_STORAGE_KEY, "system", THEME_VALUES));
    setDensityState(
      readStored(DENSITY_STORAGE_KEY, "comfortable", DENSITY_VALUES),
    );
    setWidthState(readStored(WIDTH_STORAGE_KEY, "compact", WIDTH_VALUES));
  }, []);

  // React Strict Mode's dev-only mount→unmount→remount cycle re-runs effects
  // but never re-executes the inline <head> script, so the attributes it set
  // can be wiped on the phantom unmount. Re-applying on every mount (and
  // whenever the resolved value changes) is what keeps this correct in dev;
  // in production, where there is no double-mount, it is one extra no-op set.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-density", density);
  }, [density]);

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-width", width);
  }, [width]);

  useLayoutEffect(() => {
    if (theme !== "system") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  }, []);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
  }, []);

  const setWidth = useCallback((next: ContentWidth) => {
    setWidthState(next);
    window.localStorage.setItem(WIDTH_STORAGE_KEY, next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      density,
      width,
      setTheme,
      setDensity,
      setWidth,
    }),
    [theme, resolvedTheme, density, width, setTheme, setDensity, setWidth],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }
  return context;
}
