import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.ts";

export type VerdictState = "pass" | "warn" | "fail" | "todo";

/**
 * The halo is mixed from the dot's own token rather than written as a raw
 * rgba, so it follows the token through a theme change instead of keeping
 * the light-mode hue on a dark background.
 */
const stateClass: Record<VerdictState, string> = {
  pass: "bg-ok-dot shadow-[0_0_0_2.5px_color-mix(in_srgb,var(--ok-dot)_18%,transparent)]",
  warn: "bg-warn-dot shadow-[0_0_0_2.5px_color-mix(in_srgb,var(--warn-dot)_18%,transparent)]",
  fail: "bg-bad-dot shadow-[0_0_0_2.5px_color-mix(in_srgb,var(--bad-dot)_18%,transparent)]",
  todo: "bg-ink-4 shadow-[0_0_0_2.5px_color-mix(in_srgb,var(--ink-4)_18%,transparent)]",
};

const stateLabel: Record<VerdictState, string> = {
  pass: "Pass",
  warn: "Warning",
  fail: "Fail",
  todo: "Not yet checked",
};

export interface VerdictDotProps extends HTMLAttributes<HTMLSpanElement> {
  readonly state: VerdictState;
  /** Overrides the default accessible label (e.g. to name the rule). */
  readonly label?: string;
}

/**
 * `.vd`/`.vd.pass`/`.vd.warn`/`.vd.fail`/`.vd.todo` from the mockups'
 * style.css. UIUX-PLAN.md §4's "Coaching inline" pattern: "a coloured dot,
 * a short label, and on click the coaching prompt" — this is only the dot.
 * The click-to-reveal coaching prompt is `RuleVerdict` (§5), built once a
 * rule engine exists to show one (packages/method's rule surface, not yet
 * wired into any screen).
 */
export function VerdictDot({
  state,
  label,
  className,
  ...props
}: VerdictDotProps) {
  return (
    <span
      role="img"
      aria-label={label ?? stateLabel[state]}
      className={cn(
        "inline-block size-2 flex-none rounded-full",
        stateClass[state],
        className,
      )}
      {...props}
    />
  );
}
