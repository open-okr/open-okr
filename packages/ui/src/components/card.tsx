import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.ts";

/** `.card`/`.card-h`/`.card-b` from the mockups' style.css. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface shadow-(--shadow-card)",
        className,
      )}
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
