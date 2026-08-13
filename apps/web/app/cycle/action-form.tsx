"use client";

import { useActionState } from "react";
import { NO_ERROR, type WriteState } from "./write-state.ts";

/**
 * A form whose refusal is part of the screen.
 *
 * Every write on this page can be refused for a reason worth reading: a closed
 * cycle does not change, a second calibration is not allowed, a set cannot be
 * published through a red gate. Those sentences are written in `packages/core`
 * and this is what puts them in front of the person who tried.
 *
 * The only client-side component in the cycle workspace. The panels stay server
 * components and pass their markup through as children, so the page's data still
 * arrives rendered rather than fetched.
 */
export function ActionForm({
  action,
  className,
  children,
}: {
  readonly action: (
    previous: WriteState,
    formData: FormData,
  ) => Promise<WriteState>;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, NO_ERROR);
  return (
    <form action={formAction} className={className} aria-busy={pending}>
      {children}
      {state.error ? (
        <p
          role="alert"
          className="mt-1.5 rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
