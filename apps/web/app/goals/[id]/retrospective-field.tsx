"use client";

/**
 * The close form's retrospective, with a draft from the check-ins on offer
 * (AI-NATIVE-PLAN §2.3, UIUX-PLAN S-17, completeness review M-09).
 *
 * `goals.draftRetrospective` was built at P4-T15c "for the close form" and the
 * close form never called it. The textarea is the same field it always was,
 * required and uncontrolled, so the form posts exactly what it posted before.
 * The draft arrives in a preview beside it, and only "Use this draft" puts it
 * in the field, where the champion edits it before closing: METHOD.md §4.3's
 * account of what happened is theirs to give, and a model's draft is a
 * starting point for it rather than the account.
 */
import { Button, Chip, useTranslations } from "@openokr/ui";
import { Sparkles } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { draftRetrospectiveAction } from "./assist-actions.ts";

export function RetrospectiveField({
  goalId,
  offered,
}: {
  readonly goalId: string;
  /** Whether a provider may draft it. False is the normal case. */
  readonly offered: boolean;
}) {
  const { t } = useTranslations();
  const field = useRef<HTMLTextAreaElement>(null);
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <label className="sr-only" htmlFor="close-retrospective">
        {t("goals.detail.theRetrospective")}
      </label>
      <textarea
        id="close-retrospective"
        ref={field}
        name="retrospective"
        rows={4}
        required
        placeholder={t("goals.detail.whatHappenedAndWhat")}
        className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
      />
      {offered ? (
        <div
          className="flex flex-col gap-1.5"
          data-testid="retrospective-draft"
        >
          {draft === null ? (
            <Button
              type="button"
              variant="ai"
              size="sm"
              className="self-start"
              disabled={pending}
              onClick={() => {
                setNotice(null);
                start(async () => {
                  try {
                    const drafted = await draftRetrospectiveAction(goalId);
                    if (drafted) {
                      setDraft(drafted.narrative);
                    } else {
                      setNotice(t("goals.detail.retrospectiveDraft.nothing"));
                    }
                  } catch {
                    setNotice(t("assists.reading.couldNotRun"));
                  }
                });
              }}
            >
              <Sparkles className="size-3" />
              {pending
                ? t("assists.reading.working")
                : t("goals.detail.retrospectiveDraft.draft")}
            </Button>
          ) : (
            <section
              aria-label={t("goals.detail.retrospectiveDraft.draft")}
              className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-3"
            >
              <span className="flex items-center gap-2">
                <Chip tone="agent">{t("common.ai")}</Chip>
                <span className="text-xs text-ink-4">
                  {t("goals.detail.retrospectiveDraft.fromTheCheckIns")}
                </span>
              </span>
              <p className="whitespace-pre-line text-sm text-ink">{draft}</p>
              <span className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    if (field.current) {
                      field.current.value = draft;
                      field.current.focus();
                    }
                    setDraft(null);
                    setNotice(t("goals.detail.retrospectiveDraft.editIt"));
                  }}
                >
                  {t("goals.detail.retrospectiveDraft.useIt")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft(null)}
                >
                  {t("common.dismiss")}
                </Button>
              </span>
            </section>
          )}
          {notice ? (
            <p role="status" className="text-xs text-ink-4">
              {notice}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
