"use client";

import { Button, useTranslations } from "@openokr/ui";
import { useActionState } from "react";
import { NO_ERROR } from "./[token]/join-state.ts";
import { joinTrustedWorkspace } from "./trusted-actions.ts";

/**
 * One workspace a person's domain admits, and the one press that joins it
 * (completeness review M-34).
 *
 * Shared by the join page and the front door, so the offer reads and behaves
 * the same wherever somebody meets it. The refusal sits beside the button that
 * caused it: by the time anybody presses this the workspace was on offer, so
 * whatever goes wrong now, a full workspace or one frozen in the meantime, is
 * specific and worth reading.
 */
export function TrustedOfferForm({
  workspaceId,
  workspaceName,
}: {
  readonly workspaceId: string;
  readonly workspaceName: string;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    joinTrustedWorkspace,
    NO_ERROR,
  );
  return (
    <form
      action={formAction}
      aria-busy={pending}
      className="flex flex-col gap-1.5"
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold text-ink">
          {workspaceName}
        </span>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {t("common.join2", { workspaceName })}
        </Button>
      </div>
      {state.error ? (
        <p
          role="alert"
          className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
