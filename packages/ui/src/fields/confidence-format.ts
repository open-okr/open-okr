/**
 * Confidence on the workspace's scale (docs/design/guided-inputs.md §4.8),
 * as plain functions.
 *
 * **Not a client module**, unlike `confidence-input.tsx`: server components
 * print confidence with `formatConfidence`, and a function exported from a
 * "use client" file cannot be called on the server. The production build
 * threw there, on the Work Map, once a confidence existed to print.
 */

/** The practice setting "Confidence shown as" (METHOD.md §12). */
export type ConfidenceDisplay = "xIn10" | "decimal" | "percent";

export const CONFIDENCE_SCALE: Readonly<
  Record<ConfidenceDisplay, { factor: number; max: number; step: number }>
> = {
  xIn10: { factor: 10, max: 10, step: 1 },
  decimal: { factor: 1, max: 1, step: 0.1 },
  percent: { factor: 100, max: 100, step: 5 },
};

/** Two places, which is what confidence is stored to. */
const round2 = (value: number) => Math.round(value * 100) / 100;

/** A stored 0.0 to 1.0 on the scale the workspace shows it on. */
export function confidenceShown(
  confidence: number,
  display: ConfidenceDisplay,
): number {
  const shown = confidence * CONFIDENCE_SCALE[display].factor;
  // 0.65 is 6.5 in 10 and 65%: one place on the ten scale, none on percent.
  return display === "xIn10"
    ? Math.round(shown * 10) / 10
    : display === "percent"
      ? Math.round(shown)
      : round2(shown);
}

/** A number on the workspace's scale, back to the stored 0.0 to 1.0. */
export function confidenceStored(
  shown: number,
  display: ConfidenceDisplay,
): number {
  return round2(
    Math.min(1, Math.max(0, shown / CONFIDENCE_SCALE[display].factor)),
  );
}

/**
 * Confidence as text, the way the setting says: "7 in 10", "0.7" or "70%".
 * Takes the translator rather than calling the hook, so a server page and a
 * client one say it the same way.
 */
export function formatConfidence(
  confidence: number,
  display: ConfidenceDisplay,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const shown = confidenceShown(confidence, display);
  if (display === "xIn10") {
    return t("fields.confidence.outOfTen", { value: shown });
  }
  return display === "percent" ? `${shown}%` : String(shown);
}
