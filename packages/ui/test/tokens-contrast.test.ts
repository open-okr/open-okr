import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The colour system's accessibility claims, checked against the file that
 * makes them (docs/design/colour-system.md §Accessibility, UIUX-PLAN.md §7:
 * "Contrast of at least 4.5 to 1 for text and 3 to 1 for interface
 * elements").
 *
 * This exists because a contrast table in a document is a claim, and a claim
 * nobody executes rots. Writing these assertions is what found the dark
 * theme's status labels sitting at 2.6:1 — the dark block overrode the pill
 * backgrounds and not the labels, on every dark screen in the product, and
 * nothing had ever measured it. Editing a token to a value that breaks a pair
 * below fails here rather than in an audit.
 *
 * Pairs are written as token names, not hex, so the test follows a
 * re-themed token instead of pinning the colour it happens to hold today.
 */

// The path is inlined by `define` in vitest.config.ts rather than derived
// here: neither process.cwd() nor import.meta.url is the same under `pnpm
// test` and `pnpm test:ci`. See test/globals.d.ts.
const tokens = readFileSync(__TOKENS_CSS_PATH__, "utf8");

/**
 * Reads the custom properties from one selector block. Deliberately a small
 * regex rather than a CSS parser: this file only has to understand
 * `--name: #hex;` and `--name: var(--other);`, and a dependency to read ten
 * lines would be a poor trade.
 */
function block(selector: string): Record<string, string> {
  const start = tokens.indexOf(`${selector} {`);
  if (start === -1) {
    throw new Error(`no ${selector} block in tokens.css`);
  }
  const body = tokens.slice(start, tokens.indexOf("\n}", start));
  const found: Record<string, string> = {};
  for (const match of body.matchAll(/^\s{2}(--[\w-]+):\s*([^;]+);/gm)) {
    const [, name, value] = match;
    if (name && value) {
      found[name] = value.trim();
    }
  }
  return found;
}

const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };

/** Resolves `var(--other)` indirection, then the hex. */
function hex(theme: Record<string, string>, token: string): string {
  const seen = new Set<string>();
  let value = theme[token];
  while (value?.startsWith("var(")) {
    const next = value.slice(4, -1).trim();
    if (seen.has(next)) {
      throw new Error(`${token} resolves in a circle`);
    }
    seen.add(next);
    value = theme[next];
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${token} is not a plain hex colour: ${value}`);
  }
  return value;
}

function luminance(colour: string): number {
  const n = Number.parseInt(colour.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

function contrast(a: string, b: string): number {
  const high = Math.max(luminance(a), luminance(b));
  const low = Math.min(luminance(a), luminance(b));
  return (high + 0.05) / (low + 0.05);
}

/** 4.5:1, WCAG AA for text of any size. */
const TEXT = 4.5;
/**
 * 3:1, WCAG AA for interface elements. Applied to the progress fill and the
 * focus indicator. Deliberately NOT applied to status dots — see the
 * status-dot block below, and UIUX-PLAN.md §7.
 */
const UI = 3;

/**
 * Every pair a component can actually put on screen. A token pair missing
 * from this list is a pair nobody has checked, so add the row when you add
 * the combination, not after.
 */
const pairs: ReadonlyArray<
  readonly [foreground: string, background: string, min: number, what: string]
> = [
  // Text on the three surfaces a screen is built from.
  ["--ink", "--surface", TEXT, "body copy on a card"],
  ["--ink", "--bg", TEXT, "body copy on the app background"],
  ["--ink", "--raised", TEXT, "body copy on a hover row"],
  ["--ink-2", "--surface", TEXT, "strong secondary on a card"],
  ["--ink-2", "--bg", TEXT, "strong secondary on the app background"],
  ["--ink-2", "--raised", TEXT, "a neutral chip's label"],
  ["--ink-3", "--surface", TEXT, "owners and timestamps on a card"],
  ["--ink-3", "--bg", TEXT, "owners and timestamps on the app background"],
  ["--ink-3", "--raised", TEXT, "metadata on a hover row"],

  // Brand text. Rule 5: --brand-text, never --brand, carries a label.
  ["--brand-text", "--surface", TEXT, "a link on a card"],
  ["--brand-text", "--bg", TEXT, "a link on the app background"],
  ["--brand-text", "--brand-weak", TEXT, "a brand chip's label"],
  ["--brand-text", "--raised", TEXT, "a link on a hover row"],

  // Brand fills carry --on-brand, which is white on both themes.
  ["--on-brand", "--brand", TEXT, "a primary button's label"],
  ["--on-brand", "--brand-700", TEXT, "a primary button, pressed"],

  // Status pills: the label on its own background. This is the assertion
  // that matters, because the label is what carries the state.
  ["--ok", "--ok-bg", TEXT, "an on-track pill's label"],
  ["--warn", "--warn-bg", TEXT, "an at-risk pill's label"],
  ["--bad", "--bad-bg", TEXT, "an off-track pill's label"],
  ["--info", "--info-bg", TEXT, "an info chip's label"],

  // Status labels also render as bare text beside a neutral surface.
  ["--ok", "--surface", TEXT, "on-track text on a card"],
  ["--warn", "--surface", TEXT, "at-risk text on a card"],
  ["--bad", "--surface", TEXT, "off-track text on a card"],
  ["--ok", "--raised", TEXT, "on-track text on a hover row"],
  ["--warn", "--raised", TEXT, "at-risk text on a hover row"],
  ["--bad", "--raised", TEXT, "off-track text on a hover row"],

  // Status dots are absent on purpose. They are not held to 3:1, because
  // rule 4 means they never carry the state alone. The obligations that
  // replace the ratio are asserted in the status-dot block below and in
  // test/components.test.tsx.

  // Rule 2: a progress bar fills with --brand-strong over --track, and
  // nothing else. The boundary between them is the whole information the
  // bar carries, so it is a 1.4.11 graphic and owes 3:1.
  ["--brand-strong", "--track", UI, "a progress fill against its track"],
  ["--brand-strong", "--surface", UI, "a progress fill on a card"],
  ["--brand-strong", "--bg", UI, "a progress fill on the app background"],

  // The focus indicator, which 2.4.11 requires to be findable. Asserted on
  // --brand-strong, not --brand-line: the ring is a halo drawn around the
  // indicator, and a halo is not what makes focus visible.
  ["--brand-strong", "--surface", UI, "a focus indicator on a card"],
  ["--brand-strong", "--raised", UI, "a focus indicator on a hover row"],

  // Dividers, hairlines and an input's resting outline are deliberately
  // absent. They are decorative boundaries between two surfaces, not
  // graphics required to understand content, so 1.4.11 does not reach them
  // and holding them to 3:1 would force a border darker than any of these
  // designs want. An input's *focused* outline is covered above, and that
  // is the one that has to be seen.
];

/**
 * --ink-4 is the one token exempt from 4.5:1, and it is exempt on purpose:
 * placeholders and disabled labels are the two cases WCAG 1.4.3 itself
 * excludes. Asserted as a ceiling so nobody quietly promotes it to body
 * text, and as a floor so it does not fade to nothing. The floor is a house
 * number, not a WCAG one.
 */
const mutedRange = [2.2, 4.5] as const;

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme contrast", (themeName, theme) => {
  it.each(pairs)("%s on %s clears %d:1 — %s", (fg, bg, min, what) => {
    const ratio = contrast(hex(theme, fg), hex(theme, bg));
    expect(
      ratio,
      `${what}: ${fg} (${hex(theme, fg)}) on ${bg} (${hex(theme, bg)}) is ${ratio.toFixed(2)}:1, needs ${min}:1`,
    ).toBeGreaterThanOrEqual(min);
  });

  it("keeps --ink-4 muted but visible", () => {
    for (const bg of ["--surface", "--bg", "--raised"]) {
      const ratio = contrast(hex(theme, "--ink-4"), hex(theme, bg));
      expect(ratio, `--ink-4 on ${bg} in ${themeName}`).toBeGreaterThan(
        mutedRange[0],
      );
      expect(ratio, `--ink-4 on ${bg} in ${themeName}`).toBeLessThan(
        mutedRange[1],
      );
    }
  });
});

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme status dots", (_themeName, theme) => {
  /**
   * A status dot is deliberately vibrant rather than contrast-maximised.
   *
   * WCAG 1.4.11 asks 3:1 of a graphic that is "required to understand the
   * content". Rule 4 guarantees a dot is never that: every status colour
   * ships with a text label, the label is what a screen reader announces,
   * and `Chip` marks the dot `aria-hidden`. So the dot is decorative and
   * 1.4.11 does not reach it — which is what lets the scale stay saturated
   * enough that on-track reads as on-track at a glance. Darkening amber to
   * clear 3:1 on its own pill turned it olive.
   *
   * The obligation that replaces the ratio is structural, and it is
   * asserted where it can be: `Chip` never renders a dot without a label
   * (see test/components.test.tsx).
   *
   * What is still checked here is that a dot is perceptible at all, and
   * that it is distinguishable from the label it sits beside — otherwise
   * the pill reads as one solid blob.
   */
  const dots = [
    ["--ok-dot", "--ok-bg", "--ok"],
    ["--warn-dot", "--warn-bg", "--warn"],
    ["--bad-dot", "--bad-bg", "--bad"],
    ["--info-dot", "--info-bg", "--info"],
  ] as const;

  it.each(dots)("%s is visible on %s", (dot, background) => {
    expect(contrast(hex(theme, dot), hex(theme, background))).toBeGreaterThan(
      1.5,
    );
  });

  it.each(dots)("%s stays saturated", (dot) => {
    // The guard against somebody "fixing" the contrast by desaturating the
    // scale into greys: a status hue must remain obviously a hue.
    const colour = hex(theme, dot);
    const n = Number.parseInt(colour.slice(1), 16);
    const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const spread = Math.max(...channels) - Math.min(...channels);
    expect(
      spread,
      `${dot} (${colour}) has little colour in it`,
    ).toBeGreaterThan(60);
  });
});

describe("the rules the palette itself has to obey", () => {
  it("keeps red, amber and green out of the brand ramp (rule 1)", () => {
    // A brand token that drifted into a status hue would put a green pixel
    // on screen that does not mean on track.
    for (const token of [
      "--brand",
      "--brand-600",
      "--brand-700",
      "--brand-text",
      "--brand-weak",
      "--brand-line",
    ]) {
      for (const theme of [light, dark]) {
        const colour = hex(theme, token);
        const n = Number.parseInt(colour.slice(1), 16);
        const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        expect(
          b,
          `${token} (${colour}) should be blue-dominant`,
        ).toBeGreaterThan(Math.max(r, g));
      }
    }
  });

  it("keeps info out of the status scale", () => {
    // Info is its own blue, distinct from the brand indigo and from all
    // three status families. Rule 1 is the constraint that matters here: an
    // informational chip must never borrow green, amber or red.
    for (const theme of [light, dark]) {
      const statuses = ["--ok", "--warn", "--bad", "--ok-dot", "--warn-dot"]
        .concat(["--bad-dot", "--ok-bg", "--warn-bg", "--bad-bg"])
        .map((token) => hex(theme, token));
      for (const token of ["--info", "--info-bg", "--info-dot"]) {
        expect(statuses, `${token} must not be a status colour`).not.toContain(
          hex(theme, token),
        );
      }
      // ...and it is a blue, not a recoloured status hue.
      for (const token of ["--info", "--info-dot"]) {
        const colour = hex(theme, token);
        const n = Number.parseInt(colour.slice(1), 16);
        const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        expect(b, `${token} (${colour}) should be blue`).toBeGreaterThan(
          Math.max(r, g),
        );
      }
    }
  });

  it("re-themes every surface and label token for dark", () => {
    // Not a contrast property, but the one that breaks dark mode quietly: a
    // token added to :root and forgotten under [data-theme="dark"] keeps its
    // light value and looks almost right until it does not. That is exactly
    // how --ok, --warn, --bad and --info spent P2-T10 at 2.6:1 on dark.
    //
    // The saturated dots are the deliberate exception below.
    const themeable = Object.keys(light).filter(
      (name) =>
        /^--(ink|line|bg|surface|raised|track|ok|warn|bad|info)/.test(name) &&
        !name.endsWith("-dot"),
    );
    const darkOnly = block(':root[data-theme="dark"]');
    expect(themeable.filter((name) => !(name in darkOnly))).toEqual([]);
  });

  it("shares one saturated dot across both themes, on purpose", () => {
    // The dots are the one part of the scale that does not invert. They are
    // picked to read on white and on near-black alike, so overriding them
    // per theme would be two chances to drift instead of one value to keep.
    const darkOnly = block(':root[data-theme="dark"]');
    for (const dot of ["--ok-dot", "--warn-dot", "--bad-dot", "--info-dot"]) {
      expect(darkOnly, `${dot} should not be re-themed`).not.toHaveProperty(
        dot,
      );
      // ...which only holds up if the shared value works on dark too.
      expect(
        contrast(hex(dark, dot), hex(dark, "--surface")),
        `${dot} on a dark card`,
      ).toBeGreaterThan(3);
    }
  });
});
