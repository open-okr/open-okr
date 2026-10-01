import { describe, expect, it } from "vitest";
import {
  BRAND_SURFACES,
  BRAND_TOKENS,
  contrastRatio,
  deriveBrandPalette,
  statusHueOf,
} from "../src/settings/brand-colour.ts";

/**
 * A workspace's brand colour, turned into the brand tokens (completeness
 * review M-14).
 *
 * The card saved a colour and said it was in force while every screen stayed
 * indigo. The palette is what makes that sentence true, and the contrast the
 * colour system promises is only kept if every derived stop clears the same
 * pairs `packages/ui/test/tokens-contrast.test.ts` holds the default theme to.
 * Those pairs are repeated here by name, for the stops a workspace's colour
 * replaces.
 */

const TEXT = 4.5;
const UI = 3;

/** Colours an administrator might plausibly type, across the allowed arc. */
const CHOSEN = [
  "#4f46e5", // the product's own indigo
  "#336699", // the placeholder the card shows
  "#1d4ed8", // a strong blue
  "#0b7eb2", // cyan-blue, at the green band's edge
  "#7c3aed", // violet
  "#a21caf", // fuchsia
  "#db2777", // pink
  "#c7d2fe", // too light to carry white text
  "#bae6fd", // a pale sky blue, lighter still
  "#0a0a3a", // nearly black navy
  "#777777", // a mid grey
  "#f5f5f5", // an almost white grey
  "#000000",
  "#ffffff",
] as const;

function hue(hex: string): { h: number; s: number; l: number } {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(
    (c) => c / 255,
  ) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const sector =
    max === r
      ? (g - b) / d + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return { h: sector * 60, s, l };
}

describe("the status hues are refused (UIUX-PLAN §2, rule 1)", () => {
  it.each([
    ["#ef4444", "red"],
    ["#b91c1c", "red"],
    ["#f43f5e", "red"],
    ["#f97316", "amber"],
    ["#f59e0b", "amber"],
    ["#eab308", "amber"],
    ["#7a5230", "amber"],
    ["#84cc16", "green"],
    ["#22c55e", "green"],
    ["#15803d", "green"],
    ["#14b8a6", "green"],
  ] as const)("%s reads as %s", (colour, family) => {
    expect(statusHueOf(colour)).toBe(family);
    // And so it is never applied, even if it was stored before the schema
    // refused it.
    expect(deriveBrandPalette(colour)).toBeNull();
  });

  it.each(CHOSEN)("%s reads as no status", (colour) => {
    expect(statusHueOf(colour)).toBeNull();
  });

  it("refuses anything that is not a six-digit hex", () => {
    expect(deriveBrandPalette("blue")).toBeNull();
    expect(deriveBrandPalette("#fff")).toBeNull();
    expect(deriveBrandPalette("#12345g")).toBeNull();
  });
});

describe.each(CHOSEN)("the palette for %s", (chosen) => {
  const palette = deriveBrandPalette(chosen);
  if (palette === null) {
    throw new Error(`${chosen} should derive a palette`);
  }

  it("sets every brand token, on both themes", () => {
    expect(Object.keys(palette.light).sort()).toEqual([...BRAND_TOKENS].sort());
    expect(Object.keys(palette.dark).sort()).toEqual([...BRAND_TOKENS].sort());
    for (const theme of [palette.light, palette.dark]) {
      for (const value of Object.values(theme)) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("keeps the chosen colour as the fill when it can carry white text", () => {
    if (contrastRatio(chosen, "#ffffff") >= TEXT) {
      expect(palette.fill).toBe(chosen.toLowerCase());
      expect(palette.adjusted).toBe(false);
    } else {
      expect(palette.adjusted).toBe(true);
      // Darker, never a different colour: the hue survives the adjustment.
      if (hue(chosen).s >= 0.15) {
        const drift = Math.abs(hue(palette.fill).h - hue(chosen).h);
        expect(Math.min(drift, 360 - drift)).toBeLessThan(6);
      }
    }
  });

  const light = BRAND_SURFACES.light;
  const dark = BRAND_SURFACES.dark;

  it.each([
    // The same pairs tokens-contrast.test.ts asserts on the default theme.
    ["#ffffff", "--brand", TEXT, "a primary button's label"],
    ["#ffffff", "--brand-600", TEXT, "a primary button, hovered"],
    ["#ffffff", "--brand-700", TEXT, "a primary button, pressed"],
    ["--brand-text", light.surface, TEXT, "a link on a card"],
    ["--brand-text", light.bg, TEXT, "a link on the app background"],
    ["--brand-text", light.raised, TEXT, "a link on a hover row"],
    ["--brand-text", "--brand-weak", TEXT, "a brand chip's label"],
    ["--brand-strong", light.track, UI, "a progress fill against its track"],
    ["--brand-strong", light.surface, UI, "a progress fill on a card"],
    ["--brand-strong", light.bg, UI, "a progress fill on the app background"],
    ["--brand-strong", light.raised, UI, "a focus indicator on a hover row"],
  ] as const)("light: %s on %s clears %d:1, %s", (fg, bg, min, what) => {
    const colour = (value: string) =>
      value.startsWith("--")
        ? palette.light[value as keyof typeof palette.light]
        : value;
    expect(
      contrastRatio(colour(fg), colour(bg)),
      `${what}: ${colour(fg)} on ${colour(bg)}`,
    ).toBeGreaterThanOrEqual(min);
  });

  it.each([
    ["#ffffff", "--brand", TEXT, "a primary button's label"],
    ["#ffffff", "--brand-700", TEXT, "a primary button, pressed"],
    ["--brand-text", dark.surface, TEXT, "a link on a card"],
    ["--brand-text", dark.bg, TEXT, "a link on the app background"],
    ["--brand-text", dark.raised, TEXT, "a link on a hover row"],
    ["--brand-text", "--brand-weak", TEXT, "a brand chip's label"],
    ["--brand-strong", dark.track, UI, "a progress fill against its track"],
    ["--brand-strong", dark.surface, UI, "a progress fill on a card"],
    ["--brand-strong", dark.bg, UI, "a progress fill on the app background"],
    ["--brand-strong", dark.raised, UI, "a focus indicator on a hover row"],
  ] as const)("dark: %s on %s clears %d:1, %s", (fg, bg, min, what) => {
    const colour = (value: string) =>
      value.startsWith("--")
        ? palette.dark[value as keyof typeof palette.dark]
        : value;
    expect(
      contrastRatio(colour(fg), colour(bg)),
      `${what}: ${colour(fg)} on ${colour(bg)}`,
    ).toBeGreaterThanOrEqual(min);
  });

  it("keeps the fills the same on both themes, as tokens.css does", () => {
    for (const token of ["--brand", "--brand-600", "--brand-700"] as const) {
      expect(palette.dark[token]).toBe(palette.light[token]);
    }
  });
});

describe("the chosen hue carries through every stop", () => {
  it("keeps every derived stop within a few degrees of the chosen hue", () => {
    // Every allowed hue, at three saturations and three lightnesses. The
    // stops are drawn in the chosen hue and only rounding moves them, so a
    // stop far from it would be a colour nobody chose.
    //
    // **Drift, not the status bands, is what is asserted.** A colour chosen a
    // degree inside the allowed arc can round a degree outside it at another
    // lightness, and that stop is still the colour the administrator picked.
    // Measured over all 4,096 twelve-bit colours the arc admits, the worst
    // drift is about three degrees, on a pale halo.
    for (let h = 185; h < 340; h += 5) {
      for (const s of [0.4, 0.7, 1]) {
        for (const l of [0.3, 0.5, 0.75]) {
          const c = (1 - Math.abs(2 * l - 1)) * s;
          const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
          const m = l - c / 2;
          const [r, g, b] =
            h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
          const chosen = `#${[r, g, b]
            .map((v) =>
              Math.round((v + m) * 255)
                .toString(16)
                .padStart(2, "0"),
            )
            .join("")}`;
          if (statusHueOf(chosen) !== null) {
            continue;
          }
          const palette = deriveBrandPalette(chosen);
          expect(palette, chosen).not.toBeNull();
          const base = hue(chosen);
          for (const theme of [palette?.light, palette?.dark]) {
            for (const [token, value] of Object.entries(theme ?? {})) {
              const stop = hue(value);
              // Near black and near white a hue is a rounding artefact.
              if (stop.s < 0.15 || stop.l < 0.06 || stop.l > 0.94) {
                continue;
              }
              const drift = Math.abs(stop.h - base.h);
              expect(
                Math.min(drift, 360 - drift),
                `${token} for ${chosen} is ${value}`,
              ).toBeLessThan(5);
            }
          }
        }
      }
    }
  });
});
