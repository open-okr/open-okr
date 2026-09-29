"use client";

import { useActionState } from "react";
import { NO_SCHEDULE, type ScheduleState } from "./schedule-state.ts";

/**
 * A scheduling form whose outcome is part of the screen (completeness review
 * H-08): the refusal core wrote, or what was booked and what the cycle still
 * lacks. The card around it stays a server component and passes its fields
 * through as children.
 */
export function ScheduleForm({
  action,
  className,
  children,
}: {
  readonly action: (
    previous: ScheduleState,
    formData: FormData,
  ) => Promise<ScheduleState>;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, NO_SCHEDULE);
  return (
    <form action={formAction} className={className} aria-busy={pending}>
      {children}
      {state.error ? (
        <p
          role="alert"
          className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
        >
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-md bg-ok-bg px-2.5 py-1.5 text-xs text-ok"
        >
          <p>{state.notice}</p>
          {state.details.length > 0 ? (
            <ul className="flex flex-col gap-0.5 text-ink-3">
              {state.details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
