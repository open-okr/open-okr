"use client";

import { useState, useTransition } from "react";
import type { WriteState } from "../../cycle/write-state.ts";

/**
 * Removes one link, and says why when it cannot (S-26, P5-T10b).
 *
 * The same shape as `InlineSelect` and for the same reason: the refusal is a
 * sentence written in `packages/core`, and a control that just did nothing
 * would leave a reader guessing whether they lacked access or the click
 * missed.
 */
export function UnlinkButton({
  label,
  onUnlink,
}: {
  readonly label: string;
  readonly onUnlink: () => Promise<WriteState>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        aria-label={label}
        disabled={pending}
        className="rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:border-bad hover:text-bad disabled:text-ink-4"
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const state = await onUnlink();
            if (state.error) {
              setError(state.error);
            }
          });
        }}
      >
        Unlink
      </button>
      {error ? (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      ) : null}
    </span>
  );
}
