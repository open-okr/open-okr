/**
 * A colour as six hex digits after a hash, like `#336699`.
 *
 * Written once as the text an HTML `pattern` attribute takes, which the
 * browser anchors itself, and once as the regex the server applies, built from
 * the same text so the two cannot differ.
 */
export const HEX_COLOUR_HTML_PATTERN = "#[0-9a-fA-F]{6}";

export const HEX_COLOUR_PATTERN = new RegExp(`^${HEX_COLOUR_HTML_PATTERN}$`);

/** Whether `text` is a colour written as six hex digits after a hash. */
export function isHexColour(text: string): boolean {
  return HEX_COLOUR_PATTERN.test(text);
}

/** A colour as its hue in degrees, and its saturation and lightness, 0 to 1. */
export interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

/** The red, green and blue of a `#rrggbb` colour, 0 to 255 each. */
export function hexChannels(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A `#rrggbb` colour as HSL. */
export function hexToHsl(hex: string): Hsl {
  const [r, g, b] = hexChannels(hex).map((channel) => channel / 255) as [
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

/**
 * Below this HSL saturation a colour is a grey, whatever its hue says. A grey
 * brand is allowed: it is not a status colour, and its derived shades stay
 * grey because they keep its saturation.
 */
const NEUTRAL_SATURATION = 0.15;

export type StatusHue = "red" | "amber" | "green";

/**
 * Which status family a colour reads as, or null when it reads as none.
 *
 * The bands are wide on purpose, the same way the avatar palette's are: teal
 * and lime read as on track at chip size, orange and brown as at risk, and
 * rose as off track. What is left is the arc from cyan-blue through indigo and
 * violet to pink, and any grey.
 *
 * Moved here unchanged from the brand colour in `packages/core`, so the
 * branding field refuses a status colour as it is picked with the rule the
 * server refuses it by (guided-inputs §4.11).
 */
export function statusHueOf(hex: string): StatusHue | null {
  if (!HEX_COLOUR_PATTERN.test(hex)) {
    return null;
  }
  const { h, s } = hexToHsl(hex);
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
