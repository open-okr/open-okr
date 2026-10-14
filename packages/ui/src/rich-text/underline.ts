import { Mark } from "@tiptap/core";

/**
 * Underline, read and never written (docs/design/guided-inputs.md §4.7).
 *
 * **Step 1 of two.** An editor whose schema lacks a mark refuses the whole
 * document that carries one, so every editor has to know underline before any
 * editor may add it: during a rolling upgrade, or in a tab left open across
 * one, an older bundle meets what a newer one wrote. This release shows the
 * mark, as `<u>`, and has no way to make it: no keyboard shortcut, no toolbar
 * button, and no rule turning pasted `<u>` into it. The next release adds all
 * three.
 *
 * Defined here rather than taken from TipTap's own underline extension, which
 * would be a new dependency for one mark with nothing in it but a name and a
 * tag.
 */
export const ReadOnlyUnderline = Mark.create({
  name: "underline",
  parseHTML() {
    return [];
  },
  renderHTML({ HTMLAttributes }) {
    return ["u", HTMLAttributes, 0];
  },
});
