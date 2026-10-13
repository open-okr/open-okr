"use client";

import {
  belowCommittedFloor,
  COMMITTED_FLOOR_TEXT,
  type OkrKind,
  type ResolvedThresholds,
} from "@openokr/method";
import {
  type ConfidenceDisplay,
  ConfidenceInput,
  useTranslations,
} from "@openokr/ui";
import { useState } from "react";

/**
 * A key result's confidence in the check-in composer, and §3.2's committed
 * rule said as it is set (P9-T11b-c).
 *
 * `ConfidenceInput` (guided-inputs §4.8): shown the way the workspace's
 * practice says, with its band, and posted as the stored 0.0 to 1.0 under
 * the composer's own field name, so the server form reads it as it always
 * did. This only watches it, and a commitment set below the floor is told
 * now what the Coach will tell its champion once it is published.
 */
export function ConfidenceRange({
  id,
  label,
  name,
  defaultValue,
  kind,
  thresholds,
  display,
}: {
  readonly id: string;
  /** The field's name, naming its key result. */
  readonly label: string;
  readonly name: string;
  readonly defaultValue: number;
  readonly kind: OkrKind;
  readonly thresholds: ResolvedThresholds;
  readonly display: ConfidenceDisplay;
}) {
  const { t } = useTranslations();
  const [value, setValue] = useState<number | null>(defaultValue);
  return (
    <>
      {/* The word the row shows; the field's own name says which key result. */}
      <span aria-hidden="true" className="text-xs text-ink-3">
        {t("common.confidence")}
      </span>
      <ConfidenceInput
        id={id}
        label={label}
        hideLabel
        name={name}
        value={value}
        onValueChange={setValue}
        display={display}
        thresholds={thresholds}
      />
      {value !== null && belowCommittedFloor(value, kind, thresholds) ? (
        <span
          data-testid="committed-floor"
          className="rounded-control bg-warn-bg px-2 py-1 text-xs text-warn"
        >
          {COMMITTED_FLOOR_TEXT}
        </span>
      ) : null}
    </>
  );
}
