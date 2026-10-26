import { LOCAL_DATE_PATTERN } from "@openokr/formats";
import { z } from "zod";

/**
 * A calendar date, `YYYY-MM-DD`, never a free string: a due date, a start or
 * an end. One schema for every action that takes one, so a task's due date is
 * held to the rule a key result's already was (guided-inputs §4.9).
 */
export const localDate = z
  .string()
  .regex(LOCAL_DATE_PATTERN, "Give the date as YYYY-MM-DD.");
