"use client";

/**
 * The conversation follows the answer unless the reader has scrolled away
 * from it (plan 0.8.1 CP3, review F3).
 *
 * The panel had no scroll handling at all: an opened thread started at its
 * top, and a growing answer grew below the fold, so a person asked, saw
 * nothing change, and had to go looking. Chat products stick to the bottom
 * while text arrives, stop following the moment the reader scrolls up to
 * read something, and offer a way back.
 */
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/** How far above the end still counts as reading the end, in pixels. */
const STICK_WITHIN_PX = 80;

/** The three numbers a scroll box reports. */
export interface ScrollBox {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** Whether the reader is at, or within a small reach of, the end. */
export function nearTheEnd(box: ScrollBox, within = STICK_WITHIN_PX): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= within;
}

/**
 * Keeps `scroller` at its end while the reader is there, whatever grows
 * inside `content`, and says when they are not so a way back can be offered.
 *
 * `opened` changes when the panel opens or another conversation is shown,
 * and that always starts at its end: the newest turn is what a person opens a
 * thread for. It is also when the two elements may have been replaced, so the
 * listeners are attached again.
 */
export function useStickToBottom(
  scroller: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  opened: unknown,
): {
  /** The reader has scrolled away from the end. */
  readonly away: boolean;
  /** Back to the end, following again. */
  readonly toEnd: () => void;
} {
  const following = useRef(true);
  const [away, setAway] = useState(false);

  const toEnd = useCallback(() => {
    const box = scroller.current;
    following.current = true;
    setAway(false);
    if (box) {
      box.scrollTop = box.scrollHeight;
    }
  }, [scroller]);

  // A scroll by the reader decides whether to follow. A scroll this hook
  // made lands at the end, which reads as following, so it decides nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `opened` is when the element may be a new one.
  useEffect(() => {
    const box = scroller.current;
    if (!box) {
      return;
    }
    const onScroll = () => {
      const near = nearTheEnd(box);
      following.current = near;
      setAway(!near);
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, [scroller, opened]);

  // Anything that grows the conversation, words, a card, a turn, moves the
  // end. A browser without ResizeObserver keeps the last position.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `opened` is when the element may be a new one.
  useEffect(() => {
    const inner = content.current;
    if (!inner || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      const box = scroller.current;
      if (following.current && box) {
        box.scrollTop = box.scrollHeight;
      } else if (box) {
        setAway(!nearTheEnd(box));
      }
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [content, scroller, opened]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `opened` is the trigger, not a value the effect reads.
  useEffect(() => {
    toEnd();
  }, [opened, toEnd]);

  return { away, toEnd };
}
