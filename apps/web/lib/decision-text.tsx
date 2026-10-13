import { RichTextView } from "@openokr/ui";
import { richTextHtml } from "./rich-text-html.ts";

/**
 * A decision as it was written (guided-inputs change 11a): its document drawn
 * as rich text, or its plain text where it has none. Rendered on the server,
 * like every other rich text the product shows.
 */
export function DecisionText({
  document,
  text,
}: {
  readonly document: unknown;
  readonly text: string;
}) {
  const html = richTextHtml(document);
  return html === null ? (
    <span className="text-sm text-ink">{text}</span>
  ) : (
    <RichTextView html={html} className="text-sm text-ink" />
  );
}
