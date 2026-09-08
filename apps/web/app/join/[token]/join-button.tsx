"use client";

import { useActionState } from "react";
import { type JoinState, NO_ERROR } from "./join-state.ts";

/**
 * The one control on the join page, with its refusal beside it (P6-G06b).
 *
 * A refusal here is worth reading and is not the same as the page's own "that
 * invitation cannot be used": by this point the token was usable when the page
 * rendered, so anything that goes wrong now is specific and current. A
 * personal invitation issued to somebody else, or one a second visitor took in
 * the seconds between this page loading and the button being pressed.
 */
export function JoinButton({
  action,
  token,
  children,
}: {
  readonly action: (previous: JoinState, form: FormData) => Promise<JoinState>;
  readonly token: string;
  readonly children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, NO_ERROR);
  return (
    <form action={formAction} aria-busy={pending}>
      <input type="hidden" name="token" value={token} />
      {children}
      {state.error ? (
        <p
          role="alert"
          className="mt-2 rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
