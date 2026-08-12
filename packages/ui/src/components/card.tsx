import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.ts";

/**
 * `.card`/`.card-h`/`.card-b` from the mockups' style.css.
 *
 * No shadow, on purpose. The colour system separates a card from the page
 * with its border and its lighter surface against --bg, and lists dropping
 * a shadow on a card as an anti-pattern. A shadow survives only on a layer
 * that floats over arbitrary content, where a border cannot do the job:
 * menus, dialogs and popovers, which reach for shadow-popover.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-line bg-surface", className)}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 border-b border-line px-3.5 py-3",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-3.5", className)} {...props} />;
}
