/**
 * Task comments and the people watching them (TECHNICAL-PLAN §7.2, P6-T04b).
 *
 * **Every comment is HTML somebody else's product wrote.** CLAUDE.md says
 * imported content is untrusted and that one module parses it, so the markup
 * goes through `richTextFromHtml` in `packages/core` and the result goes
 * through the same validator every typed comment does. Measured rather than
 * assumed: 6841 of the 7223 comments on the instance this reads carry tags, 503
 * carry anchors, and 13 nest in ways the schema forbids outright, among them a
 * list inside a list and a quoted email inside a quoted email.
 *
 * **Two passes, and the second is what makes a reply possible.** 8 of those
 * 7223 comments answer another one. A reply cannot be written before the
 * comment it answers exists, so the first pass writes every comment that
 * answers nothing and the second writes the replies against parents that are
 * now there. Ordering by id would usually be enough, and "usually" is what the
 * two-phase rule in §7.1 exists to refuse.
 *
 * **An inline image is flagged here and written by the file pass.** 64
 * comments hold a base64 data URI, which this domain has nowhere to put: a
 * picture in this product is an `attachment` pointing at a blob, and the blob
 * does not exist while the words are being written. Each is named in the
 * report with its comment, and `mappers/files.ts` comes back for it and
 * rewrites the body.
 *
 * **A watcher who is a placeholder is not subscribed, and that is most of
 * them.** §7.2 excludes a suspended, placeholder or agent member from every
 * auto-subscribe path, and every member an import creates is a placeholder
 * until somebody claims the account, so on a first run the watchers domain
 * normally writes nothing at all. Each one is a named skip rather than a
 * phantom write, and the domain says so in one line. Nothing re-creates the
 * watch when the account is claimed, which is the open question this row
 * raises rather than answers.
 */
import {
  type ActionCallContext,
  callAction,
  richTextFromHtml,
} from "@openokr/core";
import { legacyKeyFor } from "../legacy.ts";
import type { Source } from "../source.ts";
import { sourceInstant } from "../time.ts";
import { type DomainReconciliation, DomainTally } from "./reconcile.ts";
import type { Resolver } from "./resolve.ts";

/** What the converter returns. The action that stores it narrows to the same
 * type through `isValidRichText`, so the mapper keeps it rather than widening
 * to `unknown` and casting back. */
type RichTextBody = ReturnType<typeof richTextFromHtml>;

export interface CollaborationResult {
  readonly domains: readonly DomainReconciliation[];
  /** Constructs the source models and this product does not. */
  readonly unmodelled: readonly string[];
}

interface MapperOptions {
  readonly source: Source;
  readonly context: ActionCallContext;
  readonly companyId: number;
  readonly resolver: Resolver;
  readonly actingMemberId: string;
  readonly write: boolean;
}

export async function importCollaboration(
  options: MapperOptions,
): Promise<CollaborationResult> {
  const comments = await importComments(options);
  const watchers = await importWatchers(options);
  return {
    domains: [comments.tally, watchers],
    unmodelled: comments.unmodelled,
  };
}

interface SourceComment {
  id: number;
  comment: string | null;
  user_id: number;
  task_id: number;
  parent_id: number | null;
  created_at: string | null;
  edited_at: string | null;
}

/** What the conversion made of one comment, or why it could not. */
interface Converted {
  readonly body: RichTextBody;
  readonly images: number;
}

async function importComments(options: MapperOptions): Promise<{
  readonly tally: DomainReconciliation;
  readonly unmodelled: readonly string[];
}> {
  const tally = new DomainTally("comments");
  const rows = await options.source.query<SourceComment>(
    // `task_comments` carries no `company_id`, which §11 of the reference
    // records: it is scoped through its parent task and nothing else.
    `select c.id, c.comment, c.user_id, c.task_id, c.parent_id,
            c.created_at, c.edited_at
       from task_comments c
       join tasks t on t.id = c.task_id
      where t.company_id = ? and t.deleted_at is null
      order by c.id`,
    [options.companyId],
  );

  const state: ConversionState = {
    images: 0,
    replies: 0,
    orphanReplies: 0,
    dropped: new Map(),
  };

  // Roots first, replies second. Nothing else about the two passes differs, so
  // one loop runs twice rather than two loops that could drift apart.
  const roots = rows.filter((row) => !row.parent_id);
  const replies = rows.filter((row) => Boolean(row.parent_id));
  for (const row of [...roots, ...replies]) {
    await importOneComment(options, row, tally, state);
  }

  return { tally: tally.finish(), unmodelled: describe(state) };
}

interface ConversionState {
  images: number;
  replies: number;
  orphanReplies: number;
  readonly dropped: Map<string, number>;
}

async function importOneComment(
  options: MapperOptions,
  row: SourceComment,
  tally: DomainTally,
  state: ConversionState,
): Promise<void> {
  tally.sawRow();
  const source = `task_comments:${row.id}`;
  const html = row.comment ?? "";
  if (html.trim() === "") {
    tally.skip(source, "This comment is empty in the source.");
    return;
  }

  const taskId = await options.resolver.resolve("tasks", row.task_id);
  if (!taskId) {
    tally.skip(
      source,
      `Task ${row.task_id} did not import, so the comment on it could not either.`,
    );
    return;
  }
  const authorId = await options.resolver.resolve("users", row.user_id);
  if (!authorId) {
    tally.skip(
      source,
      `Employee ${row.user_id} did not import, and a comment has to name whoever wrote it.`,
    );
    return;
  }

  let converted: Converted;
  try {
    converted = convert(html, source, tally, state);
  } catch (error) {
    // Converting cannot normally fail: the converter repairs rather than
    // refuses. A comment that still does is a shape nobody has seen, and
    // naming it is more use than a stack trace.
    tally.skip(
      source,
      `This comment's markup could not be read: ${messageOf(error)}`,
    );
    return;
  }
  if (isEmptyBody(converted.body)) {
    tally.skip(
      source,
      converted.images > 0
        ? "This comment is an image and nothing else, so there is no body to write. The image itself still becomes a file in the file pass; a comment with no words is not a comment."
        : "This comment is markup with no words in it.",
    );
    return;
  }

  // The parent, resolved in the second pass against comments the first wrote.
  let parentId: string | undefined;
  if (row.parent_id) {
    parentId = await options.resolver.resolve("task_comments", row.parent_id);
    if (parentId) {
      state.replies += 1;
    } else {
      state.orphanReplies += 1;
      tally.flag(
        source,
        `This comment answers comment ${row.parent_id}, which did not import, so it reads as a remark of its own.`,
      );
    }
  }

  if (!options.write) {
    const already = await options.resolver.resolve("task_comments", row.id);
    if (already === undefined) {
      options.resolver.plan("task_comments", row.id);
    }
    tally.wrote(already === undefined);
    return;
  }
  if (await options.resolver.resolve("task_comments", row.id)) {
    tally.wrote(false);
    return;
  }

  try {
    const created = await callAction(
      options.context,
      "comments.importComment",
      {
        subjectType: "task",
        subjectId: taskId,
        authorMemberId: authorId,
        body: converted.body,
        createdAt: sourceInstant(row.created_at) ?? new Date().toISOString(),
        ...(sourceInstant(row.edited_at)
          ? { editedAt: sourceInstant(row.edited_at) as string }
          : {}),
        ...(parentId ? { parentId } : {}),
        legacy: legacyKeyFor("task_comments", row.id),
      },
    );
    options.resolver.remember("task_comments", row.id, created.id);
    tally.wrote(true);
  } catch (error) {
    tally.skip(source, messageOf(error));
  }
}

/** The markup, converted, with everything the conversion could not keep
 * recorded against the comment it came from. */
function convert(
  html: string,
  source: string,
  tally: DomainTally,
  state: ConversionState,
): Converted {
  let images = 0;
  const body = richTextFromHtml(html, {
    onDropped: (what) => {
      const kind = what.startsWith("a link to ")
        ? "a link whose address was not http, https or mailto"
        : what;
      state.dropped.set(kind, (state.dropped.get(kind) ?? 0) + 1);
      if (what === "an image") {
        images += 1;
        state.images += 1;
        tally.flag(
          source,
          "This comment holds an image inline as a data URI. The words are written here and the picture in the file pass later in this same run, because a picture here is an attachment pointing at a blob and the blob does not exist yet.",
        );
      }
    },
  });
  return { body, images };
}

function describe(state: ConversionState): readonly string[] {
  const notes: string[] = [];
  if (state.images > 0) {
    notes.push(
      `${state.images} inline images are in comment markup as data URIs rather than as attachments. Each is named in the comments domain's flags. The words are written here and the pictures in the file pass, which is what the comment images domain below reports.`,
    );
  }
  for (const [kind, count] of [...state.dropped.entries()].sort(
    (left, right) => right[1] - left[1],
  )) {
    if (kind === "an image") {
      continue;
    }
    notes.push(
      `${count} comments contained ${kind}, which this product's rich text has no node for. The surrounding words imported.`,
    );
  }
  if (state.replies > 0) {
    notes.push(
      `${state.replies} comments answer another comment. FlowyTeam threads one level deep and the pointer is kept, but no screen renders a thread yet, so a reply reads as a comment in sequence.`,
    );
  }
  return notes;
}

/**
 * Watchers.
 *
 * `tasks_accesses` is FlowyTeam's per-task access list, which is also its
 * watcher list: the creator, the assignee and everyone named in
 * `employee_access` get a row. This product separates the two, and a
 * subscription is the half that says "tell me about this". Access follows the
 * task's space and its assignment, which P6-T04a already wrote.
 *
 * 95903 rows instance-wide, so this reads the company's own and nothing more.
 */
async function importWatchers(
  options: MapperOptions,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("watchers");
  const rows = await options.source.query<{ task_id: number; user_id: number }>(
    `select task_id, user_id
       from tasks_accesses
      where company_id = ?
      order by task_id, user_id`,
    [options.companyId],
  );

  // Who can hold a subscription at all, read once. §7.2 excludes a
  // placeholder, an agent and a suspended member from every auto-subscribe
  // path, and a dry run has to say the same thing a real run does or the
  // preview predicts writes that never happen.
  const directory = await callAction(options.context, "people.directory", {});
  const subscribable = new Set(
    directory
      .filter(
        (member) =>
          member.status === "active" &&
          (member.kind === "human" || member.kind === "guest"),
      )
      .map((member) => member.id),
  );

  let unreachable = 0;
  for (const row of rows) {
    tally.sawRow();
    const source = `tasks_accesses:${row.task_id}/${row.user_id}`;
    const taskId = await options.resolver.resolve("tasks", row.task_id);
    if (!taskId) {
      tally.skip(
        source,
        `Task ${row.task_id} did not import, so nobody could be subscribed to it.`,
      );
      continue;
    }
    const memberId = await options.resolver.resolve("users", row.user_id);
    if (!memberId) {
      tally.skip(
        source,
        `Employee ${row.user_id} did not import, so their watch could not be restored.`,
      );
      continue;
    }

    if (!subscribable.has(memberId)) {
      // A skip and not a flag, because a flag means the row arrived carrying a
      // decision. Nothing arrived, and counting it as written would claim a
      // row that is not there.
      unreachable += 1;
      tally.skip(
        source,
        "This member is a placeholder, an agent or suspended, and §7.2 excludes all three from subscribing. Nothing was written.",
      );
      continue;
    }

    if (!options.write) {
      // A subscription has no legacy key: it is already unique per list and
      // member, so there is nothing a second run could duplicate and nothing
      // for a dry run to look up. Counted as a write, which is what it is the
      // first time and a no-op after.
      tally.wrote(true);
      continue;
    }

    try {
      await callAction(options.context, "subscriptions.importWatcher", {
        subjectType: "task",
        subjectId: taskId,
        memberId,
        reason: "role",
      });
      tally.wrote(true);
    } catch (error) {
      tally.skip(source, messageOf(error));
    }
  }

  if (unreachable > 0) {
    tally.flag(
      "tasks_accesses",
      `${unreachable} watches name a member who cannot hold a subscription. Every member an import creates is a placeholder until somebody claims the account, so on a first run this is normally all of them. Nothing re-creates the watch at claim time, which is an open question rather than a design: the source's watch lists are readable for as long as the source is.`,
    );
  }

  return tally.finish();
}

/** A document the converter produced that says nothing a reader would see. */
function isEmptyBody(body: RichTextBody): boolean {
  const doc = body as { content?: readonly unknown[] };
  if (!Array.isArray(doc.content) || doc.content.length === 0) {
    return true;
  }
  return doc.content.every(saysNothing);
}

function saysNothing(node: unknown): boolean {
  const element = node as {
    type?: string;
    content?: readonly unknown[];
    text?: string;
  };
  if (element.type === "text") {
    return (element.text ?? "").trim() === "";
  }
  if (element.type === "horizontalRule" || element.type === "hardBreak") {
    return true;
  }
  if (!Array.isArray(element.content)) {
    // A mention, an entity link or an attachment: a leaf that means something.
    return false;
  }
  return element.content.every(saysNothing);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
