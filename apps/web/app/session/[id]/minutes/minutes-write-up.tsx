"use client";

/**
 * A prose write-up of the review, drafted from its own record (AI-NATIVE-PLAN
 * §2.3, UIUX-PLAN S-25, completeness review M-09).
 *
 * `sessions.draftMinutes` was built at P4-T15c "on the minutes screen" and the
 * minutes screen never called it. The generated minutes below are the record
 * and are untouched. The draft arrives in the full editor (guided-inputs
 * §4.7), since what it becomes is a document, and only "Save as a draft
 * document" keeps it, as a document on the session that is private to the
 * person who saved it until they publish it. Nothing is written by the model
 * on its own.
 */
import {
  Button,
  Chip,
  isBlankDocument,
  RichTextEditor,
  useTranslations,
} from "@openokr/ui";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { draftMinutesAction, saveMinutesWriteUpAction } from "../actions.ts";

export function MinutesWriteUp({
  sessionId,
  title,
}: {
  readonly sessionId: string;
  /** The minutes' own title, which the saved document is named after. */
  readonly title: string;
}) {
  const { t } = useTranslations();
  const [pending, start] = useTransition();
  // The draft as it arrived, which the editor opens on, and what is in the
  // editor now. Null before anything was drafted.
  const [draft, setDraft] = useState<unknown>(null);
  const [written, setWritten] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  return (
    <section
      className="flex flex-col gap-2"
      data-testid="minutes-write-up"
      aria-label={t("session.detail.minutes.writeUp.heading")}
    >
      {saved ? (
        <p role="status" className="text-sm text-ok">
          {t("session.detail.minutes.writeUp.saved")}{" "}
          <Link className="underline" href={`/documents/${saved}`}>
            {t("session.detail.minutes.writeUp.openIt")}
          </Link>
        </p>
      ) : draft === null ? (
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
                const drafted = await draftMinutesAction(sessionId);
                if (drafted) {
                  setDraft(drafted.document);
                  setWritten(drafted.document);
                } else {
                  setNotice(t("assists.reading.nothingThisTime"));
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
            : t("session.detail.minutes.writeUp.draft")}
        </Button>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
          <span className="flex items-center gap-2">
            <Chip tone="agent">{t("common.ai")}</Chip>
            <span className="text-xs text-ink-4">
              {t("session.detail.minutes.writeUp.editBeforeSaving")}
            </span>
          </span>
          <div className="rounded-md border border-line bg-surface p-2 text-sm text-ink focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-line">
            <RichTextEditor
              label={t("session.detail.minutes.writeUp.heading")}
              content={draft}
              editable={!pending}
              onUpdate={setWritten}
            />
          </div>
          <span className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={pending || isBlankDocument(written)}
              onClick={() => {
                setNotice(null);
                start(async () => {
                  const result = await saveMinutesWriteUpAction(
                    sessionId,
                    t("session.detail.minutes.writeUp.titleOf", { title }),
                    written,
                  );
                  if ("error" in result) {
                    setNotice(result.error);
                    return;
                  }
                  setSaved(result.documentId);
                  setDraft(null);
                });
              }}
            >
              {t("session.detail.minutes.writeUp.saveAsDraft")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setDraft(null)}
            >
              {t("common.dismiss")}
            </Button>
          </span>
        </div>
      )}
      {notice ? (
        <p role="status" className="text-xs text-ink-4">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
