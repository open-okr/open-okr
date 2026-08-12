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
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border",
    "text-sm font-semibold transition-[border-color,box-shadow,transform] duration-fast ease-out",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
    "disabled:pointer-events-none disabled:bg-raised disabled:border-line disabled:text-ink-4 disabled:shadow-none",
  ],
  {
    variants: {
      variant: {
        default: [
          "border-line-2 bg-surface text-ink-2 shadow-[0_1px_2px_rgba(15,23,42,0.05)]",
          "hover:border-ink-4 hover:-translate-y-px hover:shadow-[0_2px_6px_rgba(15,23,42,0.08)]",
        ],
        primary: [
          "border-brand-600 bg-brand text-white shadow-[0_1px_3px_rgba(79,70,229,0.28)]",
          "hover:-translate-y-px hover:shadow-[0_3px_10px_rgba(79,70,229,0.28)]",
        ],
        ai: [
          "border-brand-line bg-surface text-brand-600 shadow-[0_1px_2px_rgba(79,70,229,0.1)]",
          "hover:border-brand hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(79,70,229,0.18)]",
        ],
        ghost: "border-transparent bg-transparent text-ink-2 hover:bg-raised",
      },
      size: {
        default: "h-7.5 px-3",
        sm: "h-6.25 rounded-md px-2.5 text-xs",
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
