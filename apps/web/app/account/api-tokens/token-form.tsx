"use client";

import { useActionState } from "react";
import { NOTHING_YET, type TokenResult } from "./token-state.ts";

/**
 * A form that can hand back a token (P5-T07a).
 *
 * The token is rendered from the action's own answer and nowhere else. There is
 * no state to lose it from and no second render that could show it again,
 * because the row holds only its digest.
 *
 * **A refusal is what the message field is for.** A success message here is
 * unreliable by design: a write revalidates, and a revalidation that changes the
 * tree above a form unmounts it and takes its state. The exception is the token
 * itself, which has nowhere else to live, so it is rendered in the same pass as
 * the answer that produced it.
 */
export function TokenForm({
  action,
  className,
  children,
}: {
  readonly action: (
    previous: TokenResult | null,
    formData: FormData,
  ) => Promise<TokenResult>;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, NOTHING_YET);
  return (
    <form action={formAction} className={className} aria-busy={pending}>
      {children}
      {state.token ? (
        <div className="mt-1.5 flex flex-col gap-1.5 rounded-md bg-brand-weak px-2.5 py-2 text-xs text-brand-text">
          <code
            data-testid="minted-token"
            className="break-all font-mono text-sm font-bold"
          >
            {state.token}
          </code>
          <span>{state.message}</span>
        </div>
      ) : state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={`mt-1.5 rounded-md px-2.5 py-1.5 text-xs ${
            state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
