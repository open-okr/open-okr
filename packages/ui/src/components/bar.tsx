import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.ts";

export interface BarProps extends HTMLAttributes<HTMLDivElement> {
  /** 0 to `max`. Out-of-range values clamp rather than overflow the track. */
  readonly value: number;
  /**
   * The full track, 100 by default.
   *
   * A workspace may raise METHOD.md §11's `scoring.progressCeilingPct` as far
   * as 200, and a caller showing progress under a raised ceiling passes the
   * resolved ceiling here. Without it a goal at 150% would fill the track at
   * 100 and `aria-valuemax` would tell a screen reader that 100 was the most
   * there is, which is a different claim from the one on the page beside it.
   *
   * 100 here is this component's own axis rather than a second home for the
   * threshold: a caller that shows an ordinary 0-to-100 percentage passes
   * nothing, and the one screen that shows progress passes what it resolved.
   */
  readonly max?: number;
  /**
   * What this bar is the progress of, for anybody who cannot see it.
   *
   * **A progressbar with no name is a serious accessibility finding**, and
   * that is what P7-T05's scan reported on the dashboard: a screen reader
   * announced "progressbar, 40" fifty times with nothing to say which goal
   * each belonged to. Name it after the thing, not after the widget: "Ship
   * the mobile app", not "Progress bar".
   *
   * It falls back to "Progress" rather than nothing, because a generic name
   * is still better than an anonymous one, and a caller that forgets is a
   * caller whose screen still passes the gate. Pass the real one.
   */
  readonly label?: string;
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
  label,
  max = 100,
  animateOnMount = false,
  className,
  ...props
}: BarProps) {
  // A max of zero or less has no track to divide by, so it reads as the
  // ordinary axis rather than producing a width of Infinity.
  const ceiling = max > 0 ? max : 100;
  const clamped = Math.min(ceiling, Math.max(0, value));
  return (
    <div
      role="progressbar"
      // A caller that sets `aria-label` or `aria-labelledby` itself wins:
      // pointing at a heading that is already on the screen is better than
      // repeating its text, and `{...props}` below would override this
      // anyway. The default is here so the name is never absent.
      aria-label={label ?? "Progress"}
      aria-valuemin={0}
      aria-valuemax={ceiling}
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
        style={{ width: `${(clamped / ceiling) * 100}%` }}
      />
    </div>
  );
}
