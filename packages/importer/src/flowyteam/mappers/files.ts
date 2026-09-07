/**
 * Files on the work (TECHNICAL-PLAN §7.2, P6-T04c).
 *
 * **The bytes are not in the database, and that is this row's whole problem.**
 * `task_files` names a file on the FlowyTeam application server's own disk. The
 * importer holds a read-only MySQL connection, so on the instance measured all
 * 1535 rows were out of reach: not one carried a Google Drive, a Dropbox or an
 * external address, which is the one path §7.2 described. `--files-root` names
 * the source's storage directory and is what makes a copy possible. Without
 * it, every local file is a named line in the report rather than a blob with
 * nothing behind it.
 *
 * **An external address becomes a link and never a download.** Fetching one
 * would be the importer reaching onto the network on somebody else's
 * credentials. The address goes into the task's description under a heading,
 * and a second run adds nothing, because a link already in the description is
 * one this pass leaves alone.
 *
 * **An inline image is the one file path that needs no directory.** 64
 * comments on that instance hold a base64 data URI, and those bytes are in
 * MySQL. They are decoded here, stored as blobs, and the comment body is
 * rewritten with an attachment where the image was. That is the second phase
 * of the reference rewrite: the comment domain could not do it, because a
 * picture in this product points at a blob and the blob did not exist yet.
 *
 * **Nothing here claims a blob before its bytes are written.** Prepare, put,
 * claim, in that order, so a run that dies between them leaves a `pending`
 * row the orphan sweep collects rather than an `ok` row with no file.
 */
import type { FileStorage } from "@openokr/adapters";
import {
  type ActionCallContext,
  callAction,
  type RichTextNode,
  richTextFromHtml,
} from "@openokr/core";
import {
  decodeDataUri,
  filenameForInline,
  findSourceFile,
  isFound,
} from "../files.ts";
import { legacyKeyFor } from "../legacy.ts";
import type { Source } from "../source.ts";
import { type DomainReconciliation, DomainTally } from "./reconcile.ts";
import type { Resolver } from "./resolve.ts";

export interface FilesResult {
  readonly domains: readonly DomainReconciliation[];
  readonly unmodelled: readonly string[];
}

interface MapperOptions {
  readonly source: Source;
  readonly context: ActionCallContext;
  readonly companyId: number;
  readonly resolver: Resolver;
  readonly actingMemberId: string;
  readonly write: boolean;
  /** Where this instance keeps its own bytes. Absent in a dry run. */
  readonly storage?: FileStorage;
  /** The source's storage directory, from `--files-root`. */
  readonly filesRoot?: string;
}

export async function importFiles(
  options: MapperOptions,
): Promise<FilesResult> {
  const files = await importTaskFiles(options);
  const images = await importInlineImages(options);
  return {
    domains: [files.tally, images.tally],
    unmodelled: [...files.notes, ...images.notes],
  };
}

interface SourceTaskFile {
  id: number;
  task_id: number;
  user_id: number;
  filename: string | null;
  hashname: string | null;
  size: string | null;
  google_url: string | null;
  dropbox_link: string | null;
  external_link: string | null;
  external_link_name: string | null;
}

async function importTaskFiles(options: MapperOptions): Promise<{
  readonly tally: DomainReconciliation;
  readonly notes: readonly string[];
}> {
  const tally = new DomainTally("files");
  const rows = await options.source.query<SourceTaskFile>(
    `select id, task_id, user_id, filename, hashname, size,
            google_url, dropbox_link, external_link, external_link_name
       from task_files
      where company_id = ?
      order by id`,
    [options.companyId],
  );

  /** External addresses to append, grouped by the task they belong to. */
  const links = new Map<string, { label: string; href: string }[]>();
  let local = 0;
  let missing = 0;
  let external = 0;
  const triedPaths = new Set<string>();

  for (const row of rows) {
    tally.sawRow();
    const source = `task_files:${row.id}`;
    const filename = (row.filename ?? "").trim();
    const taskId = await options.resolver.resolve("tasks", row.task_id);
    if (!taskId) {
      tally.skip(
        source,
        `Task ${row.task_id} did not import, so the file on it could not either.`,
      );
      continue;
    }

    const address = externalAddress(row);
    if (address) {
      external += 1;
      const forTask = links.get(taskId) ?? [];
      forTask.push({ label: filename || address.href, href: address.href });
      links.set(taskId, forTask);
      // Counted once the description is written, below, so a task with three
      // links is three rows and one edit.
      continue;
    }

    if (!row.hashname) {
      tally.skip(
        source,
        `"${filename}" names no file on disk and carries no external address, so there is nothing to fetch.`,
      );
      continue;
    }

    local += 1;
    if (!options.filesRoot) {
      missing += 1;
      tally.skip(
        source,
        `"${filename}" is a file on the FlowyTeam server's own disk. Run again with --files-root pointing at that server's storage directory to copy it.`,
      );
      continue;
    }

    const found = await findSourceFile(options.filesRoot, {
      taskId: row.task_id,
      filename: filename || row.hashname,
      hashname: row.hashname,
    });
    if (!isFound(found)) {
      missing += 1;
      for (const path of found.tried) {
        triedPaths.add(path);
      }
      tally.skip(
        source,
        found.tried.length === 0
          ? `"${filename}" has a name on disk this will not follow: ${row.hashname}.`
          : `"${filename}" was not under --files-root. Looked at ${found.tried.length} paths, the first being ${found.tried[0]}.`,
      );
      continue;
    }

    if (!options.write) {
      const already = await options.resolver.resolve("task_files", row.id);
      if (already === undefined) {
        options.resolver.plan("task_files", row.id);
      }
      tally.wrote(already === undefined);
      continue;
    }
    if (await options.resolver.resolve("task_files", row.id)) {
      tally.wrote(false);
      continue;
    }

    const uploader = row.user_id
      ? await options.resolver.resolve("users", row.user_id)
      : undefined;
    try {
      const blobId = await storeBlob(options, {
        filename: filename || row.hashname,
        contentType: found.contentType,
        bytes: found.bytes,
        digest: found.digest,
        authorMemberId: uploader ?? options.actingMemberId,
        legacy: legacyKeyFor("task_files", row.id),
      });
      await callAction(options.context, "attachments.attach", {
        subjectType: "task",
        subjectId: taskId,
        blobId,
      });
      options.resolver.remember("task_files", row.id, blobId);
      tally.wrote(true);
    } catch (error) {
      tally.skip(source, messageOf(error));
    }
  }

  const written = await appendLinks(options, links, tally);

  const notes: string[] = [];
  if (missing > 0) {
    notes.push(
      options.filesRoot
        ? `${missing} of ${local} files were not found under --files-root. Every one is named in the files domain. The paths looked at were ${[...triedPaths].slice(0, 4).join(", ")} and others of the same shape, so a root one directory too high or too low is the usual cause.`
        : `${local} files live on the FlowyTeam server's own disk and a read-only MySQL connection cannot reach them. Every one is named in the files domain. Run again with --files-root pointing at that server's storage directory to copy them.`,
    );
  }
  if (external > 0) {
    notes.push(
      `${external} files are addresses somewhere else (Google Drive, Dropbox or a plain URL) rather than uploads. Each is a link in its task's description, because fetching one would mean the importer reaching onto the network on somebody else's credentials. ${written} task descriptions were edited.`,
    );
  }
  return { tally: tally.finish(), notes };
}

/** The one external address a row carries, if any. */
function externalAddress(
  row: SourceTaskFile,
): { readonly href: string } | undefined {
  for (const candidate of [
    row.google_url,
    row.dropbox_link,
    row.external_link,
  ]) {
    const href = (candidate ?? "").trim();
    if (href !== "" && /^https?:\/\//i.test(href)) {
      return { href };
    }
  }
  return undefined;
}

/**
 * Puts the external addresses into their tasks' descriptions.
 *
 * One edit per task rather than one per file, and a link already in the
 * description is left alone, so a second run writes nothing.
 */
async function appendLinks(
  options: MapperOptions,
  links: ReadonlyMap<string, readonly { label: string; href: string }[]>,
  tally: DomainTally,
): Promise<number> {
  let edited = 0;
  for (const [taskId, forTask] of links) {
    if (!options.write) {
      for (const _link of forTask) {
        tally.wrote(true);
      }
      edited += 1;
      continue;
    }
    try {
      const task = await callAction(options.context, "tasks.read", {
        id: taskId,
      });
      const existing = JSON.stringify(task.description ?? {});
      // A link already in the description is one an earlier run put there, so
      // it counts as matched rather than written. Counting every link as a
      // write on every run made a second run report two creations and look
      // like it had duplicated something.
      const fresh = forTask.filter((link) => !existing.includes(link.href));
      for (const link of forTask) {
        tally.wrote(fresh.includes(link));
      }
      if (fresh.length === 0) {
        continue;
      }
      const body = withFileSection(task.description, fresh);
      await callAction(options.context, "tasks.update", {
        id: taskId,
        description: body,
      });
      edited += 1;
    } catch (error) {
      tally.skip(`tasks:${taskId}`, messageOf(error));
    }
  }
  return edited;
}

/** The task's description with a Files heading and one link per line. */
function withFileSection(
  description: unknown,
  links: readonly { label: string; href: string }[],
): { type: "doc"; content: RichTextNode[] } {
  const existing =
    (description as { content?: readonly RichTextNode[] } | null)?.content ??
    [];
  const items: RichTextNode[] = links.map((link) => ({
    type: "listItem",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: link.label,
            marks: [{ type: "link", attrs: { href: link.href } }],
          },
        ],
      },
    ],
  }));
  return {
    type: "doc",
    content: [
      ...existing,
      {
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: "Files" }],
      },
      { type: "bulletList", content: items },
    ],
  };
}

/**
 * The images sitting inline in comment markup.
 *
 * Ordered by comment id and then by position in the markup, so the legacy key
 * a blob gets is the same on every run.
 */
async function importInlineImages(options: MapperOptions): Promise<{
  readonly tally: DomainReconciliation;
  readonly notes: readonly string[];
}> {
  const tally = new DomainTally("comment images");
  const rows = await options.source.query<{ id: number; comment: string }>(
    `select c.id, c.comment
       from task_comments c
       join tasks t on t.id = c.task_id
      where t.company_id = ? and t.deleted_at is null
        and c.comment like '%data:%'
      order by c.id`,
    [options.companyId],
  );

  let rewritten = 0;
  let refused = 0;
  for (const row of rows) {
    const source = `task_comments:${row.id}`;
    const sources = inlineImageSources(row.comment ?? "");
    if (sources.length === 0) {
      continue;
    }
    tally.sawRow();

    const commentId = await options.resolver.resolve("task_comments", row.id);
    if (!commentId) {
      tally.skip(
        source,
        "This comment did not import, so its images had nowhere to hang.",
      );
      continue;
    }

    // Already done on an earlier run: every image has its blob, so the body
    // was rewritten then and rewriting it again would change nothing.
    const keys = sources.map((_src, index) => `${row.id}:${index}`);
    const existing = await Promise.all(
      keys.map((key) => options.resolver.resolve("task_files_inline", key)),
    );
    if (existing.every((one) => one !== undefined)) {
      tally.wrote(false);
      continue;
    }

    if (!options.write) {
      for (const key of keys) {
        options.resolver.plan("task_files_inline", key);
      }
      tally.wrote(true);
      continue;
    }

    /** src to the attachment node it becomes, filled in before converting. */
    const nodes = new Map<string, RichTextNode>();
    let failed: string | undefined;
    for (const [index, src] of sources.entries()) {
      const decoded = decodeDataUri(src);
      if (!decoded) {
        // An `<img src="https://…">` pointing at somebody else's server, or a
        // data URI this cannot read. Left as the drop the comment domain
        // already reported.
        continue;
      }
      const filename = filenameForInline(row.id, index, decoded.contentType);
      try {
        const blobId = await storeBlob(options, {
          filename,
          contentType: decoded.contentType,
          bytes: decoded.bytes,
          digest: decoded.digest,
          authorMemberId: options.actingMemberId,
          legacy: legacyKeyFor("task_files_inline", `${row.id}:${index}`),
        });
        options.resolver.remember(
          "task_files_inline",
          `${row.id}:${index}`,
          blobId,
        );
        nodes.set(src, {
          type: "attachment",
          attrs: {
            filename,
            contentType: decoded.contentType,
            status: "ready",
            blobId,
          },
        });
      } catch (error) {
        failed = messageOf(error);
      }
    }

    if (nodes.size === 0) {
      refused += 1;
      tally.skip(
        source,
        failed ??
          "None of this comment's images could be decoded into a file this product will hold.",
      );
      continue;
    }

    try {
      const body = richTextFromHtml(row.comment ?? "", {
        onImage: (image) => nodes.get(image.src),
      });
      await callAction(options.context, "comments.replaceImportedBody", {
        commentId,
        body,
        attachments: nodes.size,
      });
      rewritten += 1;
      tally.wrote(true);
    } catch (error) {
      tally.skip(source, messageOf(error));
    }
  }

  const notes: string[] = [];
  if (rewritten > 0) {
    notes.push(
      `${rewritten} comments held an image inline as a data URI. The bytes were in the source's own markup, so each is now a file this product holds and the comment shows it as an attachment. This is the second phase of the reference rewrite: the comment domain wrote the words and could not write the picture, because a picture here points at a file that did not exist yet.`,
    );
  }
  if (refused > 0) {
    notes.push(
      `${refused} comments hold an image this product will not store, usually a type outside the upload allow-list. Each is named in the comment images domain and its words imported.`,
    );
  }
  return { tally: tally.finish(), notes };
}

/** Every `<img src=…>` in the markup, in the order they appear. */
function inlineImageSources(html: string): readonly string[] {
  const found: string[] = [];
  const pattern = /<img\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match = pattern.exec(html);
  while (match) {
    const src = match[2] ?? match[3] ?? match[4] ?? "";
    if (src !== "") {
      found.push(src);
    }
    match = pattern.exec(html);
  }
  return found;
}

interface StoreBlobInput {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Buffer;
  readonly digest: string;
  readonly authorMemberId: string;
  readonly legacy: ReturnType<typeof legacyKeyFor>;
}

/**
 * Prepare, put, claim.
 *
 * In that order and never collapsed: claiming first would mark a blob `ok`
 * before its bytes existed, so a run that died in between would leave a row
 * saying a file is there when it is not. A prepare with no claim is a
 * `pending` row the orphan sweep collects.
 */
async function storeBlob(
  options: MapperOptions,
  input: StoreBlobInput,
): Promise<string> {
  if (!options.storage) {
    throw new Error(
      "No storage is configured for this run, so the bytes have nowhere to go.",
    );
  }
  const prepared = await callAction(options.context, "blobs.prepareImport", {
    filename: input.filename,
    contentType: input.contentType,
    declaredSize: input.bytes.byteLength,
    authorMemberId: input.authorMemberId,
    legacy: input.legacy,
  });
  await options.storage.put(prepared.storageKey, input.bytes, {
    contentType: input.contentType,
  });
  await callAction(options.context, "blobs.claimUpload", {
    blobId: prepared.blobId,
    actualSize: input.bytes.byteLength,
    digest: input.digest,
  });
  return prepared.blobId;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
