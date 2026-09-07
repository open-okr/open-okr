"use client";

import { useActionState } from "react";
import { type LinkResult, NOTHING_YET } from "./link-state.ts";

/**
 * A form that can hand back a code (P5-T02c).
 *
 * The code is rendered from the action's own answer and nowhere else. There is
 * no state to lose it from and no second render that could show it again,
 * because the row holds only its hash: this is the one moment it exists.
 *
 * **A refusal is what the message field is for.** A *success* message here is
 * unreliable by design: every write on this page revalidates, and a
 * revalidation that changes the shape of the tree above a form unmounts it and
 * takes its state with it. So a confirmation that matters is rendered from
 * server state instead, the way the saved quiet window is: the inputs come back
 * filled, which is the same fact said more durably.
 */
export function LinkForm({
  action,
  className,
  children,
}: {
  readonly action: (
    previous: LinkResult | null,
    formData: FormData,
  ) => Promise<LinkResult>;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, NOTHING_YET);
  return (
    <form action={formAction} className={className} aria-busy={pending}>
      {children}
      {state.code ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md bg-brand-weak px-2.5 py-2 text-xs text-brand-text">
          <span className="font-mono text-base font-bold tracking-widest">
            {state.code}
          </span>
          <span>{state.message}</span>
        </p>
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
