import { Chip } from "@openokr/ui";

/**
 * A goal's health as a word with a tone (UIUX-PLAN.md §2, P3-T10).
 *
 * Colour is never the only signal, so the word is always there and the tone only
 * reinforces it. `outdated` is deliberately its own state rather than a shade of
 * caution: METHOD.md §3 makes staleness a fact about the reporting, not about the
 * work, and a goal can be genuinely on track and still have gone quiet.
 */

const TONE: Readonly<
  Record<string, "ok" | "warn" | "bad" | "neutral" | "info">
> = {
  on_track: "ok",
  achieved: "ok",
  caution: "warn",
  outdated: "warn",
  off_track: "bad",
  missed: "bad",
  pending: "neutral",
};

export function HealthChip({ health }: { readonly health: string }) {
  return (
    <Chip tone={TONE[health] ?? "neutral"}>{health.replace("_", " ")}</Chip>
  );
}
