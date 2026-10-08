import type { MessageValues } from "@openokr/ui";

/**
 * A goal's health in words (METHOD.md §3.5, P9-T15b-a).
 *
 * Every surface printed the stored value with its underscore taken out, so
 * `caution` read "caution" where §3.5 says "At risk", a term a workspace may
 * rename, and an abandoned objective read as its code. One map, so the chip,
 * the goal page, the check-in list and the diagram say the same word.
 */
const HEALTH_LABEL = {
  pending: "health.pending",
  on_track: "common.onTrack",
  caution: "common.caution",
  off_track: "common.offTrack",
  outdated: "health.outdated",
  achieved: "health.achieved",
  missed: "health.missed",
  abandoned: "health.abandoned",
} as const;

type Translate = (key: string, values?: MessageValues) => string;

/** The words for one health, or the stored value for one this map lacks. */
export function healthWord(t: Translate, health: string): string {
  return health in HEALTH_LABEL
    ? t(HEALTH_LABEL[health as keyof typeof HEALTH_LABEL])
    : health.replace("_", " ");
}
