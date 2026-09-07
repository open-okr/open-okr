"use client";

import { useActionState } from "react";
import { NO_SPACE_ERROR, type SpaceWriteState } from "./write-state.ts";

/**
 * A space write whose refusal is part of the screen (P6-G18a).
 *
 * The same shape the cycle workspace's `ActionForm` takes, and for the same
 * reason: an archive refused because the space still holds an open cycle, or a
 * removal refused because it would leave the space with no manager, is a normal
 * outcome and the sentence explaining it was written in `packages/core`. This
 * is what puts it in front of whoever tried.
 *
 * The only client component the space screens have. The pages stay server
 * components and pass their markup through as children, so the data still
 * arrives rendered rather than fetched.
 */
export function SpaceForm({
  action,
  className,
  children,
}: {
  readonly action: (
    previous: SpaceWriteState,
    formData: FormData,
  ) => Promise<SpaceWriteState>;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, NO_SPACE_ERROR);
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
