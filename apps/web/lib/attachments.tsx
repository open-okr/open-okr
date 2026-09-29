"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { detachAttachment, uploadAttachment } from "./attachment-actions.ts";
import {
  AttachmentPreview,
  type FileKind,
  fileKind,
} from "./attachment-preview.tsx";

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
 *
 * **A picture or an icon beside every file, and no link to one that is not
 * ready** (completeness review M-24). An image shows the thumbnail its upload
 * made. A file waiting on the virus scan, or held back by it, keeps its name
 * and loses its link, with a chip saying which, because a link that answers
 * "not found" reads as a broken product rather than a scan in progress.
 */

export interface AttachmentRow {
  readonly id: string;
  readonly blobId: string;
  readonly filename: string;
  readonly contentType: string;
  /** Null until `blobs.claimUpload` recorded what was written. */
  readonly filesize: number | null;
  /** Only `ok` can be opened. */
  readonly status: "pending" | "ok" | "scanning" | "quarantined";
  /** An image whose upload stored a thumbnail. */
  readonly hasThumbnail: boolean;
}

/** The chip for a file that cannot be opened yet, and what it says. */
const HELD = {
  pending: { tone: "neutral", label: "attachments.status.pending" },
  scanning: { tone: "info", label: "attachments.status.scanning" },
  quarantined: { tone: "bad", label: "attachments.status.quarantined" },
} as const;

const EXPLAINS: Partial<Record<AttachmentRow["status"], string>> = {
  scanning: "attachments.status.scanningExplains",
  quarantined: "attachments.status.quarantinedExplains",
};

/** Each key written out, so the catalogue test can see every one is read. */
const KIND_LABEL: Readonly<Record<FileKind, string>> = {
  image: "attachments.kind.image",
  pdf: "attachments.kind.pdf",
  spreadsheet: "attachments.kind.spreadsheet",
  document: "attachments.kind.document",
  text: "attachments.kind.text",
  file: "attachments.kind.file",
};

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
  const [detaching, start] = useTransition();
  // Its own transition, so the button can say "Uploading" while an upload is
  // in flight and not while a detach is: re-encoding a large photo takes
  // long enough that a button which only greys out looks stuck.
  const [uploading, startUpload] = useTransition();
  const pending = detaching || uploading;
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
          <ul className="flex flex-col gap-2" data-testid="attachment-list">
            {attachments.map((file) => {
              const kind = fileKind(file.contentType);
              const ready = file.status === "ok";
              const held = file.status === "ok" ? null : HELD[file.status];
              const explains = EXPLAINS[file.status];
              return (
                <li
                  key={file.id}
                  data-testid={`attachment-${file.id}`}
                  data-status={file.status}
                  className="flex items-center gap-3"
                >
                  <AttachmentPreview
                    blobId={file.blobId}
                    kind={kind}
                    showThumbnail={ready && file.hasThumbnail}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {ready ? (
                      <a
                        href={`/api/blobs/${file.blobId}`}
                        className="truncate text-sm text-brand-text hover:underline"
                      >
                        {file.filename}
                      </a>
                    ) : (
                      <span className="truncate text-sm text-ink-2">
                        {file.filename}
                      </span>
                    )}
                    <span className="text-xs text-ink-4">
                      {t(KIND_LABEL[kind])}
                      {" · "}
                      {file.filesize === null
                        ? t("attachments.sizeUnknown")
                        : readableSize(file.filesize)}
                    </span>
                    {explains ? (
                      <span className="text-xs text-ink-3">{t(explains)}</span>
                    ) : null}
                  </span>
                  {held ? (
                    <Chip tone={held.tone} dot>
                      {t(held.label)}
                    </Chip>
                  ) : null}
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
                      className="shrink-0 text-xs text-ink-4 hover:text-bad"
                    >
                      {t("attachments.detach")}
                    </button>
                  ) : null}
                </li>
              );
            })}
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
                startUpload(async () => {
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
              {uploading ? t("attachments.uploading") : t("attachments.attach")}
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
