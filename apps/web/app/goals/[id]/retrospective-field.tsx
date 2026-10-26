"use client";

/**
 * The close form's retrospective, with a draft from the check-ins on offer
 * (AI-NATIVE-PLAN §2.3, UIUX-PLAN S-17, completeness review M-09).
 *
 * `goals.draftRetrospective` was built at P4-T15c "for the close form" and the
 * close form never called it. The draft arrives in a preview beside the field,
 * and only "Use this draft" puts it in the field, where the champion edits it
 * before closing: METHOD.md §4.3's account of what happened is theirs to give,
 * and a model's draft is a starting point for it rather than the account.
 *
 * **The compact editor** (docs/design/guided-inputs.md §4.7), writing its
 * document into a hidden input once something is in it. Nothing is sent from
 * an empty field, which the close action refuses in words, as it did the
 * empty textarea this replaced.
 */
import { Button, Chip, RichTextEditor, useTranslations } from "@openokr/ui";
import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
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
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<{
    readonly narrative: string;
    readonly document: unknown;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [written, setWritten] = useState<unknown>(null);
  // An editor takes its content once, when it is made, so a draft put in the
  // field makes a new one holding it.
  const [drafts, setDrafts] = useState(0);

  return (
    <>
      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="sr-only">
          {t("goals.detail.theRetrospective")}
        </legend>
        <div className="rounded-control border border-line bg-surface px-2.5 py-1.5 text-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-line">
          <RichTextEditor
            key={drafts}
            autoFocus={drafts > 0}
            label={t("goals.detail.theRetrospective")}
            variant="compact"
            content={written}
            placeholder={t("goals.detail.whatHappenedAndWhat")}
            onUpdate={setWritten}
          />
        </div>
        {written === null ? null : (
          <input
            type="hidden"
            name="retrospective"
            value={JSON.stringify(written)}
          />
        )}
      </fieldset>
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
                      setDraft(drafted);
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
              <p className="whitespace-pre-line text-sm text-ink">
                {draft.narrative}
              </p>
              <span className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setWritten(draft.document);
                    setDrafts((made) => made + 1);
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
