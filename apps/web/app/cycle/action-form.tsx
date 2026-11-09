"use client";

import type { Comparable } from "@openokr/core";
import { RefusedFields } from "@openokr/ui";
import { Fragment, useActionState } from "react";
import {
  ConflictNotice,
  ReadField,
  useConflictForm,
} from "../../lib/conflict-notice.tsx";
import { NO_ERROR, type WriteState } from "./write-state.ts";

/**
 * A form whose refusal is part of the screen.
 *
 * Every write on this page can be refused for a reason worth reading: a closed
 * cycle does not change, an agreed frame is not revised without a reason, a set cannot be
 * published through a red gate. Those sentences are written in `packages/core`
 * and this is what puts them in front of the person who tried.
 *
 * The only client-side component in the cycle workspace. The panels stay server
 * components and pass their markup through as children, so the page's data still
 * arrives rendered rather than fetched.
 *
 * **`read` makes it an edit form that cannot overwrite somebody else's
 * change** (optimistic-concurrency.md V4). It carries the values the form
 * was drawn with, the action sends only what changed with them, and a field
 * somebody moved since comes back as a conflict with keep mine and take
 * theirs. The fields are drawn again whenever what was read changes, so
 * taking theirs, or a save, shows what is stored.
 */
export function ActionForm({
  action,
  className,
  label,
  read,
  readLabels,
  children,
}: {
  readonly action: (
    previous: WriteState,
    formData: FormData,
  ) => Promise<WriteState>;
  readonly className?: string;
  /**
   * The form's accessible name, where a page repeats the same form. The
   * drafting step has one "add a key result" form per objective, and without
   * a name a screen reader announces six identical forms (M-07).
   */
  readonly label?: string;
  /** The values the form was drawn with, by the action's field names. */
  readonly read?: Readonly<Record<string, Comparable>>;
  /** Words for a stored value a conflict shows: a member's name for an id. */
  readonly readLabels?: Readonly<Record<string, string>>;
  readonly children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, NO_ERROR);
  const { conflict, resending, onSubmit, keepMine, takeTheirs } =
    useConflictForm(state, formAction);
  return (
    <form
      action={formAction}
      onSubmit={read === undefined ? undefined : onSubmit}
      className={className}
      aria-busy={pending}
      aria-label={label}
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
          {...(readLabels ? { labels: readLabels } : {})}
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
      ) : state.notice ? (
        <p
          role="status"
          className="mt-1.5 rounded-md bg-ok-bg px-2.5 py-1.5 text-xs text-ok"
        >
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}
