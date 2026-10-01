/**
 * A workspace's brand colour, turned into the brand token family (completeness
 * review M-14, UIUX-PLAN §2, docs/design/colour-system.md).
 *
 * **The branding card saved a colour and nothing read it.** The card said the
 * colour was "in force" while every screen stayed indigo. This is what makes
 * the sentence true: the one chosen colour becomes the seven `--brand` tokens
 * `tokens.css` defines, for light and for dark, and the root layout sets them
 * on every signed-in screen.
 *
 * **The administrator chooses a hue, and the product chooses the weights.**
 * The colour system splits the brand ramp by job, and each job owes a
 * different contrast (§Accessibility in the colour system):
 *
 * | Token | Owes | How it is found |
 * |---|---|---|
 * | `--brand` | White text at 4.5:1 | The chosen colour, or the nearest darker shade that carries white |
 * | `--brand-600`, `--brand-700` | White text at 4.5:1 | Two steps darker than `--brand` |
 * | `--brand-text` | 4.5:1 on every surface and on `--brand-weak` | Darkened in light, lightened in dark, until it clears |
 * | `--brand-strong` | 3:1 against the track and the surfaces | `--brand` in light, `--brand-text` in dark, as the default theme does |
 * | `--brand-weak`, `--brand-line` | Nothing: a tint and a halo | Fixed lightness in the chosen hue |
 *
 * So a chosen colour never fails contrast. A colour too light to carry white
 * text is darkened rather than refused, and the card says which shade is in
 * force. Every pair is asserted in `packages/core/test/brand-colour.test.ts`.
 *
 * **What is refused is a status hue.** Rule 1 of UIUX-PLAN §2: red, amber and
 * green mean off track, at risk and on track, and never appear on a primary
 * button, a link or a progress bar. A green brand would put a green pixel on
 * every screen that does not mean on track, so the settings schema refuses one.
 *
 * Pure: no database, no DOM. The web app turns the palette into CSS.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The tokens a workspace's colour sets, in `tokens.css` order. */
export const BRAND_TOKENS = [
  "--brand",
  "--brand-600",
  "--brand-700",
  "--brand-text",
  "--brand-strong",
  "--brand-weak",
  "--brand-line",
] as const;

type BrandToken = (typeof BRAND_TOKENS)[number];

/**
 * The surfaces each stop is measured against, as `tokens.css` defines them.
 *
 * Repeated rather than read from the file, because this runs on every page
 * render and must not touch the disk. `apps/web/test/brand-colour.test.ts`
 * holds the two to each other, so a re-themed surface fails a test here
 * rather than quietly measuring against the old one.
 */
export const BRAND_SURFACES = {
  light: {
    surface: "#ffffff",
    bg: "#f6f8fc",
    raised: "#eff3f9",
    track: "#e7ecf4",
  },
  dark: {
    surface: "#111827",
    bg: "#0b1220",
    raised: "#1a2332",
    track: "#1e293b",
  },
} as const;

/** `--on-brand`, which is white on both themes. */
const ON_BRAND = "#ffffff";

/** WCAG AA for text of any size, and for an interface graphic. */
const TEXT_CONTRAST = 4.5;
const UI_CONTRAST = 3;

/**
 * Below this HSL saturation a colour is a grey, whatever its hue says. A grey
 * brand is allowed: it is not a status colour, and its derived shades stay
 * grey because they keep its saturation.
 */
const NEUTRAL_SATURATION = 0.15;

export type StatusHue = "red" | "amber" | "green";

export interface BrandPalette {
  /** What the administrator chose, lower-cased. */
  readonly chosen: string;
  /** `--brand`: the chosen colour, or the darker shade that carries white. */
  readonly fill: string;
  /** True when `fill` is not the chosen colour. */
  readonly adjusted: boolean;
  readonly light: Readonly<Record<BrandToken, string>>;
  readonly dark: Readonly<Record<BrandToken, string>>;
}

interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

function channels(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHsl(hex: string): Hsl {
  const [r, g, b] = channels(hex).map((channel) => channel / 255) as [
    number,
    number,
    number,
  ];
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

function fromHsl({ h, s, l }: Hsl): string {
  const lightness = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * lightness - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return `#${[r, g, b]
    .map((channel) =>
      Math.min(255, Math.max(0, Math.round((channel + m) * 255)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const high = Math.max(luminance(a), luminance(b));
  const low = Math.min(luminance(a), luminance(b));
  return (high + 0.05) / (low + 0.05);
}

/**
 * Which status family a colour reads as, or null when it reads as none.
 *
 * The bands are wide on purpose, the same way the avatar palette's are: teal
 * and lime read as on track at chip size, orange and brown as at risk, and
 * rose as off track. What is left is the arc from cyan-blue through indigo and
 * violet to pink, and any grey.
 */
export function statusHueOf(hex: string): StatusHue | null {
  if (!HEX.test(hex)) {
    return null;
  }
  const { h, s } = toHsl(hex);
  if (s < NEUTRAL_SATURATION) {
    return null;
  }
  if (h >= 340 || h < 15) {
    return "red";
  }
  if (h < 65) {
    return "amber";
  }
  if (h < 185) {
    return "green";
  }
  return null;
}

/** Lightness is searched in steps this fine, which is below one RGB step. */
const STEP = 0.004;

/**
 * The first shade from `from`, moving darker or lighter, that passes.
 *
 * Always ends: black clears 4.5:1 against white and white clears it against
 * the darkest surface, so the far end of either walk passes every test here.
 */
function seek(
  base: Hsl,
  from: number,
  direction: -1 | 1,
  passes: (hex: string) => boolean,
): { readonly hex: string; readonly l: number } {
  for (let step = 0; step <= Math.ceil(1 / STEP); step += 1) {
    const l = Math.min(1, Math.max(0, from + direction * step * STEP));
    const hex = fromHsl({ ...base, l });
    if (passes(hex)) {
      return { hex, l };
    }
  }
  const l = direction < 0 ? 0 : 1;
  return { hex: fromHsl({ ...base, l }), l };
}

function clearsOn(
  backgrounds: readonly string[],
  ratio: number,
): (hex: string) => boolean {
  return (hex) =>
    backgrounds.every((background) => contrastRatio(hex, background) >= ratio);
}

/**
 * The brand tokens for one chosen colour, or null when it cannot be one.
 *
 * Null for anything but a six-digit hex and for a status hue, so a value
 * stored before the schema refused status hues is not applied either. The
 * layout then leaves the product's own palette in force, and the card says so.
 */
export function deriveBrandPalette(chosen: string): BrandPalette | null {
  if (!HEX.test(chosen) || statusHueOf(chosen) !== null) {
    return null;
  }
  const colour = chosen.toLowerCase();
  const base = toHsl(colour);
  const at = (l: number, s = base.s) =>
    fromHsl({ h: base.h, s, l: Math.min(1, Math.max(0, l)) });

  const carriesWhite = clearsOn([ON_BRAND], TEXT_CONTRAST);
  const fill = carriesWhite(colour)
    ? { hex: colour, l: base.l }
    : seek(base, base.l, -1, carriesWhite);
  const hover = at(fill.l - 0.08);
  const pressed = at(fill.l - 0.16);

  const light = BRAND_SURFACES.light;
  const lightWeak = at(0.965);
  const lightText = seek(
    base,
    fill.l - 0.08,
    -1,
    clearsOn([light.surface, light.bg, light.raised, lightWeak], TEXT_CONTRAST),
  ).hex;
  const lightStrong = seek(
    base,
    fill.l,
    -1,
    clearsOn([light.track, light.surface, light.bg, light.raised], UI_CONTRAST),
  ).hex;

  const dark = BRAND_SURFACES.dark;
  // A deep tint rather than a saturated one, the way the default theme's
  // indigo-950 is: a vivid fill behind a selected row would out-shout its text.
  const darkWeak = at(0.2, Math.min(base.s, 0.5));
  const darkText = seek(
    base,
    fill.l,
    1,
    clearsOn([dark.surface, dark.bg, dark.raised, darkWeak], TEXT_CONTRAST),
  ).hex;

  return {
    chosen: colour,
    fill: fill.hex,
    adjusted: fill.hex !== colour,
    light: {
      "--brand": fill.hex,
      "--brand-600": hover,
      "--brand-700": pressed,
      "--brand-text": lightText,
      "--brand-strong": lightStrong,
      "--brand-weak": lightWeak,
      "--brand-line": at(0.89),
    },
    // The three fills do not move between themes: they carry white on both.
    // What inverts is the pair that never carries text, as in tokens.css.
    dark: {
      "--brand": fill.hex,
      "--brand-600": hover,
      "--brand-700": pressed,
      "--brand-text": darkText,
      "--brand-strong": darkText,
      "--brand-weak": darkWeak,
      "--brand-line": pressed,
    },
  };
}
