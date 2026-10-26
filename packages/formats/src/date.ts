/**
 * A local calendar date, written `YYYY-MM-DD`: a day in somebody's calendar,
 * not an instant. The shape only, as every action that took one checked it;
 * whether the day exists is the reader's question.
 */
export const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `text` is written as a local date. */
export function isLocalDate(text: string): boolean {
  return LOCAL_DATE_PATTERN.test(text);
}
