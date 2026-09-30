"use client";

import { Button, useToast, useTranslations } from "@openokr/ui";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  type DeletableSubject,
  deleteSubject,
  restoreSubject,
} from "./delete-action.ts";

/**
 * The sentences for each subject, whole, so a translator never has to fit
 * "this goal" into the middle of somebody else's sentence. The explanation is
 * one sentence for all four, because it names none of them.
 */
const WORDS: Record<
  DeletableSubject,
  {
    readonly button: string;
    readonly deleted: string;
    readonly restored: string;
  }
> = {
  goal: {
    button: "deleteControl.deleteGoal",
    deleted: "deleteControl.deletedGoal",
    restored: "deleteControl.restoredGoal",
  },
  initiative: {
    button: "deleteControl.deleteInitiative",
    deleted: "deleteControl.deletedInitiative",
    restored: "deleteControl.restoredInitiative",
  },
  task: {
    button: "deleteControl.deleteTask",
    deleted: "deleteControl.deletedTask",
    restored: "deleteControl.restoredTask",
  },
  document: {
    button: "deleteControl.deleteDocument",
    deleted: "deleteControl.deletedDocument",
    restored: "deleteControl.restoredDocument",
  },
};

/**
 * Deleting one thing, with an undo rather than an "are you sure" (P6-G27,
 * completeness review M-13).
 *
 * **One press, then six seconds to take it back.** UIUX-PLAN §1's seventh
 * principle and §4's undo row give reversible destruction an undo toast and
 * keep a confirmation for what cannot be undone. A delete here is soft and
 * can be undone, so this used to ask twice and could not take anything back,
 * which is the pattern the plan rules out. The sentence that used to sit
 * between the two presses, what a delete is in this product, is in the toast
 * now, beside the Undo that makes it true.
 *
 * **The toast outlives this page.** A delete sends the reader somewhere else,
 * because this page will not exist, and the toast is raised on the provider in
 * the root layout, so it is waiting on the page they land on. Undo restores and
 * brings them back here.
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
  const { show } = useToast();
  const router = useRouter();
  const here = usePathname();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const words = WORDS[subject];

  // Runs after this component has gone, from the toast on the next page. It
  // touches nothing of this component's own state for that reason: the
  // router and the toast provider both live above every page.
  const undo = async () => {
    const result = await restoreSubject({ subject, id });
    if (result.error) {
      show({ tone: "bad", message: result.error, source: `delete-${id}` });
      return;
    }
    show({ tone: "ok", message: t(words.restored), source: `delete-${id}` });
    router.push(here);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid={`delete-${subject}`}>
      <div>
        <Button
          type="button"
          size="sm"
          // No `danger` variant exists in the design system and inventing
          // one here would be a design decision taken in a feature. The
          // token colours the label instead.
          className="text-bad"
          disabled={pending}
          data-testid={`delete-${subject}-button`}
          onClick={() =>
            start(async () => {
              setProblem(null);
              const result = await deleteSubject({ subject, id });
              if (result.error) {
                setProblem(result.error);
                return;
              }
              show({
                tone: "ok",
                title: t(words.deleted),
                message: t("deleteControl.explain"),
                source: `delete-${id}`,
                action: {
                  label: t("deleteControl.undo"),
                  run: () => {
                    void undo();
                  },
                },
              });
              router.push(returnTo);
              router.refresh();
            })
          }
        >
          {t(words.button)}
        </Button>
      </div>

      {problem ? (
        <span role="alert" className="text-xs text-bad">
          {problem}
        </span>
      ) : null}
    </div>
  );
}
