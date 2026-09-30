"use client";

import { Avatar } from "@base-ui-components/react/avatar";
import {
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

/**
 * The small square beside each attached file (completeness review M-24,
 * REQUIREMENTS §4 "attachments with previews").
 *
 * **A thumbnail for an image, the type's icon for anything else.** The
 * thumbnail is the WebP the upload made when it re-encoded the image, served
 * by `/api/blobs/[id]/thumbnail` behind the same access check as the file.
 *
 * **Three states, none of them blank.** While the thumbnail loads the square
 * pulses; if it fails, which is what a replaced volume or a revoked grant
 * looks like, the type icon takes its place rather than a broken image; and
 * a file that is still being scanned or was held back never asks for one.
 *
 * **Loaded through Base UI's image primitive**, the one `Avatar` in
 * `packages/ui` uses, rather than a bare `<img onError>`. It shows the
 * fallback until the picture has actually loaded, so a slow load pulses
 * instead of showing a half-drawn image, and a picture the cache answered
 * before hydration is still noticed.
 *
 * **Decorative to a screen reader.** The file name beside it is the link and
 * says what the file is, so the picture repeats nothing a reader needs.
 */

export type FileKind =
  | "image"
  | "pdf"
  | "spreadsheet"
  | "document"
  | "text"
  | "file";

/** What kind of file a content type is, for its icon and its label. */
export function fileKind(contentType: string): FileKind {
  if (contentType.startsWith("image/")) {
    return "image";
  }
  if (contentType === "application/pdf") {
    return "pdf";
  }
  if (
    contentType === "text/csv" ||
    contentType === "application/vnd.ms-excel" ||
    contentType.includes("spreadsheetml")
  ) {
    return "spreadsheet";
  }
  if (
    contentType === "application/msword" ||
    contentType.includes("wordprocessingml")
  ) {
    return "document";
  }
  if (contentType.startsWith("text/")) {
    return "text";
  }
  return "file";
}

const ICONS: Readonly<Record<FileKind, LucideIcon>> = {
  image: FileImage,
  pdf: FileText,
  spreadsheet: FileSpreadsheet,
  document: FileText,
  text: FileText,
  file: File,
};

const SQUARE =
  "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-raised text-ink-3";

type LoadingStatus = "idle" | "loading" | "loaded" | "error";

export function AttachmentPreview({
  blobId,
  kind,
  showThumbnail,
}: {
  readonly blobId: string;
  readonly kind: FileKind;
  /** An `ok` image with a stored thumbnail. Anything else shows the icon. */
  readonly showThumbnail: boolean;
}) {
  const [status, setStatus] = useState<LoadingStatus>("idle");
  const Icon = ICONS[kind];
  const icon = <Icon className="size-5" strokeWidth={1.75} />;

  if (!showThumbnail) {
    return (
      <span
        aria-hidden="true"
        data-testid="attachment-icon"
        data-kind={kind}
        className={SQUARE}
      >
        {icon}
      </span>
    );
  }

  const failed = status === "error";
  return (
    <Avatar.Root
      aria-hidden="true"
      data-testid="attachment-thumbnail"
      data-kind={kind}
      data-state={status === "loaded" ? "shown" : failed ? "failed" : "loading"}
      className={SQUARE}
    >
      <Avatar.Image
        src={`/api/blobs/${blobId}/thumbnail`}
        alt=""
        width={40}
        height={40}
        onLoadingStatusChange={setStatus}
        className="size-full object-cover"
      />
      <Avatar.Fallback className="flex size-full items-center justify-center">
        {failed ? (
          icon
        ) : (
          <span className="size-full bg-raised motion-safe:animate-pulse" />
        )}
      </Avatar.Fallback>
    </Avatar.Root>
  );
}
