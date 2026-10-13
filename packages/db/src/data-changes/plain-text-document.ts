/**
 * Plain text as an editor document, for the data changes that move a plain
 * prose column to rich text (docs/design/guided-inputs.md §4.7, changes 11
 * and 12).
 *
 * The same rule as `richTextFromPlainText` in `packages/core`, written again
 * here because `packages/db` cannot depend on `packages/core`: blank lines
 * separate paragraphs, each block is trimmed, empty blocks go, and nothing is
 * interpreted, so an asterisk stays an asterisk. The tests hold the two to the
 * same output.
 */
export function plainTextDocument(text: string): {
  readonly type: "doc";
  readonly content: readonly {
    readonly type: "paragraph";
    readonly content: readonly {
      readonly type: "text";
      readonly text: string;
    }[];
  }[];
} {
  const paragraphs = text
    .replaceAll("\r\n", "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== "");
  return {
    type: "doc",
    content: paragraphs.map((block) => ({
      type: "paragraph",
      content: [{ type: "text", text: block }],
    })),
  };
}

/** The rich text schema version a backfilled document is written at. */
export const BACKFILL_RICH_TEXT_VERSION = 1;
