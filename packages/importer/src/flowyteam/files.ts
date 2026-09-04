/**
 * Finding a source file's bytes on disk (P6-T04c).
 *
 * **The bytes are not in the database.** `task_files` records a filename, a
 * hashed name and a size, and the file itself sits on the FlowyTeam
 * application server's own disk. The importer holds a read-only MySQL
 * connection and nothing else, so on the instance measured all 1535 files were
 * out of reach: none carried a Google Drive, a Dropbox or an external address,
 * which is the one path §7.2 described and the one the live data never takes.
 *
 * `--files-root` is the answer, and it is deliberately tolerant. FlowyTeam is
 * a Laravel application and its upload layout is not something this code can
 * know from a schema: the same install can hold files under `storage/app`,
 * under `public`, in a folder per task, or flat. So rather than demand one
 * exact path, this tries the shapes a Laravel upload takes and reports every
 * one it tried when none matches. A person pointing the flag one directory too
 * high gets a list they can act on instead of "not found".
 *
 * Nothing here writes to the source, reads outside the root, or follows a name
 * out of it: a hashed name from a database is caller-supplied input, and
 * `..` in one would otherwise walk the filesystem.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

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
 * The relative shapes a Laravel task upload takes, in the order they are
 * tried. `%h` is the hashed name and `%t` the task id.
 */
const LAYOUTS: readonly string[] = [
  "%h",
  "task-files/%h",
  "task-files/%t/%h",
  "storage/app/task-files/%h",
  "storage/app/task-files/%t/%h",
  "storage/app/public/task-files/%h",
  "storage/app/public/task-files/%t/%h",
  "public/task-files/%h",
  "public/user-uploads/task-files/%h",
  "user-uploads/task-files/%h",
  "user-uploads/task-files/%t/%h",
];

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

/**
 * The file's bytes, or every path that was looked at.
 *
 * A hashed name with a path separator or a `..` in it is refused before any
 * read: it came out of a database somebody else administers.
 */
export async function findSourceFile(
  root: string,
  file: SourceFile,
): Promise<FoundFile | NotFound> {
  const hashname = (file.hashname ?? "").trim();
  if (hashname === "" || !isSafeName(hashname)) {
    return { tried: [] };
  }
  const base = resolve(root);
  const tried: string[] = [];

  for (const layout of LAYOUTS) {
    const relativePath = layout
      .replaceAll("%h", hashname)
      .replaceAll("%t", String(file.taskId));
    const candidate = resolve(base, relativePath);
    // Belt as well as braces: even with a safe name, a resolved path that
    // leaves the root is not read.
    if (!inside(base, candidate)) {
      continue;
    }
    tried.push(relativePath);
    try {
      const bytes = await readFile(candidate);
      return {
        bytes,
        digest: digestOf(bytes),
        contentType: contentTypeFor(file.filename),
        at: relativePath,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      if ((error as NodeJS.ErrnoException).code === "EISDIR") {
        continue;
      }
      throw error;
    }
  }
  return { tried };
}

export const isFound = (result: FoundFile | NotFound): result is FoundFile =>
  "bytes" in result;

/** A name that is one path segment and nothing clever. */
function isSafeName(name: string): boolean {
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    return false;
  }
  return name !== "." && name !== "..";
}

function inside(root: string, candidate: string): boolean {
  const away = relative(root, candidate);
  return away !== "" && !away.startsWith("..") && !isAbsolute(away);
}

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
