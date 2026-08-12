import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.ts";

export interface BarProps extends HTMLAttributes<HTMLDivElement> {
  /** 0 to 100. Out-of-range values clamp rather than overflow the track. */
  readonly value: number;
  /** §2: progress bars "may grow to their value" on first paint. Off by
   * default because a bar re-rendering with a new value (an update, not a
   * mount) must never replay the entrance. */
  readonly animateOnMount?: boolean;
}

/**
 * `.bar`/`.bar > i` from the mockups' style.css — the progress/corridor
 * bar §5's `TrendChart`, `CorridorGauge` and every progress column build
 * on. Reduced motion is handled globally (tokens.css's media query zeroes
 * every transition/animation duration), not here.
 *
 * **The fill has no tone, and never will.** Rule 2 of the colour system:
 * progress is not health. A key result can be at 90 percent and still be
 * off track if the deadline is tomorrow, so a bar that recolours by health
 * merges two independent variables and hides one of them. Show progress
 * with the bar, show health with a `Chip` beside it.
 *
 * This component used to take `tone="ok" | "warn" | "bad"`. If you are here
 * to put it back, that is the rule you are about to break.
 */
export function Bar({
  value,
  animateOnMount = false,
  className,
  ...props
}: BarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn(
        "h-1.5 flex-none overflow-hidden rounded-full bg-track",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "block h-full rounded-full bg-brand-strong",
          animateOnMount && "animate-grow-bar",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
