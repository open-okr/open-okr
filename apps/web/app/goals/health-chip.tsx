"use client";

import { Chip, useTranslations } from "@openokr/ui";
import { healthWord } from "../../lib/health-words.ts";

/**
 * A goal's health as a word with a tone (UIUX-PLAN.md §2, P3-T10).
 *
 * Colour is never the only signal, so the word is always there and the tone only
 * reinforces it. `outdated` is deliberately its own state rather than a shade of
 * caution: METHOD.md §3 makes staleness a fact about the reporting, not about the
 * work, and a goal can be genuinely on track and still have gone quiet.
 *
 * **Words, not stored codes** (P9-T15b-a). The chip read the stored value with
 * its underscore taken out, so `caution` said "caution" where METHOD.md §3.5
 * says "At risk", which is a term a workspace may rename. And an outdated goal
 * says what it last reported beside it, because §3.5 keeps the last reported
 * status in view rather than letting "outdated" hide it.
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
  abandoned: "neutral",
  pending: "neutral",
};

/** "Outdated" with the last reported status, one sentence per status. */
const OUTDATED_LAST = {
  on_track: "health.outdatedLastOnTrack",
  caution: "health.outdatedLastAtRisk",
  off_track: "health.outdatedLastOffTrack",
} as const;

export function HealthChip({
  health,
  reported = null,
}: {
  readonly health: string;
  /** The last published check-in's status, shown beside "outdated". */
  readonly reported?: "on_track" | "caution" | "off_track" | null;
}) {
  const { t } = useTranslations();
  return (
    <Chip tone={TONE[health] ?? "neutral"} data-testid="health-chip">
      {health === "outdated" && reported
        ? t(OUTDATED_LAST[reported])
        : healthWord(t, health)}
    </Chip>
  );
}
