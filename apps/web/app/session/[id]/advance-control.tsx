"use client";

import { Button } from "@openokr/ui";
import { useActionState } from "react";
import { advanceStageWithReason } from "./commitment-actions.ts";
import { type CommitmentState, NO_ERROR } from "./commitment-state.ts";

/**
 * "Continue to next step", with the refusal shown (P6-G19a).
 *
 * **Every stage gate was invisible before this.** `sessions.advanceStage`
 * refuses with a sentence naming what is missing, and the control was an
 * inline server action inside a plain form, so the refusal reached the error
 * boundary: the facilitator saw "something went wrong" in front of a room
 * instead of "at least 2 commitments are required, but only 1 was set".
 *
 * The gate itself is unchanged. What changes is that its own words arrive.
 */
export function AdvanceControl({ sessionId }: { readonly sessionId: string }) {
  const [state, submit, pending] = useActionState<CommitmentState, FormData>(
    advanceStageWithReason,
    NO_ERROR,
  );
  return (
    <form action={submit} aria-busy={pending} className="flex flex-col gap-1.5">
      <input type="hidden" name="sessionId" value={sessionId} />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Continuing…" : "Continue to next step"}
      </Button>
      {state.error === null ? null : (
        <p role="alert" className="max-w-prose text-xs text-bad">
          {state.error}
        </p>
      )}
    </form>
  );
}
