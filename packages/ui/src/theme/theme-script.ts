/**
 * The no-flash theme bootstrap (UIUX-PLAN.md §2, "dark mode... light, dark
 * or system", P2-T10).
 *
 * Runs as an inline <script> in the root layout's <head>, before React
 * hydrates and before first paint, per Next.js's own documented pattern for
 * this exact problem (a stored preference otherwise applies one frame too
 * late and the page flashes the wrong theme). It cannot go through
 * ThemeProvider: that component exists to take over *after* this has
 * already set the attributes it would otherwise wait a render to set.
 */

export const THEME_STORAGE_KEY = "openokr:theme";
export const DENSITY_STORAGE_KEY = "openokr:density";

export type ThemePreference = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): "light" | "dark" {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return preference;
}

/**
 * The literal script body. A plain function stringified into the page
 * rather than a module import, because this must run with no dependency
 * graph at all — it is the thing that runs before any of them would be
 * ready.
 */
export function themeInitScript(): string {
  return `(function(){try{
var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||"system";
var d=localStorage.getItem(${JSON.stringify(DENSITY_STORAGE_KEY)})||"comfortable";
var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.setAttribute("data-theme",dark?"dark":"light");
document.documentElement.setAttribute("data-density",d);
}catch(e){}})();`;
}
