"use client";

/**
 * Comment thread on the goal page (TECHNICAL-PLAN.md §4.10, P3-T16).
 *
 * Shows comments, a composer with mention support, and reactions per comment.
 * Each comment is deep-linkable via #comment-{id}.
 */
import { Button } from "@openokr/ui";
// Rich text editor and mention extensions will be wired in once the
// comment thread component uses the full TipTap editor. For now the
// composer uses a plain textarea that wraps input into editor JSON.
import { useCallback, useState, useTransition } from "react";

/** Not exported: `CommentData` carries it, and nothing names it on its own. */
interface ReactionGroupData {
  readonly emoji: string;
  readonly count: number;
  readonly own: boolean;
}

export interface CommentData {
  readonly id: string;
  readonly authorMemberId: string;
  readonly authorName: string;
  readonly body: unknown;
  readonly editedAt: string | null;
  readonly createdAt: string;
  readonly reactions: readonly ReactionGroupData[];
}

interface CommentThreadProps {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly comments: readonly CommentData[];
  readonly currentMemberId: string;
  readonly onPost: (body: unknown) => Promise<void>;
  readonly onEdit: (commentId: string, body: unknown) => Promise<void>;
  readonly onDelete: (commentId: string) => Promise<void>;
  readonly onReact: (
    subjectType: string,
    subjectId: string,
    emoji: string,
  ) => Promise<void>;
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
}: CommentThreadProps) {
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleEdit = useCallback(
    (commentId: string, body: unknown) => {
      startTransition(async () => {
        await onEdit(commentId, body);
        setEditingId(null);
      });
    },
    [onEdit],
  );

  const handleDelete = useCallback(
    (commentId: string) => {
      startTransition(async () => {
        await onDelete(commentId);
      });
    },
    [onDelete],
  );

  const handleReact = useCallback(
    (targetSubjectType: string, targetSubjectId: string, emoji: string) => {
      startTransition(async () => {
        await onReact(targetSubjectType, targetSubjectId, emoji);
      });
    },
    [onReact],
  );

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-ink-2">
        Discussion ({comments.length})
      </h3>

      {comments.length === 0 && (
        <p className="text-sm text-ink-3">
          No comments yet. Start the conversation.
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
              {new Date(comment.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {comment.editedAt && " (edited)"}
            </span>
          </div>

          {editingId === comment.id ? (
            <div className="space-y-2">
              <CommentEditor
                initialBody={comment.body}
                onSave={(body) => handleEdit(comment.id, body)}
                onCancel={() => setEditingId(null)}
                saving={isPending}
              />
            </div>
          ) : (
            <div className="prose prose-sm max-w-none text-ink">
              <CommentBody body={comment.body} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {comment.reactions.map((group) => (
              <button
                key={group.emoji}
                type="button"
                // The reader's own reaction is marked, because a count with no
                // "did I" in it makes somebody click again to find out.
                className={
                  group.own
                    ? "rounded-full bg-brand-weak px-2 py-0.5 text-xs font-semibold text-brand-text"
                    : "rounded-full border border-line px-2 py-0.5 text-xs text-ink-2 hover:border-brand"
                }
                onClick={() => handleReact("comment", comment.id, group.emoji)}
              >
                {group.emoji} {group.count}
              </button>
            ))}
            <button
              type="button"
              className="text-xs text-ink-3 hover:text-ink-2"
              onClick={() => handleReact("comment", comment.id, "\u{1F44D}")}
            >
              +1
            </button>
            {comment.authorMemberId === currentMemberId &&
              editingId !== comment.id && (
                <>
                  <button
                    type="button"
                    className="text-xs text-ink-3 hover:text-ink-2"
                    onClick={() => setEditingId(comment.id)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-xs text-ink-3 hover:text-bad"
                    onClick={() => handleDelete(comment.id)}
                  >
                    Delete
                  </button>
                </>
              )}
          </div>
        </div>
      ))}

      {/* Composer */}
      <div className="rounded-lg border border-line bg-surface p-3 space-y-2">
        <CommentEditor
          onSave={(_body) => {
            startTransition(async () => {
              await onPost(_body);
            });
          }}
          saving={isPending}
          placeholder="Write a comment..."
        />
      </div>
    </div>
  );
}

function CommentBody({ body }: { body: unknown }) {
  if (!body || typeof body !== "object") {
    return <p className="text-ink-3 italic">Empty comment</p>;
  }
  // Render rich text content as paragraphs for now.
  // The full rich-text renderer from packages/core will be used once
  // the sanitising allow-list render is wired to a React component.
  const doc = body as { content?: unknown[] };
  if (!doc.content || !Array.isArray(doc.content)) {
    return <p className="text-ink-3 italic">Empty comment</p>;
  }
  return (
    <>
      {doc.content.map((node, i) => {
        const n = node as { type?: string; content?: unknown[] };
        if (n.type === "paragraph" && Array.isArray(n.content)) {
          const text = n.content
            .map((c) => {
              const child = c as {
                text?: string;
                type?: string;
                attrs?: { label?: string };
              };
              if (child.type === "mention") {
                return `@${child.attrs?.label ?? "someone"}`;
              }
              return child.text ?? "";
            })
            .join("");
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: paragraph nodes have no stable id
            <p key={i} className="text-sm">
              {text}
            </p>
          );
        }
        return null;
      })}
    </>
  );
}

interface CommentEditorProps {
  readonly initialBody?: unknown;
  readonly onSave: (body: unknown) => void;
  readonly onCancel?: () => void;
  readonly saving?: boolean;
  readonly placeholder?: string;
}

function CommentEditor({
  initialBody,
  onSave,
  onCancel,
  saving,
  placeholder,
}: CommentEditorProps) {
  const [body, setBody] = useState<unknown>(initialBody ?? null);

  return (
    <div className="space-y-2">
      <textarea
        className="w-full min-h-[80px] rounded border border-line bg-surface p-2 text-sm text-ink placeholder:text-ink-4 resize-y focus:outline-none focus:ring-1 focus:ring-brand"
        placeholder={placeholder ?? "Write something..."}
        defaultValue={initialBody ? extractPlainText(initialBody) : ""}
        onChange={(e) => {
          // Wrap plain text in a minimal rich-text document
          setBody({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: e.target.value
                  ? [{ type: "text", text: e.target.value }]
                  : [],
              },
            ],
          });
        }}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => body && onSave(body)}
          disabled={saving || !body}
        >
          {saving ? "Posting..." : initialBody ? "Save" : "Post"}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function extractPlainText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const doc = body as { content?: unknown[] };
  if (!doc.content) return "";
  return doc.content
    .map((node) => {
      const n = node as { content?: unknown[] };
      if (!n.content) return "";
      return n.content
        .map((c) => {
          const child = c as { text?: string };
          return child.text ?? "";
        })
        .join("");
    })
    .join("\n");
}
