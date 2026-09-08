"use client";

import { useActionState } from "react";
import { type FormResult, NOTHING_YET } from "./form-state.ts";

/**
 * One form on the AI console, with its answer beside it (S-37, P6-G12a).
 *
 * Every write here can be refused for a reason worth reading: a key the
 * provider rejects, a model id already in the catalogue, a tier pointed at a
 * model this workspace does not have. This is what puts those sentences in
 * front of the administrator who tried, rather than leaving a button that
 * appears to do nothing.
 *
 * It reports success too, which most forms in this product do not need to.
 * Storing a provider key looks identical to storing nothing, because the card
 * deliberately never renders the key back, so "Stored" is the only evidence
 * the administrator gets that anything happened.
 */
export function AIForm({
  action,
  className,
  children,
}: {
  readonly action: (
    previous: FormResult,
    form: FormData,
  ) => Promise<FormResult>;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, NOTHING_YET);
  return (
    <form action={formAction} className={className} aria-busy={pending}>
      {children}
      {state.message === "" ? null : (
        <p
          role={state.ok ? "status" : "alert"}
          className={
            state.ok
              ? "mt-1.5 text-xs text-ok"
              : "mt-1.5 rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
          }
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
