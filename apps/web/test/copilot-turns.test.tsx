// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { groupTurns } from "../app/copilot/turns.ts";
import {
  nearTheEnd,
  useStickToBottom,
} from "../app/copilot/use-stick-to-bottom.ts";

/**
 * Turns, order and scroll (plan 0.8.1 CP3).
 *
 * Acceptance criteria:
 *   Given a thread where the first question made a card and the second did
 *   not, when the thread is read, then the card sits in the first turn, not
 *   after the second.
 *   Given an answer arriving and the person scrolled up, when text is added,
 *   then the view does not move, and "Jump to latest" shows; pressing it
 *   scrolls to the end and hides it.
 */

const message = (
  id: string,
  role: "member" | "assistant",
  createdAt: string,
) => ({ id, role, createdAt });

describe("a conversation as turns", () => {
  const messages = [
    message("q1", "member", "2026-11-12T10:00:00.000Z"),
    message("a1", "assistant", "2026-11-12T10:00:05.000Z"),
    message("q2", "member", "2026-11-12T10:01:00.000Z"),
    message("a2", "assistant", "2026-11-12T10:01:05.000Z"),
  ];

  test("a card sits in the turn whose question made it", () => {
    const { turns, afterLast } = groupTurns(
      messages,
      [{ id: "p1", createdAt: "2026-11-12T10:00:02.000Z" }],
      false,
    );
    expect(turns.map((turn) => turn.key)).toEqual(["q1", "q2"]);
    expect(turns[0]?.answer?.id).toBe("a1");
    expect(turns[0]?.proposals.map((p) => p.id)).toEqual(["p1"]);
    expect(turns[1]?.proposals).toEqual([]);
    expect(afterLast).toEqual([]);
  });

  test("cards in one turn are in the order they were made", () => {
    const { turns } = groupTurns(
      messages,
      [
        { id: "late", createdAt: "2026-11-12T10:01:03.000Z" },
        { id: "early", createdAt: "2026-11-12T10:01:02.000Z" },
      ],
      false,
    );
    expect(turns[1]?.proposals.map((p) => p.id)).toEqual(["early", "late"]);
  });

  test("a card made after every recorded message belongs to the question in flight", () => {
    const { turns, afterLast } = groupTurns(
      messages,
      [{ id: "new", createdAt: "2026-11-12T10:02:01.000Z" }],
      true,
    );
    expect(afterLast.map((p) => p.id)).toEqual(["new"]);
    expect(turns.every((turn) => turn.proposals.length === 0)).toBe(true);
  });

  test("with nothing in flight it belongs to the last turn", () => {
    const { turns, afterLast } = groupTurns(
      messages,
      [{ id: "new", createdAt: "2026-11-12T10:02:01.000Z" }],
      false,
    );
    expect(afterLast).toEqual([]);
    expect(turns[1]?.proposals.map((p) => p.id)).toEqual(["new"]);
  });

  test("a question with no answer yet is a turn of its own", () => {
    const { turns } = groupTurns(
      [message("q1", "member", "2026-11-12T10:00:00.000Z")],
      [],
      false,
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]?.answer).toBeNull();
  });
});

describe("the end of the conversation", () => {
  test("is within reach up to 80 pixels above it", () => {
    expect(
      nearTheEnd({ scrollTop: 520, scrollHeight: 1000, clientHeight: 400 }),
    ).toBe(true);
    expect(
      nearTheEnd({ scrollTop: 519, scrollHeight: 1000, clientHeight: 400 }),
    ).toBe(false);
  });
});

/** A scroll box jsdom lays out by hand: it lays nothing out itself. */
function sized(element: HTMLElement, clientHeight: number) {
  let height = 0;
  let top = 0;
  Object.defineProperty(element, "clientHeight", { value: clientHeight });
  Object.defineProperty(element, "scrollHeight", { get: () => height });
  Object.defineProperty(element, "scrollTop", {
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, height - clientHeight));
    },
  });
  return {
    grow: (to: number) => {
      height = to;
    },
    scrollBy: (pixels: number) => {
      element.scrollTop = top + pixels;
      element.dispatchEvent(new Event("scroll"));
    },
    get top() {
      return top;
    },
  };
}

/** A ResizeObserver the test fires by hand. */
let resized: (() => void) | null = null;
class FakeResizeObserver {
  constructor(callback: () => void) {
    resized = callback;
  }
  observe() {}
  disconnect() {}
}

let host: HTMLDivElement;
let root: Root;
let away = false;
let toEnd: () => void = () => undefined;
let scrollerEl: HTMLDivElement | null = null;

function Probe() {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useStickToBottom(scroller, content, "thread-1");
  away = stick.away;
  toEnd = stick.toEnd;
  return (
    <div
      ref={(node) => {
        scroller.current = node;
        scrollerEl = node;
      }}
    >
      <div ref={content} />
    </div>
  );
}

describe("following the answer", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
      FakeResizeObserver;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });

  test("keeps the newest line in view while the reader has not scrolled", async () => {
    let box: ReturnType<typeof sized> | null = null;
    await act(async () => root.render(<Probe />));
    if (!scrollerEl) {
      throw new Error("no scroller");
    }
    box = sized(scrollerEl, 400);
    box.grow(1000);
    await act(async () => resized?.());
    expect(box.top).toBe(600);
    box.grow(1200);
    await act(async () => resized?.());
    expect(box.top).toBe(800);
    expect(away).toBe(false);
  });

  test("stays put once the reader scrolls up, and Jump to latest brings it back", async () => {
    await act(async () => root.render(<Probe />));
    if (!scrollerEl) {
      throw new Error("no scroller");
    }
    const box = sized(scrollerEl, 400);
    box.grow(1000);
    await act(async () => resized?.());
    await act(async () => box.scrollBy(-300));
    expect(box.top).toBe(300);
    expect(away).toBe(true);

    box.grow(1300);
    await act(async () => resized?.());
    // The view did not move.
    expect(box.top).toBe(300);
    expect(away).toBe(true);

    await act(async () => toEnd());
    expect(box.top).toBe(900);
    expect(away).toBe(false);
  });
});
