import { Command } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn.ts";

/** The character the shortcut registry and every call site write for the
 * modifier. Kept as the authored form, because UIUX-PLAN.md §4 and the
 * registry's display strings both spell shortcuts "⌘K". */
const COMMAND = "⌘";

/**
 * The modifier, drawn rather than typed.
 *
 * U+2318 is not in the self-hosted Geist subset, so the browser fell through
 * to a system symbol font. Measured in Chrome 151 at 10.5px: the fallback
 * glyph claimed 11.4px of advance against the letter's 6.9px, so "⌘K" read
 * as a large symbol with a small letter stuck to it, and it looked different
 * on every operating system. `font-size-adjust: ex-height` was tried and
 * does nothing here: it applies, and a symbol has no x-height to normalise
 * against.
 *
 * Lucide is the icon set §2 names, so the glyph now comes from the same
 * place as every other icon, at the size of the text beside it. The label is
 * hidden text rather than an `aria-label`, so the key is still announced as
 * part of the badge's own reading order.
 */
function CommandGlyph() {
  return (
    <>
      <span className="sr-only">Command </span>
      <Command
        aria-hidden="true"
        className="inline-block size-[1.05em] align-[-0.15em] stroke-[2.5]"
      />
    </>
  );
}

/**
 * Replaces the modifier character in authored text with the icon.
 *
 * Done here rather than at the call sites so `<Kbd>⌘K</Kbd>`, the shortcut
 * registry's `keys: "⌘J"` display strings and the overlay's key list all
 * keep working unchanged. A component that only accepted pre-split keys
 * would move this decision into six places.
 */
function withCommandIcon(children: ReactNode): ReactNode {
  if (typeof children !== "string") {
    return children;
  }
  const at = children.indexOf(COMMAND);
  if (at === -1) {
    return children;
  }
  // Recursive rather than split-and-map: nesting fragments needs no keys, and
  // a key made from an array index is both a lint failure and a lie, since
  // these nodes are positional.
  return (
    <>
      {children.slice(0, at)}
      <CommandGlyph />
      {withCommandIcon(children.slice(at + COMMAND.length))}
    </>
  );
}

/**
 * `.kbd` from the mockups' style.css: a single key, used by the search box's
 * "⌘K" hint and the shortcut overlay's own key list.
 *
 * `font-sans` is not decoration. A `<kbd>` inherits a monospace family from
 * the user agent, and Preflight leaves it there, so this badge shipped in
 * Consolas while every label beside it was in Geist. The mockups' own `.kbd`
 * inherits the page's sans, which is what this restores.
 */
export function Kbd({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center gap-px rounded-[5px] border border-b-2 border-line-2 bg-surface px-1.5 py-px font-sans text-[10.5px] font-semibold text-ink-3",
        className,
      )}
      {...props}
    >
      {withCommandIcon(children)}
    </kbd>
  );
}
