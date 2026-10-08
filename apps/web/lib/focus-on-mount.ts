/**
 * A ref that puts the caret in an element once, when it appears.
 *
 * Defined once, outside any component, so React sees the same function on
 * every render and calls it only when the element mounts. Written inline as
 * `ref={(node) => node?.focus()}`, it is a new function each render, React
 * calls it again on every one, and focus jumps back here on each keystroke
 * typed into any other field the same component renders.
 *
 * Used rather than `autoFocus`, which also steals focus when a page loads
 * with the element already open.
 */
export function focusOnMount(node: HTMLElement | null): void {
  node?.focus();
}
