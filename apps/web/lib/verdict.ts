/**
 * §3.4's portfolio verdict, as a chip tone and a label.
 *
 * Two surfaces read the same verdict: the scorecard reports the cycle the
 * review agreed on, and the quarterly review's scoring stage shows the average
 * building as objectives are revealed (P4-T10b-b). One mapping, so the two
 * cannot describe the same word differently.
 *
 * The verdict itself is decided in `packages/method`. Nothing here judges
 * anything; it only chooses how a decided verdict is dressed.
 */

export const verdictTone = (
  verdict: string | null,
): "ok" | "info" | "warn" | "bad" | "neutral" =>
  verdict === "healthy"
    ? "ok"
    : verdict === "too_safe"
      ? "info"
      : verdict === "partial"
        ? "warn"
        : verdict === "outran_capacity"
          ? "bad"
          : "neutral";

export const verdictLabel = (verdict: string | null): string =>
  verdict === null ? "not scored" : verdict.replace(/_/g, " ");
