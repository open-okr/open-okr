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
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  contentTypeFor,
  digestOf,
  type FoundFile,
  type NotFound,
  type SourceFile,
  type SourceFileReader,
} from "@openokr/core";

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

/** The engine's file reader over `--files-root`. */
export function filesRootReader(root: string): SourceFileReader {
  return { find: (file) => findSourceFile(root, file) };
}

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
