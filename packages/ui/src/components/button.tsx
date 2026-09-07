import { cva, type VariantProps } from "class-variance-authority";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../lib/cn.ts";

/**
 * `.btn`/`.btn.p`/`.btn.ai`/`.btn.sm`/`.btn.dis` from the mockups' own
 * style.css (UIUX-PLAN.md §10's "proposed default"), reimplemented as
 * Tailwind utilities against the design tokens rather than copied
 * verbatim, so dark mode and density fall out of the same tokens every
 * other component uses instead of a second hand-written dark palette.
 */
export const buttonVariants = cva(
  [
    // `rounded-control`, not `rounded-lg`: the latter is the card radius (14px),
    // and 14px on a 30px control is a pill. The mockups' `.btn` is 8px.
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control border",
    "text-sm font-semibold transition-[border-color,box-shadow,transform] duration-fast ease-out",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-strong",
    "disabled:pointer-events-none disabled:bg-raised disabled:border-line disabled:text-ink-4 disabled:shadow-none",
  ],
  {
    variants: {
      variant: {
        // Shadows come from tokens rather than inline rgba: the brand-tinted
        // ones are mixed from --brand, so a workspace that sets its own brand
        // colour gets a glow in its hue instead of a stranded indigo one.
        default: [
          "border-line-2 bg-surface text-ink-2 shadow-control",
          "hover:border-ink-4 hover:-translate-y-px hover:shadow-control-hover",
        ],
        primary: [
          "border-brand-600 bg-brand text-on-brand shadow-brand",
          "hover:bg-brand-600 hover:-translate-y-px hover:shadow-brand-hover",
          "active:bg-brand-700",
        ],
        // The secondary/AI button: a surface fill with brand text, per the
        // colour system's own recipe. Its label is --brand-text, not --brand,
        // because it is text (rule 5).
        ai: [
          "border-brand-line bg-surface text-brand-text shadow-control",
          "hover:border-brand-strong hover:-translate-y-px hover:shadow-brand",
        ],
        ghost: "border-transparent bg-transparent text-ink-2 hover:bg-raised",
      },
      size: {
        default: "h-7.5 px-3",
        sm: "h-6.25 rounded-control px-2.5 text-xs",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
