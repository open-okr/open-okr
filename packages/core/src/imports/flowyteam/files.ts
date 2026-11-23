/**
 * The source's file bytes, without the disk (P6-T04c, flowyteam-connect Q2).
 *
 * `task_files` names a file on the FlowyTeam application server's own disk, so
 * where the bytes come from depends on who runs the engine. The command line
 * reads `--files-root` on a local disk (`packages/importer`); a browser import
 * will fetch them from FlowyTeam (card C4). The engine sees only the reader
 * below, and the parts here that need no disk: content types, digests, and the
 * inline images whose bytes are in the database itself.
 */
import { createHash } from "node:crypto";
import { extname } from "node:path";

export interface SourceFile {
  readonly taskId: number;
  /** The name somebody uploaded it under. */
  readonly filename: string;
  /** The name on disk, which is what makes it findable. */
  readonly hashname: string | null;
}

export interface FoundFile {
  readonly bytes: Buffer;
  readonly digest: string;
  readonly contentType: string;
  /** Where it was found, relative to the root, for the report. */
  readonly at: string;
}

export interface NotFound {
  /** Every path that was tried, relative to the root. */
  readonly tried: readonly string[];
}

/**
 * Finds one source file's bytes, or says every place it looked.
 *
 * Injected by whoever runs the engine. Absent means the run has no way to reach
 * the source's disk, and every local file is reported by name instead.
 */
export interface SourceFileReader {
  find(file: SourceFile): Promise<FoundFile | NotFound>;
}

/**
 * Where this instance keeps its own bytes, as much of the storage port as the
 * files mapper uses. The caller passes the adapters driver, which satisfies it.
 */
export interface BlobStorage {
  put(
    key: string,
    body: Buffer,
    options?: { readonly contentType?: string },
  ): Promise<unknown>;
}

/**
 * Content types by extension.
 *
 * Not sniffed from the bytes: sniffing needs a library, which CLAUDE.md
 * requires asking about, and a wrong answer here is a wrong `content_type`
 * on a stored blob rather than a security decision. The upload validator in
 * `packages/core` is what refuses a type this product will not hold.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".json": "application/json",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
};

export function contentTypeFor(filename: string): string {
  return (
    CONTENT_TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream"
  );
}

export const digestOf = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

export const isFound = (result: FoundFile | NotFound): result is FoundFile =>
  "bytes" in result;

/**
 * A data URI's bytes, for an image sitting inline in a comment.
 *
 * These bytes **are** in the database: 64 comments on the instance measured
 * hold one, some of them megabytes of base64 in a `text` column. So this is
 * the one file path that works with nothing but a MySQL connection.
 *
 * Returns nothing for anything that is not a data URI this can decode, which
 * includes an `<img src="https://…">` pointing at somebody else's server:
 * fetching that would be the importer reaching onto the network, which it does
 * not do.
 */
export function decodeDataUri(
  src: string,
): { bytes: Buffer; contentType: string; digest: string } | undefined {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?(;[^,]*)?,(.*)$/is.exec(
    src.trim(),
  );
  if (!match) {
    return undefined;
  }
  const contentType = (match[1] ?? "application/octet-stream").toLowerCase();
  const parameters = (match[2] ?? "").toLowerCase();
  const payload = match[3] ?? "";
  let bytes: Buffer;
  try {
    bytes = parameters.includes("base64")
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
  } catch {
    return undefined;
  }
  if (bytes.byteLength === 0) {
    return undefined;
  }
  return { bytes, contentType, digest: digestOf(bytes) };
}

/** A filename for an inline image, which arrives with none. */
export function filenameForInline(
  commentId: number,
  index: number,
  contentType: string,
): string {
  const extension =
    Object.entries(CONTENT_TYPES).find(
      ([, type]) => type === contentType,
    )?.[0] ?? ".bin";
  return `comment-${commentId}-image-${index}${extension}`;
}
