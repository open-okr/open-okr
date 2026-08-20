"use client";

/**
 * Confidence dial: 0.0 to 1.0 in 0.1 steps (METHOD.md §7.2, P4-T07b).
 *
 * Band shortcuts at 0.3 (critical), 0.4 (low), 0.7 (high) per §3.2.
 * Colour maps to the confidence band: green for high, amber for medium,
 * red for low. The dial is a row of buttons rather than a draggable arc,
 * because ten buttons that work on every device beat a gesture that
 * breaks on mobile.
 */

const STEPS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
const BAND_SHORTCUTS = [
  { value: 0.3, label: "Critical" },
  { value: 0.4, label: "Low" },
  { value: 0.7, label: "High" },
];

function bandColor(value: number): string {
  if (value >= 0.7) return "bg-good text-white";
  if (value >= 0.4) return "bg-warn text-ink";
  return "bg-bad text-white";
}

function bandLabel(value: number): string {
  if (value >= 0.7) return "High";
  if (value >= 0.4) return "Medium";
  return "Low";
}

interface ConfidenceDialProps {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly disabled?: boolean;
}

export function ConfidenceDial({
  value,
  onChange,
  disabled = false,
}: ConfidenceDialProps) {
  return (
    <div className="space-y-2">
      {/* Band shortcuts */}
      <div className="flex gap-2">
        {BAND_SHORTCUTS.map((shortcut) => (
          <button
            key={shortcut.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(shortcut.value)}
            className={[
              "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
              value === shortcut.value
                ? bandColor(shortcut.value)
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
                ? bandColor(value)
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
        {value.toFixed(1)} / {bandLabel(value)}
      </p>
    </div>
  );
}
