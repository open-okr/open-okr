/**
 * jsdom implements neither `ResizeObserver` nor `IntersectionObserver`, both
 * of which Base UI's floating-positioned primitives (Menu, Popover, and
 * Dialog's own positioning) can reach for. Without a stub, that throws a
 * plain `ReferenceError`, which is easy to mistake for something deeper
 * wrong with the component — as it briefly was, while a real bug (an
 * infinite render loop in `useKeyboardShortcut`, fixed separately) was also
 * making tests hang, and this looked like it might be a second cause.
 */
class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// biome-ignore lint/suspicious/noExplicitAny: assigning a test stub onto a global jsdom does not define.
(globalThis as any).ResizeObserver ??= ObserverStub;
// biome-ignore lint/suspicious/noExplicitAny: see above.
(globalThis as any).IntersectionObserver ??= ObserverStub;

/**
 * jsdom lays nothing out, so a `Range` has no client rects. ProseMirror asks
 * for them when a command scrolls the selection into view, which the compact
 * editor's toolbar does after each format (`focus()` then the toggle), and the
 * `TypeError` arrived after the test that pressed the button had finished,
 * failing the run with every test green.
 */
const emptyRects = (): DOMRectList =>
  Object.assign([], { item: () => null }) as unknown as DOMRectList;
const emptyRect = (): DOMRect =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  }) as DOMRect;
Range.prototype.getClientRects ??= emptyRects;
Range.prototype.getBoundingClientRect ??= emptyRect;
