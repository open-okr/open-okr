"use client";

import { Button, useToast, useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  type DeletableSubject,
  restoreSubject,
} from "../../../lib/delete-action.ts";

const RESTORED: Record<DeletableSubject, string> = {
  goal: "deleteControl.restoredGoal",
  key_result: "deleteControl.restoredKeyResult",
  initiative: "deleteControl.restoredInitiative",
  task: "deleteControl.restoredTask",
  document: "deleteControl.restoredDocument",
};

/**
 * Restoring one deleted item (M-13).
 *
 * **No confirmation.** Restoring takes nothing away from anybody, and if it
 * was the wrong one the delete is a press away on the item itself.
 *
 * **A refusal stays beside the row as well as in a toast.** The one refusal a
 * row here can meet names the parent to restore first, and that sentence is
 * needed while the reader goes looking for the parent further down the list,
 * which is longer than a toast lasts.
 */
export function RestoreButton({
  subject,
  id,
  title,
}: {
  readonly subject: DeletableSubject;
  readonly id: string;
  readonly title: string;
}) {
  const { t } = useTranslations();
  const { show } = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  return (
    <div className="flex max-w-sm flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        disabled={pending}
        aria-label={t("admin.deleted.restoreNamed", { title })}
        data-testid="restore-item"
        onClick={() =>
          start(async () => {
            setProblem(null);
            const result = await restoreSubject({ subject, id });
            if (result.error) {
              setProblem(result.error);
              show({ tone: "bad", message: result.error, source: id });
              return;
            }
            show({ tone: "ok", message: t(RESTORED[subject]), source: id });
            router.refresh();
          })
        }
      >
        {pending ? t("admin.deleted.restoring") : t("admin.deleted.restore")}
      </Button>
      {problem ? (
        <span role="alert" className="text-right text-xs text-bad">
          {problem}
        </span>
      ) : null}
    </div>
  );
}
