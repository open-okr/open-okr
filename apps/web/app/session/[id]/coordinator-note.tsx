"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  useTranslations,
} from "@openokr/ui";
import { useActionState } from "react";
import { setCoordinatorNoteAction } from "./blocker-actions.ts";
import { NO_ERROR } from "./commitment-state.ts";

/**
 * §7.2 step 4's last sentence: "The coordinator adds a note for leadership"
 * (S-22, P6-G19b).
 *
 * **The line was already in the digest and nothing could write it.**
 * `packages/method`'s digest builder has taken a `coordinatorNote` since
 * P4-T15b and `sessions.setCoordinatorNote` shipped at P4-T08, so the note
 * rendered whenever it existed and no surface could put one there.
 *
 * It sits beside the digest rather than in the minutes because the digest is
 * what leaves the room, and **after the session closes rather than on step 4**:
 * the note is written onto the digest row and `sessions.close` is what creates
 * that row, so the same form one stage earlier refuses every press.
 */
export function CoordinatorNote({
  sessionId,
  note,
}: {
  readonly sessionId: string;
  /** What is stored, or null before anybody wrote one. */
  readonly note: string | null;
}) {
  const { t } = useTranslations();

  const [state, submit, pending] = useActionState(
    setCoordinatorNoteAction,
    NO_ERROR,
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("session.detail.coordinatorNote.theCoordinatorSNote")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("session.detail.coordinatorNote.oneParagraphForLeadership")}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <form
          action={submit}
          aria-busy={pending}
          className="flex flex-col gap-2"
        >
          <input type="hidden" name="sessionId" value={sessionId} />
          <textarea
            name="note"
            rows={3}
            defaultValue={note ?? ""}
            className="w-full max-w-prose rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
          />
          <Button
            type="submit"
            variant="default"
            size="sm"
            disabled={pending}
            className="self-start"
          >
            {pending ? "Saving…" : note ? "Replace the note" : "Add the note"}
          </Button>
          {state.error === null ? null : (
            <p role="alert" className="text-xs text-bad">
              {state.error}
            </p>
          )}
        </form>
      </CardBody>
    </Card>
  );
}
