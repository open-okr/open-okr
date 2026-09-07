"use client";

import { useActionState } from "react";
import { type FormResult, NOTHING_YET } from "./form-state.ts";

/**
 * A form whose answer is part of the screen (P5-T02c).
 *
 * Both halves are worth reading here, not only the refusal. "Stored, and
 * nothing has called the provider yet" is a success message that stops an
 * administrator believing a green tick means the credential works, which is the
 * whole reason `last_verified_at` stays null until something actually calls.
 */
export function ChannelForm({
  action,
  className,
  children,
}: {
  readonly action: (
    previous: FormResult | null,
    formData: FormData,
  ) => Promise<FormResult>;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, NOTHING_YET);
  return (
    <form action={formAction} className={className} aria-busy={pending}>
      {children}
      {state.message ? (
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
