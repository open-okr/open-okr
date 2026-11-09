"use client";

import { Button, useTranslations } from "@openokr/ui";
import { useActionState, useId } from "react";
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
 *
 * **A quarterly stage that is not done says so before anybody presses**
 * (plan 0.7.0, S1). Its condition is shown and never enforced, by Akmal's
 * decision of 9 November 2026, so the control names what is missing and
 * offers to move on anyway. Stage two is the exception METHOD.md §8.3 makes:
 * scoring does not close on an unexplained committed miss, so there the
 * control keeps its ordinary words and the refusal still comes from the
 * action.
 */
export function AdvanceControl({
  sessionId,
  stageKey,
  missing = null,
  refuses = false,
}: {
  readonly sessionId: string;
  /** The stage on screen, so a stale advance is refused (plan 0.7.0, S2). */
  readonly stageKey: string | null;
  /**
   * What the running stage is missing, already in the reader's language, or
   * null when it is done or has no condition to meet.
   */
  readonly missing?: string | null;
  /** Whether the advance is refused until the gap closes: stage two only. */
  readonly refuses?: boolean;
}) {
  const { t } = useTranslations();
  const noteId = useId();
  const [state, submit, pending] = useActionState<CommitmentState, FormData>(
    advanceStageWithReason,
    NO_ERROR,
  );
  const movesOnAnyway = missing !== null && !refuses;
  return (
    <form action={submit} aria-busy={pending} className="flex flex-col gap-1.5">
      <input type="hidden" name="sessionId" value={sessionId} />
      {stageKey === null ? null : (
        <input type="hidden" name="fromStageKey" value={stageKey} />
      )}
      {missing === null ? null : (
        <div id={noteId} className="flex max-w-prose flex-col gap-0.5">
          <p className="text-xs text-ink-2">
            {t("session.detail.advanceControl.notDoneYet", { missing })}
          </p>
          {refuses ? (
            <p className="text-xs text-ink-3">
              {t("session.detail.advanceControl.scoringClosesOnExplanations")}
            </p>
          ) : null}
        </div>
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={pending}
        aria-describedby={missing === null ? undefined : noteId}
      >
        {pending
          ? t("session.detail.advanceControl.continuing")
          : movesOnAnyway
            ? t("session.detail.advanceControl.moveOnAnyway")
            : t("session.detail.advanceControl.continueToNextStep")}
      </Button>
      {state.error === null ? null : (
        <p role="alert" className="max-w-prose text-xs text-bad">
          {state.error}
        </p>
      )}
    </form>
  );
}
