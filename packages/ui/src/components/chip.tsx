import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.ts";

/**
 * `.chip` from the mockups' style.css. This is the generic, tone-only
 * primitive UIUX-PLAN.md §4's "Health", "Confidence", "Staleness" and
 * "Accountability chips" patterns all render through — the entity-specific
 * wrappers named in §5 (`HealthBadge`, `StalenessBadge`, `ConfidenceBand`,
 * `BlockerChip`) are their own later tasks' deliverables, once there is a
 * health/confidence/blocker model to read from; this is only the shared
 * visual shape they all build on.
 *
 * Colour is never the only signal (§2): every real usage pairs a tone with
 * a label or an icon, but that pairing belongs to the caller, not this
 * primitive, which the `dot` prop exists to make easy rather than
 * mandatory.
 */
const chipVariants = cva(
  "inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-semibold",
  {
    variants: {
      tone: {
        neutral: "bg-raised text-ink-2",
        ok: "bg-ok-bg text-ok",
        warn: "bg-warn-bg text-warn",
        bad: "bg-bad-bg text-bad",
        info: "bg-info-bg text-info",
        brand: "bg-brand-weak text-brand-600",
        agent: "bg-brand-weak text-brand-600",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

const dotToneClass: Record<NonNullable<ChipProps["tone"]>, string> = {
  neutral: "bg-ink-4",
  ok: "bg-ok-dot",
  warn: "bg-warn-dot",
  bad: "bg-bad-dot",
  info: "bg-info-dot",
  brand: "bg-brand",
  agent: "bg-brand",
};

export interface ChipProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof chipVariants> {
  /** Renders the small tone-coloured dot the mockups' `.chip .dot` shows. */
  readonly dot?: boolean;
}

export function Chip({
  className,
  tone = "neutral",
  dot,
  children,
  ...props
}: ChipProps) {
  return (
    <span className={cn(chipVariants({ tone }), className)} {...props}>
      {dot ? (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 flex-none rounded-full",
            dotToneClass[tone ?? "neutral"],
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
