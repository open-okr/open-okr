import type { LocaleDirection } from "@openokr/formats";

/** A physical arrow key's step in the order items are read. */
export function horizontalArrowStep(
  key: string,
  direction: LocaleDirection,
): -1 | 0 | 1 {
  if (key === "ArrowLeft") {
    return direction === "rtl" ? 1 : -1;
  }
  if (key === "ArrowRight") {
    return direction === "rtl" ? -1 : 1;
  }
  return 0;
}

/** Map the time coordinate to an SVG x. Value coordinates stay as drawn. */
export function timeAxisX(
  position: number,
  width: number,
  direction: LocaleDirection,
): number {
  return direction === "rtl" ? width - position : position;
}
