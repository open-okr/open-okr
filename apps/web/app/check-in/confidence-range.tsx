"use client";

import {
  belowCommittedFloor,
  COMMITTED_FLOOR_TEXT,
  type OkrKind,
  type ResolvedThresholds,
} from "@openokr/method";
import { useState } from "react";

/**
 * A key result's confidence in the check-in composer, and §3.2's committed
 * rule said as it is set (P9-T11b-c).
 *
 * The composer is a server form, so the range stays an ordinary named input
 * the form posts; this only watches it. A commitment set below the floor is
 * told now what the Coach will tell its champion once it is published.
 */
export function ConfidenceRange({
  id,
  name,
  defaultValue,
  kind,
  thresholds,
}: {
  readonly id: string;
  readonly name: string;
  readonly defaultValue: number;
  readonly kind: OkrKind;
  readonly thresholds: ResolvedThresholds;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <>
      <input
        id={id}
        name={name}
        type="range"
        min="0"
        max="1"
        step="0.1"
        defaultValue={defaultValue}
        onChange={(event) => setValue(Number(event.target.value))}
        className="w-32"
      />
      {belowCommittedFloor(value, kind, thresholds) ? (
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
