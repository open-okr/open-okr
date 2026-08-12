import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.ts";

/** `.kbd` from the mockups' style.css — a single key, used by the search
 * box's "⌘K" hint and the shortcut overlay's own key list. */
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "rounded-[5px] border border-b-2 border-line-2 bg-surface px-1.5 py-px text-[10.5px] font-semibold text-ink-3",
        className,
      )}
      {...props}
    />
  );
}
