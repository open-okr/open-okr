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
