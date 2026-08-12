import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.ts";

export type BarTone = "default" | "ok" | "warn" | "bad";

const fillToneClass: Record<BarTone, string> = {
  default: "bg-gradient-to-r from-[#818cf8] to-brand",
  ok: "bg-gradient-to-r from-[#4ade80] to-[#16a34a]",
  warn: "bg-gradient-to-r from-[#fbbf24] to-[#ea8c09]",
  bad: "bg-gradient-to-r from-[#f87171] to-[#dc2626]",
};

export interface BarProps extends HTMLAttributes<HTMLDivElement> {
  /** 0 to 100. Out-of-range values clamp rather than overflow the track. */
  readonly value: number;
  readonly tone?: BarTone;
  /** §2: progress bars "may grow to their value" on first paint. Off by
   * default because a bar re-rendering with a new value (an update, not a
   * mount) must never replay the entrance. */
  readonly animateOnMount?: boolean;
}

/** `.bar`/`.bar > i` from the mockups' style.css — the progress/corridor
 * bar §5's `TrendChart`, `CorridorGauge` and every progress column build
 * on. Reduced motion is handled globally (tokens.css's media query zeroes
 * every transition/animation duration), not here. */
export function Bar({
  value,
  tone = "default",
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
        "h-1.5 flex-none overflow-hidden rounded-full bg-[#e7ecf4] shadow-[inset_0_1px_1px_rgba(15,23,42,0.05)]",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "block h-full rounded-full",
          fillToneClass[tone],
          animateOnMount && "animate-grow-bar",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
