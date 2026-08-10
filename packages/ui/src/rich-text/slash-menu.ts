/**
 * The `/` slash-command menu (UIUX-PLAN.md §2, docs/design/rich-text-editor.md
 * §9). Not a node, unlike mentions: each item runs an editor command
 * directly (turn this block into a heading, a list, a table, a quote),
 * so this is a plain `Extension` wrapping `@tiptap/suggestion` rather
 * than anything that inserts a node of its own.
 */
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionItem } from "./suggestion-list.tsx";
import { createSuggestionRender } from "./suggestion-list.tsx";

interface SlashCommandItem extends SuggestionItem {
  readonly run: (
    editor: Editor,
    range: { readonly from: number; readonly to: number },
  ) => void;
}

const SLASH_COMMANDS: readonly SlashCommandItem[] = [
  {
    id: "heading1",
    label: "Heading 1",
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 1 })
        .run(),
  },
  {
    id: "heading2",
    label: "Heading 2",
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 2 })
        .run(),
  },
  {
    id: "bulletList",
    label: "Bullet list",
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: "orderedList",
    label: "Numbered list",
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: "codeBlock",
    label: "Code block",
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("codeBlock").run(),
  },
  {
    id: "blockquote",
    label: "Quote",
    run: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("blockquote").run(),
  },
  {
    id: "table",
    label: "Table",
    run: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
        .run(),
  },
];

export const SlashMenu = Extension.create({
  name: "slashMenu",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        char: "/",
        // The menu only opens at the start of an empty block (UIUX-PLAN
        // §2's own "slash commands" line describes a command, not a
        // mid-sentence trigger) — a `/` typed anywhere else is just a
        // character.
        allow: ({ state, range }) => {
          const { $from } = state.selection;
          const isAtBlockStart = range.from === $from.start();
          const isEmptyBlock =
            $from.parent.textContent.length === range.to - range.from;
          return isAtBlockStart && isEmptyBlock;
        },
        items: ({ query }) =>
          SLASH_COMMANDS.filter((item) =>
            item.label.toLowerCase().includes(query.toLowerCase()),
          ),
        render: createSuggestionRender<SlashCommandItem>(),
        command: ({ editor, range, props }) => {
          props.run(editor, range);
        },
      }),
    ];
  },
});
