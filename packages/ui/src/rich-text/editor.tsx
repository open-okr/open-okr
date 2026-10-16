"use client";

/**
 * The rich text editor component (docs/design/rich-text-editor.md §9).
 * Wraps `@tiptap/react`, configured to exactly the canonical allow-list
 * (§3) — nothing pulled in from `@tiptap/starter-kit` that is not on that
 * list.
 */
import { richTextLength } from "@openokr/formats";
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
  useState,
} from "react";
import { useTranslations } from "../i18n/use-translations.tsx";
import { cn } from "../lib/cn.ts";
import { Attachment } from "./attachment-node.ts";
import {
  createEntityLinkExtension,
  createMemberMentionExtension,
  type MentionSearchResult,
} from "./mention-extensions.ts";
import { SlashMenu } from "./slash-menu.ts";
import { EditorToolbar, LINK_HREF } from "./toolbar.tsx";
import { ReadOnlyUnderline } from "./underline.ts";

export interface UploadedFile {
  readonly blobId: string;
}

export interface RichTextEditorProps {
  /** The accessible name of the editing surface. Required, because TipTap
   * marks that surface `role="textbox"` and a textbox nobody named is a
   * serious accessibility finding. The placeholder is not a name: it
   * disappears the moment somebody types. */
  readonly label: string;
  /**
   * `compact` for the prose people write for each other (a comment, a
   * narrative, a bio): a toolbar of simple formats and no slash menu.
   * `full`, the default, is the document editor as it was
   * (docs/design/guided-inputs.md §4.7).
   */
  readonly variant?: "compact" | "full";
  readonly content?: unknown;
  readonly placeholder?: string;
  readonly editable?: boolean;
  /**
   * The most characters the field takes, counted the way the server counts
   * (`richTextLength` in `@openokr/formats`). Near it the field says how much
   * is used, and past it how much to take out: an editor cannot refuse a
   * keystroke the way `maxLength` does, so it says so instead.
   */
  readonly maxCharacters?: number;
  /** Puts the caret at the end once the editor is made: for a field that has
   * just been given text the person is now to edit. */
  readonly autoFocus?: boolean;
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

/**
 * The editor's document as plain JSON.
 *
 * ProseMirror builds every node's and mark's attributes with
 * `Object.create(null)`, and React's server action encoder cannot send an
 * object with no prototype: it sends a placeholder the server reads as
 * nothing, so a heading arrived as `attrs: "$T"` and the document was refused
 * as invalid. A link's address and a mention's id went the same way. Every
 * document this component hands out goes through here first.
 */
function plainJSON(json: unknown): unknown {
  return JSON.parse(JSON.stringify(json));
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
    label,
    variant = "full",
    content,
    placeholder,
    editable = true,
    maxCharacters,
    autoFocus = false,
    onUpdate,
    validate,
    searchMembers,
    searchEntities,
    uploadFile,
  },
  ref,
) {
  const [length, setLength] = useState(() => richTextLength(content));
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
          validate: (href: string) => LINK_HREF.test(href),
        },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Attachment,
      createMemberMentionExtension(searchMembers ?? noSearch),
      createEntityLinkExtension(searchEntities ?? noSearch),
      ReadOnlyUnderline,
      // A heading or a table in a comment is a document's job, so the menu
      // that makes them is the full editor's only.
      ...(variant === "full" ? [SlashMenu] : []),
    ],
    [searchMembers, searchEntities, variant],
  );

  const editor = useEditor({
    extensions,
    content: content as never,
    editable,
    autofocus: autoFocus ? "end" : false,
    // TipTap would append its base rules as an inline <style>, which the
    // Content-Security-Policy refuses in production. The same rules ship in
    // `styles/prosemirror.css` instead (completeness review L-22).
    injectCSS: false,
    editorProps: {
      // TipTap adds this role itself, but up to 3.31.3 it lost it as soon as
      // React re-applied these props, so it is stated here rather than
      // trusted. Enter starts a new paragraph, so the textbox says it is
      // multi-line; without that a screen reader announces a single field.
      attributes: {
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "true",
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
      },
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
      const json = plainJSON(current.getJSON());
      setLength(richTextLength(json));
      if (validate) {
        validate(json);
      }
      onUpdate?.(json);
    },
  });

  useEffect(() => () => editor?.destroy(), [editor]);

  // `useEditor` reads `editable` once, when it makes the editor. A row that
  // is set aside after that has to stop taking text too.
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

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
      getJSON: () => (editor ? plainJSON(editor.getJSON()) : undefined),
    }),
    [editor, hasUploadsInProgress],
  );

  const surface = (
    <EditorContent
      editor={editor}
      className="rich-text text-ink focus:outline-none"
    />
  );
  const counter =
    maxCharacters !== undefined && length >= Math.ceil(maxCharacters * 0.8) ? (
      <LengthCounter length={length} max={maxCharacters} />
    ) : null;
  return (
    <div className="flex flex-col gap-1.5">
      {editor && editable ? (
        <EditorToolbar editor={editor} blocks={variant === "full"} />
      ) : null}
      {surface}
      {counter}
    </div>
  );
});

/**
 * How much of a length limit is used, once it is close, and how much to take
 * out once it is passed. Its own component so that only a field with a limit
 * needs the translations, as `TextInput`'s counter does.
 */
function LengthCounter({
  length,
  max,
}: {
  readonly length: number;
  readonly max: number;
}) {
  const { t } = useTranslations();
  const over = length - max;
  return (
    <p
      className={cn(
        "text-xs",
        over > 0 ? "font-medium text-bad" : "text-ink-3",
      )}
      aria-live="polite"
    >
      {over > 0
        ? t("fields.counterOver", { used: length, max, over })
        : t("fields.counter", { used: length, max })}
    </p>
  );
}

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
