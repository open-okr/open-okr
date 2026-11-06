"use client";

import { LoaderCircle } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { useDelayedFlag } from "./button.tsx";

/**
 * The small spinner for a control that saves without a button of its own
 * (an inline select, a switch): the control is disabled and this sits beside
 * it. Decorative, so a screen reader hears the control's own busy state.
 *
 * It is drawn only while the save is on its way, so mounting it starts the
 * wait: it appears after the same 200 ms as a button's spinner and as the bar
 * at the top (UIUX-PLAN §4, "Acting"), and a fast save shows nothing.
 */
export function Spinner({ className }: { readonly className?: string }) {
  const shown = useDelayedFlag(true);
  if (!shown) {
    return null;
  }
  return (
    <LoaderCircle
      aria-hidden="true"
      data-testid="pending-spinner"
      className={cn(
        "size-3.5 animate-spin motion-reduce:animate-none",
        className,
      )}
    />
  );
}
