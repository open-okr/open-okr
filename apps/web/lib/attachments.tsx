"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { detachAttachment, uploadAttachment } from "./attachment-actions.ts";

/**
 * Files on a subject (P6-G27b).
 *
 * **The panel the seven attachment actions never had.** Uploading, listing,
 * downloading and detaching were all built and none of them was reachable, so
 * the byte quota guarded a door nobody could open.
 *
 * **The size is shown, because the quota is real.** A workspace has a byte
 * ceiling and `blobs.prepareUpload` refuses past it; a reader who cannot see
 * what they are using meets that refusal as a mystery. The refusal itself is
 * shown in the message the action returns rather than reworded here.
 *
 * **A link, not a fetch.** The download is an ordinary anchor to a route that
 * checks access and streams the bytes, so it behaves the way a file link
 * behaves: middle-click, save-as, and a progress bar that is the browser's.
 */

export interface AttachmentRow {
  readonly id: string;
  readonly blobId: string;
  readonly filename: string;
  readonly contentType: string;
  /** Null until `blobs.claimUpload` recorded what was written. */
  readonly filesize: number | null;
}

const readableSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function Attachments({
  subjectType,
  subjectId,
  attachments,
  canEdit,
}: {
  readonly subjectType: "document" | "initiative";
  readonly subjectId: string;
  readonly attachments: readonly AttachmentRow[];
  readonly canEdit: boolean;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("attachments.title")}
          </h2>
          <p className="text-xs text-ink-3">{t("attachments.explains")}</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-2.5">
        {attachments.length === 0 ? (
          <p className="text-sm text-ink-3">{t("attachments.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5" data-testid="attachment-list">
            {attachments.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-baseline justify-between gap-2"
              >
                <a
                  href={`/api/blobs/${file.blobId}`}
                  className="min-w-0 text-sm text-brand-text hover:underline"
                >
                  {file.filename}
                </a>
                <span className="flex items-center gap-2.5 text-xs text-ink-4">
                  {file.filesize === null
                    ? t("attachments.sizeUnknown")
                    : readableSize(file.filesize)}
                  {canEdit ? (
                    <button
                      type="button"
                      disabled={pending}
                      data-testid={`detach-${file.id}`}
                      onClick={() =>
                        start(async () => {
                          const result = await detachAttachment({
                            id: file.id,
                          });
                          setProblem(result.error);
                          if (!result.error) {
                            router.refresh();
                          }
                        })
                      }
                      className="text-ink-4 hover:text-bad"
                    >
                      {t("attachments.detach")}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              ref={input}
              type="file"
              disabled={pending}
              aria-label={t("attachments.field")}
              data-testid="attachment-input"
              className="text-xs text-ink-2"
            />
            <Button
              type="button"
              size="sm"
              disabled={pending}
              data-testid="attachment-upload"
              onClick={() => {
                const chosen = input.current?.files?.[0];
                if (!chosen) {
                  setProblem(t("attachments.chooseFirst"));
                  return;
                }
                const form = new FormData();
                form.set("file", chosen);
                form.set("subjectType", subjectType);
                form.set("subjectId", subjectId);
                setProblem(null);
                start(async () => {
                  const result = await uploadAttachment(form);
                  setProblem(result.error);
                  if (!result.error) {
                    if (input.current) {
                      input.current.value = "";
                    }
                    router.refresh();
                  }
                });
              }}
            >
              {t("attachments.attach")}
            </Button>
          </div>
        ) : null}

        {problem ? (
          <span role="alert" className="text-xs text-bad">
            {problem}
          </span>
        ) : null}
      </CardBody>
    </Card>
  );
}
