"use client";

/**
 * The rich text editor component (docs/design/rich-text-editor.md §9).
 * Wraps `@tiptap/react`, configured to exactly the canonical allow-list
 * (§3) — nothing pulled in from `@tiptap/starter-kit` that is not on that
 * list.
 */
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
} from "react";
import { Attachment } from "./attachment-node.ts";
import {
  createEntityLinkExtension,
  createMemberMentionExtension,
  type MentionSearchResult,
} from "./mention-extensions.ts";
import { SlashMenu } from "./slash-menu.ts";

export interface UploadedFile {
  readonly blobId: string;
}

export interface RichTextEditorProps {
  readonly content?: unknown;
  readonly placeholder?: string;
  readonly editable?: boolean;
  readonly onUpdate?: (json: unknown) => void;
  /** `packages/ui` cannot import `packages/core`'s `parseRichText`
   * (TECHNICAL-PLAN §1's own package table) — a host wires the real
   * validator in. A client-side early warning only; the write boundary's
   * own validation is the actual enforcement.
   *
   * Async, because the only way a real host ever has a validator to hand
   * over is a Server Action or an API call — `@openokr/core` is
   * server-only, so anything reaching it from a Client Component (this
   * one) crosses a network boundary whether it looks like it or not. A
   * synchronous signature here would be a promise this prop could never
   * actually keep. */
  readonly validate?: (json: unknown) => boolean | Promise<boolean>;
  readonly searchMembers?: (
    query: string,
  ) => Promise<readonly MentionSearchResult[]>;
  readonly searchEntities?: (
    query: string,
  ) => Promise<readonly MentionSearchResult[]>;
  readonly uploadFile?: (file: File) => Promise<UploadedFile>;
}

export interface RichTextEditorHandle {
  /** §7's submit gate: refuses while any attachment is still uploading. */
  hasUploadsInProgress(): boolean;
  getJSON(): unknown;
}

const NO_SEARCH_RESULTS: readonly MentionSearchResult[] = [];

async function noSearch(): Promise<readonly MentionSearchResult[]> {
  return NO_SEARCH_RESULTS;
}

export const RichTextEditor = forwardRef<
  RichTextEditorHandle,
  RichTextEditorProps
>(function RichTextEditor(
  {
    content,
    placeholder,
    editable = true,
    onUpdate,
    validate,
    searchMembers,
    searchEntities,
    uploadFile,
  },
  ref,
) {
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        dropcursor: false,
        gapcursor: false,
        undoRedo: false,
        underline: false,
        listKeymap: false,
        heading: { levels: [1, 2, 3] },
        link: {
          protocols: ["http", "https", "mailto"],
          openOnClick: false,
          validate: (href: string) => /^(https?:|mailto:)/.test(href),
        },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Attachment,
      createMemberMentionExtension(searchMembers ?? noSearch),
      createEntityLinkExtension(searchEntities ?? noSearch),
      SlashMenu,
    ],
    [searchMembers, searchEntities],
  );

  const editor = useEditor({
    extensions,
    content: content as never,
    editable,
    editorProps: {
      attributes: placeholder ? { "data-placeholder": placeholder } : {},
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0 || !uploadFile) {
          return false;
        }
        for (const file of files) {
          insertUploadingAttachment(view, file, uploadFile);
        }
        return true;
      },
      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0 || !uploadFile) {
          return false;
        }
        event.preventDefault();
        for (const file of files) {
          insertUploadingAttachment(view, file, uploadFile);
        }
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      const json = current.getJSON();
      if (validate) {
        validate(json);
      }
      onUpdate?.(json);
    },
  });

  useEffect(() => () => editor?.destroy(), [editor]);

  const hasUploadsInProgress = useCallback(() => {
    if (!editor) {
      return false;
    }
    let uploading = false;
    editor.state.doc.descendants((node) => {
      if (
        node.type.name === "attachment" &&
        node.attrs.status === "uploading"
      ) {
        uploading = true;
      }
    });
    return uploading;
  }, [editor]);

  useImperativeHandle(
    ref,
    () => ({
      hasUploadsInProgress,
      getJSON: () => editor?.getJSON(),
    }),
    [editor, hasUploadsInProgress],
  );

  return (
    <EditorContent
      editor={editor}
      className="prose prose-sm max-w-none text-ink focus:outline-none"
    />
  );
});

/**
 * §7's upload flow, steps 2-4: an `attachment` node appears immediately
 * with `status: "uploading"` and no `blobId`, then flips to `"ready"`
 * with a real one — or is removed outright on failure, never left
 * pointing at nothing.
 */
function insertUploadingAttachment(
  view: import("@tiptap/pm/view").EditorView,
  file: File,
  uploadFile: (file: File) => Promise<UploadedFile>,
): void {
  const { state, dispatch } = view;
  const node = state.schema.nodes.attachment?.create({
    filename: file.name,
    contentType: file.type,
    status: "uploading",
  });
  if (!node) {
    return;
  }
  const position = state.selection.from;
  dispatch(state.tr.insert(position, node));

  uploadFile(file).then(
    (uploaded) => {
      const { state: currentState, dispatch: currentDispatch } = view;
      currentState.doc.descendants((candidate, pos) => {
        if (candidate.type.name === "attachment" && candidate === node) {
          currentDispatch(
            currentState.tr.setNodeMarkup(pos, undefined, {
              ...candidate.attrs,
              status: "ready",
              blobId: uploaded.blobId,
            }),
          );
        }
      });
    },
    () => {
      const { state: currentState, dispatch: currentDispatch } = view;
      currentState.doc.descendants((candidate, pos) => {
        if (candidate.type.name === "attachment" && candidate === node) {
          currentDispatch(
            currentState.tr.delete(pos, pos + candidate.nodeSize),
          );
        }
      });
    },
  );
}
