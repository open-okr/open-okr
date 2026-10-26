import { cn } from "../lib/cn.ts";

/**
 * Stored rich text, shown as it was written (docs/design/guided-inputs.md
 * §4.7): a comment, a check-in narrative, a retrospective, a bio.
 *
 * **`html` must come from core's `renderRichTextToHtml`**, on the server.
 * That renderer escapes every text value and writes tags only from its own
 * allow-list, which is what makes setting it here safe, and it is the same
 * renderer email and exports use, so the screen cannot show something they
 * do not. `packages/ui` cannot import core, so the caller renders and this
 * only places the result, under the one stylesheet for rich text.
 */
export function RichTextView({
  html,
  className,
}: {
  readonly html: string;
  readonly className?: string;
}) {
  return (
    <div
      className={cn("rich-text", className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: rendered by renderRichTextToHtml, see above
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
