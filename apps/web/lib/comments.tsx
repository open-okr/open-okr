"use client";

/**
 * A comment thread (TECHNICAL-PLAN.md §4.10, P3-T16).
 *
 * Shows comments, a composer with mention support, and reactions per comment.
 * Each comment is deep-linkable via #comment-{id}.
 *
 * **One thread for every subject** (completeness review M-01). It lived beside
 * the goal page, which was the only page that had one, and moved here when the
 * initiative, the task and the document gained theirs. The subject it is
 * about is its parent's business: `SubjectComments` binds the writes.
 */
import type { RichTextDocument } from "@openokr/core";
import {
  Button,
  guardPress,
  isBlankDocument,
  RichTextEditor,
  RichTextView,
  Spinner,
  useTranslations,
} from "@openokr/ui";
import { useCallback, useState, useTransition } from "react";

/** One emoji's reactions on one subject, as `reactions.list` groups them. */
export interface ReactionGroupData {
  readonly emoji: string;
  readonly count: number;
  readonly own: boolean;
  /**
   * The reader's own reaction, so pressing the emoji again takes it back
   * (P6-G27). Null when `own` is false. `reactions.remove` takes an id and
   * nothing on this screen knew it, so a reaction could be given and never
   * withdrawn.
   */
  readonly ownReactionId: string | null;
}

export interface CommentData {
  readonly id: string;
  readonly authorMemberId: string;
  readonly authorName: string;
  readonly body: unknown;
  /** The body rendered on the server, or null when it is not a document. */
  readonly html: string | null;
  readonly editedAt: string | null;
  readonly createdAt: string;
  readonly reactions: readonly ReactionGroupData[];
}

interface CommentThreadProps {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly comments: readonly CommentData[];
  readonly currentMemberId: string;
  /** Resolves true once the comment is posted, which empties the composer. */
  readonly onPost: (body: RichTextDocument) => Promise<boolean>;
  readonly onEdit: (commentId: string, body: RichTextDocument) => Promise<void>;
  readonly onDelete: (commentId: string) => Promise<void>;
  readonly onReact: (
    subjectType: string,
    subjectId: string,
    emoji: string,
    ownReactionId: string | null,
  ) => Promise<void>;
  /** Who `@` offers, by name. */
  readonly searchMembers?: (
    query: string,
  ) => Promise<readonly { readonly id: string; readonly label: string }[]>;
}

export function CommentThread({
  // subjectType and subjectId are carried for the parent component to pass
  // down to the composer and reaction actions; the thread itself renders by list.
  subjectType: _subjectType,
  subjectId: _subjectId,
  comments,
  currentMemberId,
  onPost,
  onEdit,
  onDelete,
  onReact,
  searchMembers,
}: CommentThreadProps) {
  const { t } = useTranslations();

  const [isPending, startTransition] = useTransition();
  // Which control started the write in flight (the composer, an edit, a delete
  // or a reaction), so only that one shows a spinner.
  const [acting, setActing] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // A new composer once a comment is posted: the editor shows its text as the
  // page's own, so a posted comment left in it would read as said twice.
  const [composer, setComposer] = useState(0);

  const handleEdit = useCallback(
    (commentId: string, body: RichTextDocument) => {
      setActing(`edit:${commentId}`);
      startTransition(async () => {
        await onEdit(commentId, body);
        setEditingId(null);
      });
    },
    [onEdit],
  );

  const handleDelete = useCallback(
    (commentId: string) => {
      setActing(`delete:${commentId}`);
      startTransition(async () => {
        await onDelete(commentId);
      });
    },
    [onDelete],
  );

  const handleReact = useCallback(
    (
      targetSubjectType: string,
      targetSubjectId: string,
      emoji: string,
      ownReactionId: string | null,
    ) => {
      setActing(`react:${targetSubjectId}`);
      startTransition(async () => {
        await onReact(targetSubjectType, targetSubjectId, emoji, ownReactionId);
      });
    },
    [onReact],
  );

  return (
    <div className="space-y-4" data-testid="comment-thread">
      <h3 className="text-sm font-medium text-ink-2">
        {t("comments.thread.discussion", { length: comments.length })}
      </h3>

      {comments.length === 0 && (
        <p className="text-sm text-ink-3">
          {t("comments.thread.noCommentsYetStart")}
        </p>
      )}

      {comments.map((comment) => (
        <div
          key={comment.id}
          id={`comment-${comment.id}`}
          className="rounded-lg border border-line bg-surface p-3 space-y-2"
        >
          <div className="flex items-center justify-between text-xs text-ink-3">
            <span className="font-medium text-ink">{comment.authorName}</span>
            <span>
              {comment.editedAt
                ? t("comments.thread.postedEdited", {
                    date: postedAt(comment.createdAt),
                  })
                : postedAt(comment.createdAt)}
            </span>
          </div>

          {editingId === comment.id ? (
            <div className="space-y-2">
              <CommentEditor
                initialBody={comment.body}
                onSave={(body) => handleEdit(comment.id, body)}
                searchMembers={searchMembers}
                onCancel={() => setEditingId(null)}
                saving={isPending && acting === `edit:${comment.id}`}
                busy={isPending}
              />
            </div>
          ) : (
            <CommentBody html={comment.html} />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <ReactionRow
              groups={comment.reactions}
              refusing={isPending}
              saving={isPending && acting === `react:${comment.id}`}
              onReact={(emoji, ownReactionId) =>
                handleReact("comment", comment.id, emoji, ownReactionId)
              }
            />
            {comment.authorMemberId === currentMemberId &&
              editingId !== comment.id && (
                <>
                  <button
                    type="button"
                    className="text-xs text-ink-3 hover:text-ink-2"
                    onClick={() => setEditingId(comment.id)}
                  >
                    {t("common.edit")}
                  </button>
                  {/* Refused with `aria-disabled`, not `disabled`, so the button
                   * keeps keyboard focus while the delete is sent. */}
                  <button
                    type="button"
                    aria-disabled={isPending || undefined}
                    aria-busy={
                      (isPending && acting === `delete:${comment.id}`) ||
                      undefined
                    }
                    className="inline-flex items-center gap-1.5 text-xs text-ink-3 hover:text-bad"
                    onClick={guardPress(isPending, () =>
                      handleDelete(comment.id),
                    )}
                  >
                    {isPending && acting === `delete:${comment.id}` ? (
                      <Spinner />
                    ) : null}
                    <span>{t("common.delete")}</span>
                  </button>
                </>
              )}
          </div>
        </div>
      ))}

      {/* Composer */}
      <div className="rounded-lg border border-line bg-surface p-3 space-y-2">
        <CommentEditor
          key={composer}
          onSave={(body) => {
            setActing("post");
            startTransition(async () => {
              if (await onPost(body)) {
                setComposer((count) => count + 1);
              }
            });
          }}
          saving={isPending && acting === "post"}
          busy={isPending}
          placeholder={t("comments.thread.writeAComment")}
          searchMembers={searchMembers}
        />
      </div>
    </div>
  );
}

/**
 * The reactions on one subject, and the button that adds one.
 *
 * Shared by every comment and by the subject a thread is about, so a reaction
 * on a document looks and behaves like one on a comment beneath it. A fragment
 * rather than a box, because a comment sets it in a row beside its own edit
 * and delete.
 */
export function ReactionRow({
  groups,
  onReact,
  refusing = false,
  saving = false,
}: {
  readonly groups: readonly ReactionGroupData[];
  readonly onReact: (emoji: string, ownReactionId: string | null) => void;
  /** Any write on the thread is on its way: a second press is refused. */
  readonly refusing?: boolean;
  /** A reaction on this subject is on its way, so the pressed one spins. */
  readonly saving?: boolean;
}) {
  // Which one was pressed. Needed because +1 and an emoji nobody owns call
  // `onReact` with the same arguments.
  const [pressed, setPressed] = useState<string | null>(null);
  const press = (key: string, emoji: string, ownReactionId: string | null) =>
    guardPress(refusing, () => {
      setPressed(key);
      onReact(emoji, ownReactionId);
    });
  return (
    <>
      {groups.map((group) => (
        <button
          key={group.emoji}
          type="button"
          aria-disabled={refusing || undefined}
          aria-busy={(saving && pressed === group.emoji) || undefined}
          // The reader's own reaction is marked, because a count with no
          // "did I" in it makes somebody click again to find out.
          className={
            group.own
              ? "inline-flex items-center gap-1 rounded-full bg-brand-weak px-2 py-0.5 text-xs font-semibold text-brand-text"
              : "inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-ink-2 hover:border-brand"
          }
          onClick={press(group.emoji, group.emoji, group.ownReactionId)}
        >
          {saving && pressed === group.emoji ? (
            <Spinner className="size-3" />
          ) : null}
          <span>
            {group.emoji} {group.count}
          </span>
        </button>
      ))}
      <button
        type="button"
        aria-disabled={refusing || undefined}
        aria-busy={(saving && pressed === "+1") || undefined}
        className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink-2"
        // The thumb always adds. A reader who already gave one sees it in the
        // row beside it and presses that to take it back.
        onClick={press("+1", "\u{1F44D}", null)}
      >
        {saving && pressed === "+1" ? <Spinner className="size-3" /> : null}
        <span>+1</span>
      </button>
    </>
  );
}

/** When a comment was written, short enough to sit beside the author. */
function postedAt(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A comment as the server rendered it, through the one sanitising renderer
 * every surface uses (`renderRichTextToHtml`), so bold, lists, links and
 * mentions read here as they were written. Null when the stored body is not
 * a document the schema accepts, which a comment written before bodies were
 * checked can be.
 */
function CommentBody({ html }: { html: string | null }) {
  const { t } = useTranslations();
  if (html === null || html === "") {
    return (
      <p className="text-ink-3 italic">{t("comments.thread.emptyComment")}</p>
    );
  }
  return <RichTextView html={html} className="text-ink" />;
}

interface CommentEditorProps {
  readonly initialBody?: unknown;
  readonly onSave: (body: RichTextDocument) => void;
  readonly onCancel?: () => void;
  /** This editor's own write is on its way, so its button spins. */
  readonly saving?: boolean;
  /** Any write on the thread is on its way: a second press is refused. */
  readonly busy?: boolean;
  readonly placeholder?: string;
  readonly searchMembers?: (
    query: string,
  ) => Promise<readonly { readonly id: string; readonly label: string }[]>;
}

/**
 * The compact editor (docs/design/guided-inputs.md §4.7): bold, italic,
 * strike, code, lists and links from its toolbar, and `@` to mention
 * somebody. An edit opens on the stored document itself, so what was
 * formatted stays formatted; the plain textarea this replaced flattened it.
 */
function CommentEditor({
  initialBody,
  onSave,
  onCancel,
  saving,
  busy,
  placeholder,
  searchMembers,
}: CommentEditorProps) {
  const { t } = useTranslations();

  // Only what was typed here. An edit nobody has changed has nothing to save,
  // so Save waits for a change rather than sending the stored body back.
  const [body, setBody] = useState<RichTextDocument | null>(null);

  return (
    <div className="space-y-2">
      <div className="rounded-control border border-line-2 bg-surface px-2.5 py-1.5 text-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-line">
        <RichTextEditor
          label={
            initialBody
              ? t("comments.thread.editComment")
              : t("comments.thread.yourComment")
          }
          variant="compact"
          content={initialBody ?? null}
          placeholder={placeholder ?? t("comments.thread.writeSomething")}
          onUpdate={(json) => setBody(json as RichTextDocument)}
          searchMembers={searchMembers}
        />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => body && onSave(body)}
          disabled={busy || !body || isBlankDocument(body)}
          pending={saving}
        >
          {saving
            ? t("comments.thread.posting")
            : initialBody
              ? t("common.save")
              : t("comments.thread.post")}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}
