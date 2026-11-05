import { LoaderCircle } from "lucide-react";
import { cn } from "../lib/cn.ts";

/**
 * The small spinner for a control that saves without a button of its own
 * (an inline select, a switch): the control is disabled and this sits beside
 * it. Decorative, so a screen reader hears the control's own busy state.
 */
export function Spinner({ className }: { readonly className?: string }) {
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
