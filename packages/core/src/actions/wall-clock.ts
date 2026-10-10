import { normaliseWallClock, WALL_CLOCK_PATTERN } from "@openokr/formats";
import { z } from "zod";

/**
 * A time on somebody's clock, `HH:MM`, for every action that takes one:
 * quiet hours, the daily summary and a booked session (guided-inputs §4.9).
 *
 * "9:30" is accepted, as people write it, and handed on as "09:30", so what
 * is stored is one shape whoever sent it.
 */
export const wallClock = z
  .string()
  .trim()
  .regex(WALL_CLOCK_PATTERN, "Give the time as HH:MM, from 00:00 to 23:59.")
  .transform((text) => normaliseWallClock(text) as string);
