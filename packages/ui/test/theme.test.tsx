import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ThemeProvider, useTheme } from "../src/theme/theme-provider.tsx";
import {
  DENSITY_STORAGE_KEY,
  resolveTheme,
  THEME_STORAGE_KEY,
  themeInitScript,
} from "../src/theme/theme-script.ts";

describe("resolveTheme", () => {
  test("system resolves against the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  test("an explicit choice always wins over the OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

test("the inline bootstrap script references both storage keys and both DOM attributes", () => {
  const script = themeInitScript();
  expect(script).toContain(JSON.stringify(THEME_STORAGE_KEY));
  expect(script).toContain(JSON.stringify(DENSITY_STORAGE_KEY));
  expect(script).toContain('data-theme"');
  expect(script).toContain('data-density"');
});

function Probe() {
  const { theme, resolvedTheme, density, setTheme, setDensity } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <span data-testid="density">{density}</span>
      <button type="button" onClick={() => setTheme("dark")}>
        dark
      </button>
      <button type="button" onClick={() => setDensity("compact")}>
        compact
      </button>
    </div>
  );
}

describe("ThemeProvider: theme and density persistence end to end", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-density");
    // jsdom has no native `matchMedia` at all (unlike a real browser), so
    // there is nothing for `vi.spyOn` to wrap — it has to be assigned
    // outright.
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("defaults to system/comfortable and applies both DOM attributes", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "comfortable",
    );
  });

  test("choosing a theme persists to localStorage and updates the DOM attribute", async () => {
    const { getByText } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {
      getByText("dark").click();
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  test("choosing a density persists to localStorage and updates the DOM attribute", async () => {
    const { getByText } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {
      getByText("compact").click();
    });
    expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBe("compact");
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "compact",
    );
  });

  test("a stored preference from a previous session is read back on mount", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    window.localStorage.setItem(DENSITY_STORAGE_KEY, "compact");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-density")).toBe(
      "compact",
    );
  });
});
