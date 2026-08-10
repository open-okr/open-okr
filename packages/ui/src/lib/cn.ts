import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** The standard shadcn/ui class-merge: `clsx` for conditional classes, then
 * `tailwind-merge` so a later conflicting utility (e.g. a caller's own
 * `bg-*`) wins over a component's default instead of both landing in the
 * class list and letting CSS source order decide. */
export function cn(...inputs: readonly ClassValue[]): string {
  return twMerge(clsx(inputs));
}
