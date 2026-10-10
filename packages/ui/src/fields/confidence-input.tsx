"use client";

import {
  type ConfidenceBand,
  confidenceBand,
  type ResolvedThresholds,
} from "@openokr/method";
import { useState } from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import {
  CONFIDENCE_SCALE,
  type ConfidenceDisplay,
  confidenceShown,
  confidenceStored,
} from "./confidence-format.ts";
import { NumberInput } from "./number-input.tsx";

const BAND_CLASS: Readonly<Record<ConfidenceBand, string>> = {
  high: "bg-ok-bg text-ok",
  medium: "bg-warn-bg text-warn",
  low: "bg-bad-bg text-bad",
};

export interface ConfidenceInputProps {
  readonly label: string;
  /** The label is the field's accessible name only, as in a table cell. */
  readonly hideLabel?: boolean;
  /** The form field the stored 0.0 to 1.0 is posted as. */
  readonly name?: string;
  readonly id?: string;
  /** Controlled, stored 0.0 to 1.0. Null is an empty field. */
  readonly value?: number | null;
  readonly defaultValue?: number | null;
  readonly onValueChange?: (confidence: number | null) => void;
  /** The workspace's "Confidence shown as". "x in 10" by default. */
  readonly display?: ConfidenceDisplay;
  /** The workspace's §3.2 bands, for the band named beside the number. */
  readonly thresholds?: ResolvedThresholds;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly inputClassName?: string;
}

/**
 * A confidence (docs/design/guided-inputs.md §4.8). It is stored 0.0 to 1.0
 * everywhere, as it always was, and shown the way the workspace's practice
 * setting says: "7 in 10" by default, "0.7", or "70%". The §3.2 band is named
 * beside it, from the workspace's own thresholds, so a person setting 4 sees
 * that it reads as medium before they publish it.
 *
 * It replaces the 0 to 10 boxes, the sliders that never showed their value,
 * and each one's own scale: one field, one scale per workspace.
 */
export function ConfidenceInput({
  label,
  hideLabel,
  name,
  id,
  value,
  defaultValue,
  onValueChange,
  display = "xIn10",
  thresholds,
  required,
  disabled,
  className,
  inputClassName,
}: ConfidenceInputProps) {
  const { t } = useTranslations();
  const [own, setOwn] = useState<number | null>(defaultValue ?? null);
  const stored = value !== undefined ? value : own;
  const scale = CONFIDENCE_SCALE[display];
  const band =
    thresholds && stored !== null
      ? confidenceBand(stored, thresholds).band
      : null;
  // One literal call per key, so the catalogue's own check can see each.
  const bandLabel: Record<ConfidenceBand, string> = {
    high: t("fields.confidence.high"),
    medium: t("fields.confidence.medium"),
    low: t("fields.confidence.low"),
  };

  return (
    <div className={cn("flex items-end gap-1.5", className)}>
      <NumberInput
        id={id}
        label={label}
        hideLabel={hideLabel}
        value={stored === null ? null : confidenceShown(stored, display)}
        onValueChange={(next) => {
          const confidence =
            next === null ? null : confidenceStored(next, display);
          if (value === undefined) {
            setOwn(confidence);
          }
          onValueChange?.(confidence);
        }}
        min={0}
        max={scale.max}
        step={scale.step}
        unit={
          display === "xIn10"
            ? t("fields.confidence.inTen")
            : display === "percent"
              ? "%"
              : null
        }
        required={required}
        disabled={disabled}
        inputClassName={cn("w-16 text-right", inputClassName)}
      />
      {band ? (
        <span
          className={cn(
            "mb-1 rounded-control px-1.5 py-0.5 text-xs font-medium",
            BAND_CLASS[band],
          )}
        >
          {bandLabel[band]}
        </span>
      ) : null}
      {name ? (
        <input
          type="hidden"
          name={name}
          value={stored === null ? "" : String(stored)}
        />
      ) : null}
    </div>
  );
}
