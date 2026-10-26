import { Mark } from "@tiptap/core";

/**
 * Underline (docs/design/guided-inputs.md §4.7).
 *
 * **Step 2 of two.** An editor whose schema lacks a mark refuses the whole
 * document that carries one, so every editor had to know underline before any
 * editor could add it: during a rolling upgrade, or in a tab left open across
 * one, an older bundle meets what a newer one wrote. Step 1 shipped the mark
 * read-only in 0.3. This one writes it: the toolbar button, Mod-U, and pasted
 * `<u>`.
 *
 * Defined here rather than switching on StarterKit's own, which also reads a
 * `text-decoration` style. Its command names are declared by that extension's
 * types, which StarterKit brings, so this mark answers to the same three.
 */
export const Underline = Mark.create({
  name: "underline",
  parseHTML() {
    // Only the tag. A `text-decoration` style is how a pasted link often
    // looks, and reading it as underline would underline every pasted link.
    return [{ tag: "u" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["u", HTMLAttributes, 0];
  },
  addCommands() {
    return {
      setUnderline:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      toggleUnderline:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
      unsetUnderline:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-u": () => this.editor.commands.toggleUnderline(),
      "Mod-U": () => this.editor.commands.toggleUnderline(),
    };
  },
});
