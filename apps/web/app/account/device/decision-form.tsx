"use client";

import { Button } from "@openokr/ui";
import { useActionState } from "react";
import { type DecisionResult, NOTHING_YET } from "./decision-state.ts";

/**
 * Approve or deny, and say which happened (P5-T07c-b).
 *
 * **Two buttons, not one with a toggle.** Approving a terminal and refusing one
 * are different decisions, and a control where the destructive reading is a
 * click away from the safe one is how somebody approves by accident.
 *
 * **The outcome is rendered from the action's answer**, unlike the other account
 * forms. There is nowhere else for it: once the request is decided it is gone
 * from the pending read, so a reload would show "nothing to approve" and leave a
 * person unsure whether their click landed.
 */
export function DecisionForm({
  action,
  userCode,
}: {
  readonly action: (
    previous: DecisionResult | null,
    formData: FormData,
  ) => Promise<DecisionResult>;
  readonly userCode: string;
}) {
  const [state, formAction, pending] = useActionState(action, NOTHING_YET);

  if (state.decided) {
    return (
      <p
        role="status"
        className={`rounded-md px-2.5 py-2 text-sm ${
          state.approved ? "bg-ok-bg text-ok" : "bg-raised text-ink-2"
        }`}
      >
        {state.message}
      </p>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3"
      aria-busy={pending}
    >
      <input type="hidden" name="userCode" value={userCode} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          name="approve"
          value="yes"
          variant="primary"
          size="sm"
        >
          Authorise this terminal
        </Button>
        <Button
          type="submit"
          name="approve"
          value="no"
          variant="ghost"
          size="sm"
        >
          Refuse
        </Button>
      </div>
      {state.message === "" ? null : (
        <p
          className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
          role="alert"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
