import { type RefObject, useEffect, useRef } from "react";

/**
 * Calls `onReset` when the form around `within` resets.
 *
 * React resets a form whose action succeeded, which clears what the browser
 * holds and not what a field holds in its own state. A field that keeps the
 * value to say something about it (a date's words, a range's end bound)
 * would otherwise show and post the last row's value with the next one.
 */
export function useFormReset(
  within: RefObject<Element | null>,
  onReset: () => void,
): void {
  const latest = useRef(onReset);
  // Kept in render, not in an effect: a save that succeeds brings the new
  // saved value in the same commit React resets the form in, before any
  // effect runs, and the reset has to go back to that value.
  latest.current = onReset;
  useEffect(() => {
    const form = within.current?.closest("form");
    if (!form) {
      return undefined;
    }
    const listener = () => latest.current();
    form.addEventListener("reset", listener);
    return () => form.removeEventListener("reset", listener);
  }, [within]);
}
