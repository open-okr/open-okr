"use client";

import { Button } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type DeletableSubject, deleteSubject } from "./delete-action.ts";

/**
 * Deleting one thing, and saying what that means (P6-G27).
 *
 * **Two presses, and the second one says what the first would do.** A confirm
 * dialog would be the ordinary answer and it is the wrong one here: the thing
 * worth telling somebody is not "are you sure" but *what a delete is in this
 * product*, which is a soft delete. Nothing is destroyed, the history stays
 * readable, and it drops out of every default-scoped read. That sentence does
 * not fit in a dialog title and does fit here.
 *
 * **It is not offered below `full`.** The four actions all require it, so a
 * button that appeared and then failed would be the interface lying about what
 * the reader can do. The page decides.
 */
export function DeleteControl({
  subject,
  id,
  what,
  returnTo,
}: {
  readonly subject: DeletableSubject;
  readonly id: string;
  /** What is being deleted, in words: "this goal", "this document". */
  readonly what: string;
  /** Where the reader goes once it is gone, because this page will not exist. */
  readonly returnTo: string;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1.5" data-testid={`delete-${subject}`}>
      {armed ? (
        <>
          <span className="text-xs text-ink-3">
            Deleting {what} takes it off every list and out of every search.
            Nothing is destroyed: the history stays readable, and an
            administrator can bring it back.
          </span>
          <div className="flex flex-wrap gap-2.5">
            <Button
              type="button"
              size="sm"
              // No `danger` variant exists in the design system and inventing
              // one here would be a design decision taken in a feature. The
              // token colours the label instead.
              className="text-bad"
              disabled={pending}
              data-testid={`delete-${subject}-confirm`}
              onClick={() =>
                start(async () => {
                  const result = await deleteSubject({ subject, id });
                  if (result.error) {
                    setProblem(result.error);
                    return;
                  }
                  router.push(returnTo);
                  router.refresh();
                })
              }
            >
              Delete {what}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => {
                setArmed(false);
                setProblem(null);
              }}
            >
              Keep it
            </Button>
          </div>
        </>
      ) : (
        <div>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            data-testid={`delete-${subject}-arm`}
            onClick={() => setArmed(true)}
          >
            Delete
          </Button>
        </div>
      )}

      {problem ? (
        <span role="alert" className="text-xs text-bad">
          {problem}
        </span>
      ) : null}
    </div>
  );
}
