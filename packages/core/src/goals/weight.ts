import { WEIGHT_MAX, WEIGHT_MIN } from "@openokr/method";
import { z } from "zod";

/**
 * How much a goal or a key result counts toward what it sits under, within
 * the method's `WEIGHT_MIN` to `WEIGHT_MAX` (METHOD.md §3.1). 0 keeps it on
 * the page without counting it.
 *
 * **Refused outside the range at the action, not clamped**
 * (docs/design/guided-inputs.md §4.8): the field holds the same bounds, so a
 * call sending 150 is told so rather than quietly stored as 100. The service
 * still clamps what it writes, and the average clamps what it reads, for a
 * row that reached the table another way.
 */
export const weightSchema = z
  .number()
  .min(
    WEIGHT_MIN,
    `A weight is at least ${WEIGHT_MIN}. ${WEIGHT_MIN} keeps it on the page without counting it.`,
  )
  .max(WEIGHT_MAX, `A weight is at most ${WEIGHT_MAX}.`);
