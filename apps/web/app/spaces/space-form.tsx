"use client";

import type { Comparable } from "@openokr/core";
import { RefusedFields } from "@openokr/ui";
import { Fragment, useActionState } from "react";
import {
  ConflictNotice,
  ReadField,
  useConflictForm,
} from "../../lib/conflict-notice.tsx";
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
 *
 * `read` makes it an edit form that cannot overwrite somebody else's change,
 * as `ActionForm`'s does (optimistic-concurrency.md V4).
 */
export function SpaceForm({
  action,
  className,
  read,
  children,
}: {
  readonly action: (
    previous: SpaceWriteState,
    formData: FormData,
  ) => Promise<SpaceWriteState>;
  readonly className?: string;
  /** The values the form was drawn with, by the action's field names. */
  readonly read?: Readonly<Record<string, Comparable>>;
  readonly children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, NO_SPACE_ERROR);
  const { conflict, resending, onSubmit, keepMine, takeTheirs } =
    useConflictForm(state, formAction);
  return (
    <form
      action={formAction}
      onSubmit={read === undefined ? undefined : onSubmit}
      className={className}
      aria-busy={pending}
    >
      {read === undefined ? null : <ReadField read={read} />}
      {/* Each field shows what the server refused about it (U1b). */}
      <RefusedFields fields={state.fields}>
        <Fragment key={read === undefined ? "" : JSON.stringify(read)}>
          {children}
        </Fragment>
      </RefusedFields>
      {conflict ? (
        <ConflictNotice
          conflict={conflict}
          pending={resending || pending}
          onKeepMine={keepMine}
          onTakeTheirs={takeTheirs}
        />
      ) : state.error ? (
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
