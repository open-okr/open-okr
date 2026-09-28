"use client";

import { Button, useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type DeletableSubject, deleteSubject } from "./delete-action.ts";

/**
 * The two sentences for each subject, whole, so a translator never has to fit
 * "this goal" into the middle of somebody else's sentence.
 */
const WORDS: Record<
  DeletableSubject,
  { readonly explain: string; readonly confirm: string }
> = {
  goal: {
    explain: "deleteControl.explainGoal",
    confirm: "deleteControl.deleteGoal",
  },
  initiative: {
    explain: "deleteControl.explainInitiative",
    confirm: "deleteControl.deleteInitiative",
  },
  task: {
    explain: "deleteControl.explainTask",
    confirm: "deleteControl.deleteTask",
  },
  document: {
    explain: "deleteControl.explainDocument",
    confirm: "deleteControl.deleteDocument",
  },
};

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
  returnTo,
}: {
  readonly subject: DeletableSubject;
  readonly id: string;
  /** Where the reader goes once it is gone, because this page will not exist. */
  readonly returnTo: string;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1.5" data-testid={`delete-${subject}`}>
      {armed ? (
        <>
          <span className="text-xs text-ink-3">
            {t(WORDS[subject].explain)}
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
              {t(WORDS[subject].confirm)}
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
              {t("deleteControl.keepIt")}
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
            {t("common.delete")}
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
