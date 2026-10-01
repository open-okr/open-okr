"use client";

import { Button } from "@openokr/ui";
import { useActionState } from "react";
import { type KeyResult, NOTHING_YET } from "./key-state.ts";

/**
 * One personal key form, with its answer beside it (completeness review M-36).
 *
 * **The field is empty again once the write returns.** React resets a form
 * whose action has finished, so the key a person pasted does not sit in a
 * password box on their screen after it has been stored, or after it was
 * refused. Nothing here holds the value in state either: the only copy is the
 * one in the field until the form posts it.
 *
 * **The button says it is working and cannot be pressed twice.** Sealing a
 * key is quick, but a double press on a slow connection would send the key a
 * second time and write a second audit row for one change.
 */
export function KeyForm({
  action,
  submitLabel,
  busyLabel,
  variant = "default",
  className,
  children,
}: {
  readonly action: (previous: KeyResult, form: FormData) => Promise<KeyResult>;
  readonly submitLabel: string;
  readonly busyLabel: string;
  readonly variant?: "default" | "ghost";
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, NOTHING_YET);
  return (
    <form action={formAction} className={className} aria-busy={pending}>
      {children}
      <Button
        type="submit"
        variant={variant}
        size="sm"
        disabled={pending}
        className="w-fit"
      >
        {pending ? busyLabel : submitLabel}
      </Button>
      {state.message === "" ? null : (
        <p
          role={state.ok ? "status" : "alert"}
          className={
            state.ok
              ? "text-xs text-ok"
              : "rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
          }
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
