"use client";

import { confidenceBand, type ResolvedThresholds } from "@openokr/method";
import { useTranslations } from "@openokr/ui";

/**
 * Confidence dial: 0.0 to 1.0 in 0.1 steps (METHOD.md §7.2, P4-T07b).
 *
 * The dial is a row of buttons rather than a draggable arc, because ten
 * buttons that work on every device beat a gesture that breaks on mobile.
 *
 * **The bands are the workspace's, from `confidenceBand`** (completeness
 * review H-17). They were 0.3, 0.4 and 0.7 written here, so a workspace that
 * tuned §3.2 was coloured by the canon, and the "Low (0.4)" shortcut set a
 * value §3.2 calls medium. The three shortcuts are now the three boundaries
 * by their own names: critical, where the low band escalates; the bottom of
 * medium; and the bottom of high.
 */

const STEPS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

const BAND_COLOUR = {
  high: "bg-good text-white",
  medium: "bg-warn text-ink",
  low: "bg-bad text-white",
} as const;

const BAND_LABEL = {
  high: "session.confidenceDial.high",
  medium: "session.confidenceDial.medium",
  low: "session.confidenceDial.low",
} as const;

interface ConfidenceDialProps {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly disabled?: boolean;
  readonly thresholds: ResolvedThresholds;
}

export function ConfidenceDial({
  value,
  onChange,
  disabled = false,
  thresholds,
}: ConfidenceDialProps) {
  const { t } = useTranslations();
  const bandOf = (confidence: number) =>
    confidenceBand(confidence, thresholds).band;
  const shortcuts = [
    {
      value: thresholds["scoring.confidenceCritical"],
      label: t("session.confidenceDial.critical"),
    },
    {
      value: thresholds["scoring.confidenceLow"],
      label: t(BAND_LABEL.medium),
    },
    {
      value: thresholds["scoring.confidenceHigh"],
      label: t(BAND_LABEL.high),
    },
  ];
  return (
    <div className="space-y-2">
      {/* Band shortcuts */}
      <div className="flex gap-2">
        {shortcuts.map((shortcut) => (
          <button
            key={shortcut.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(shortcut.value)}
            className={[
              "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
              value === shortcut.value
                ? BAND_COLOUR[bandOf(shortcut.value)]
                : "bg-surface text-ink-2 hover:bg-raised",
              disabled ? "opacity-50 cursor-not-allowed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {shortcut.label} ({shortcut.value})
          </button>
        ))}
      </div>

      {/* Step buttons */}
      <div className="flex gap-1">
        {STEPS.map((step) => (
          <button
            key={step}
            type="button"
            disabled={disabled}
            onClick={() => onChange(step)}
            className={[
              "flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors",
              step === value
                ? BAND_COLOUR[bandOf(value)]
                : "bg-surface text-ink-2 hover:bg-raised",
              disabled ? "opacity-50 cursor-not-allowed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label={`Set confidence to ${step}`}
          >
            {step.toFixed(1)}
          </button>
        ))}
      </div>

      {/* Current value display */}
      <p className="text-sm text-ink-2">
        {value.toFixed(1)} / {t(BAND_LABEL[bandOf(value)])}
      </p>
    </div>
  );
}
