/**
 * The words and tones the initiative screens use (S-26, P5-T10b).
 *
 * Its own module because `actions.ts` carries `"use server"` and may export
 * nothing but async functions, and because the list, the detail panel and the
 * cycle's capacity view all draw the same three verdicts. Three copies of a
 * colour mapping is how one of them ends up saying `exceeds` is fine.
 *
 * **Unjudged is its own row, not a blank.** Null capacity means nobody has
 * looked, which is exactly the state METHOD.md §5.5 exists to end, and publish
 * gate five reads it differently from `fits`. Drawing it as an empty cell would
 * hide the thing the section is about.
 */
import type { ChipProps } from "@openokr/ui";

export const STATUS_OPTIONS = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
  { value: "dropped", label: "Dropped" },
] as const;

export const STATUS_LABEL: Readonly<Record<string, string>> = {
  planned: "Planned",
  active: "Active",
  done: "Done",
  dropped: "Dropped",
};

/** The empty value is "not judged", which is a real answer and the default. */
export const CAPACITY_OPTIONS = [
  { value: "", label: "Capacity not judged" },
  { value: "fits", label: "Fits" },
  { value: "tight", label: "Tight" },
  { value: "exceeds", label: "Exceeds" },
] as const;

export const CAPACITY_LABEL: Readonly<Record<string, string>> = {
  unjudged: "Capacity not judged",
  fits: "Fits",
  tight: "Tight",
  exceeds: "Exceeds",
};

/**
 * Colour is never the only signal (UIUX-PLAN.md §2), so every use pairs these
 * with the label above. `exceeds` is `bad` because it is the one verdict that
 * refuses a publication.
 */
export const CAPACITY_TONE: Readonly<Record<string, ChipProps["tone"]>> = {
  unjudged: "neutral",
  fits: "ok",
  tight: "warn",
  exceeds: "bad",
};
