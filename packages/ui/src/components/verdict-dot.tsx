import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.ts";

export type VerdictState = "pass" | "warn" | "fail" | "todo";

const stateClass: Record<VerdictState, string> = {
  pass: "bg-ok-dot shadow-[0_0_0_2.5px_rgba(34,197,94,0.18)]",
  warn: "bg-warn-dot shadow-[0_0_0_2.5px_rgba(245,158,11,0.18)]",
  fail: "bg-bad-dot shadow-[0_0_0_2.5px_rgba(239,68,68,0.18)]",
  todo: "bg-ink-4 shadow-[0_0_0_2.5px_rgba(148,163,184,0.18)]",
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
