// @vitest-environment jsdom
import { TranslationsProvider } from "@openokr/ui";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  afterTaskIdOf,
  placeAt,
  slotOf,
  stepTarget,
} from "../app/board/board-keys.ts";
import type { WriteState } from "../app/cycle/write-state.ts";

/**
 * The board in a browser: who else is here, and moving a card without a mouse
 * (UIUX-PLAN §3 and §9, completeness review M-02).
 *
 * **Rendered for real in jsdom**, because both claims are about what a person
 * sees and hears: the avatars and the sentence beside them, the focus that
 * follows a carried card, and the live region that says where it went. The
 * stream is a stand-in `EventSource`; what the server puts on it is proved in
 * `board-presence.test.ts`, who may be named in
 * `packages/core/test/board-scopes.test.ts`, and the whole path end to end in
 * `e2e/s27-board.spec.ts` and `e2e/s42b-ordinary-member.spec.ts`.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: () => undefined }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { Board } = await import("../app/board/board.tsx");

/** An `EventSource` the test drives by hand. */
class FakeEventSource {
  static opened: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  readonly #listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.opened.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const set = this.#listeners.get(type) ?? new Set();
    set.add(listener);
    this.#listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.#listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data = "{}") {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }
}

const SPACE = "11111111-1111-4111-8111-111111111111";
const KEY_RESULT = "22222222-2222-4222-8222-222222222222";

const card = (id: string, title: string, status: string) => ({
  id,
  title,
  status,
  dueOn: null,
  keyResultTitle: null,
  assignees: [],
  checklist: { done: 0, total: 0 },
});

const COLUMNS = [
  { status: "backlog", cards: [] },
  {
    status: "todo",
    cards: [
      card("a", "Rewrite the first-run screen", "todo"),
      card("b", "Email the dormant teams", "todo"),
    ],
  },
  {
    status: "in_progress",
    cards: [card("c", "Cut the setup form", "in_progress")],
  },
  { status: "done", cards: [] },
];

let host: HTMLDivElement;
let root: Root;
const onMove = vi.fn(
  async (_id: string, _status: string, _after: string | null) =>
    ({ error: null }) as WriteState,
);

const render = async (
  props: Partial<{
    canEdit: boolean;
    scope: { kind: "space" | "initiative" | "key_result"; id: string };
  }> = {},
) => {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <Board
          scope={props.scope ?? { kind: "space", id: SPACE }}
          columns={COLUMNS}
          canEdit={props.canEdit ?? true}
          onMove={onMove}
        />
      </TranslationsProvider>,
    );
  });
};

const stream = () => {
  const source = FakeEventSource.opened.at(-1);
  if (!source) {
    throw new Error("The board opened no stream.");
  }
  return source;
};

const presence = () => host.querySelector('[data-testid="board-presence"]');
const announcer = () =>
  host.querySelector('[data-testid="board-announcer"]')?.textContent ?? "";
const handle = (id: string) =>
  host.querySelector<HTMLButtonElement>(`[data-move-handle="${id}"]`);
const titlesIn = (column: string) =>
  [
    ...(host
      .querySelector(`section[aria-label="${column}"]`)
      ?.querySelectorAll('[data-testid="board-card"] a') ?? []),
  ].map((link) => link.textContent);

const click = async (element: HTMLElement | null) =>
  act(async () => {
    element?.click();
  });
const press = async (element: HTMLElement | null, key: string) =>
  act(async () => {
    element?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  FakeEventSource.opened = [];
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  refresh.mockClear();
  onMove.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  delete (globalThis as { EventSource?: unknown }).EventSource;
});

describe("who else has the board open", () => {
  test("draws the others, and says who they are in one sentence", async () => {
    await render();
    expect(presence()).toBeNull();

    await act(async () => {
      stream().emit(
        "presence",
        JSON.stringify({
          members: [
            { id: "m1", name: "Ada Lovelace" },
            { id: "m2", name: "Grace Hopper" },
          ],
        }),
      );
    });

    const shown = presence();
    expect(shown?.textContent).toContain(
      "Also looking at this board: Ada Lovelace and Grace Hopper",
    );
    // The faces are for the eye; the sentence is what a screen reader hears.
    expect(shown?.querySelector('[aria-hidden="true"]')?.textContent).toBe(
      "ALGH",
    );
  });

  test("shows nothing when nobody else is here", async () => {
    await render();
    await act(async () => {
      stream().emit("presence", JSON.stringify({ members: [] }));
    });
    expect(presence()).toBeNull();
  });

  test("forgets everybody when the stream drops, rather than showing who was there", async () => {
    await render();
    await act(async () => {
      stream().emit(
        "presence",
        JSON.stringify({ members: [{ id: "m1", name: "Ada Lovelace" }] }),
      );
    });
    expect(presence()).not.toBeNull();

    await act(async () => {
      stream().emit("error");
    });
    expect(presence()).toBeNull();
  });

  test("with realtime off the board still works, and shows no presence", async () => {
    delete (globalThis as { EventSource?: unknown }).EventSource;
    await render();
    expect(FakeEventSource.opened).toHaveLength(0);
    expect(presence()).toBeNull();
    expect(titlesIn("To do")).toEqual([
      "Rewrite the first-run screen",
      "Email the dormant teams",
    ]);
  });

  test("listens on the stream for this board's own scope", async () => {
    await render({ scope: { kind: "key_result", id: KEY_RESULT } });
    expect(stream().url).toBe(`/api/board/live?keyResult=${KEY_RESULT}`);
  });

  test("re-reads the board when a card moves somewhere else", async () => {
    await render();
    await act(async () => {
      stream().emit("board.changed");
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("closes the stream when the board goes", async () => {
    await render();
    const source = stream();
    await act(async () => {
      root.render(<div />);
    });
    expect(source.closed).toBe(true);
  });
});

describe("moving a card with the keyboard", () => {
  test("picks up, moves within the column, and drops with one write", async () => {
    await render();
    await click(handle("b"));
    expect(handle("b")?.getAttribute("aria-pressed")).toBe("true");
    expect(announcer()).toBe(
      "Picked up Email the dormant teams. To do, position 2 of 2.",
    );

    await press(handle("b"), "ArrowUp");
    expect(titlesIn("To do")).toEqual([
      "Email the dormant teams",
      "Rewrite the first-run screen",
    ]);
    expect(announcer()).toBe(
      "Email the dormant teams: To do, position 1 of 2.",
    );
    // Nothing is written while the card is held.
    expect(onMove).not.toHaveBeenCalled();

    await click(handle("b"));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith("b", "todo", null);
    expect(announcer()).toBe(
      "Dropped Email the dormant teams. To do, position 1 of 2.",
    );
    expect(handle("b")?.getAttribute("aria-pressed")).toBe("false");
  });

  test("carries a card across columns, and focus goes with it", async () => {
    await render();
    await click(handle("b"));
    await press(handle("b"), "ArrowRight");

    expect(titlesIn("In progress")).toEqual([
      "Cut the setup form",
      "Email the dormant teams",
    ]);
    expect(announcer()).toBe(
      "Email the dormant teams: In progress, position 2 of 2.",
    );
    // The card now sits in another list, and the handle that has focus is
    // still its own.
    expect(document.activeElement?.getAttribute("data-move-handle")).toBe("b");

    // Enter and Space press the button, which is a click.
    await click(handle("b"));
    expect(onMove).toHaveBeenCalledWith("b", "in_progress", "c");
  });

  test("puts the card back with Escape, and writes nothing", async () => {
    await render();
    await click(handle("a"));
    await press(handle("a"), "ArrowDown");
    await press(handle("a"), "ArrowLeft");
    expect(titlesIn("Backlog")).toEqual(["Rewrite the first-run screen"]);

    await press(handle("a"), "Escape");
    expect(titlesIn("To do")).toEqual([
      "Rewrite the first-run screen",
      "Email the dormant teams",
    ]);
    expect(announcer()).toBe(
      "Rewrite the first-run screen is back where it was. To do, position 1 of 2.",
    );
    expect(onMove).not.toHaveBeenCalled();
  });

  test("says so when a key has nowhere to send the card", async () => {
    await render();
    await click(handle("a"));
    await press(handle("a"), "ArrowUp");
    expect(announcer()).toBe(
      "It cannot go further that way. To do, position 1 of 2.",
    );
  });

  test("writes nothing for a card put down where it was picked up", async () => {
    await render();
    await click(handle("a"));
    await press(handle("a"), "ArrowDown");
    await press(handle("a"), "ArrowUp");
    await click(handle("a"));
    expect(onMove).not.toHaveBeenCalled();
  });

  test("leaves the arrow keys alone until a card is picked up", async () => {
    await render();
    await press(handle("a"), "ArrowDown");
    expect(titlesIn("To do")[0]).toBe("Rewrite the first-run screen");
    expect(announcer()).toBe("");
  });

  test("puts the board back and says why when the write is refused", async () => {
    onMove.mockResolvedValueOnce({
      error: "No such task, or you do not have access to it.",
    });
    await render();
    await click(handle("b"));
    await press(handle("b"), "ArrowUp");
    await click(handle("b"));

    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "No such task, or you do not have access to it.",
    );
    expect(titlesIn("To do")).toEqual([
      "Rewrite the first-run screen",
      "Email the dormant teams",
    ]);
  });

  test("tells the keyboard how, and offers no handle to a reader who cannot edit", async () => {
    await render();
    const described = handle("a")?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(described)?.textContent).toContain(
      "Press Space or Enter to pick this card up.",
    );
    expect(handle("a")?.getAttribute("aria-label")).toBe(
      "Reorder Rewrite the first-run screen",
    );

    await render({ canEdit: false });
    expect(handle("a")).toBeNull();
  });
});

describe("where a key sends a held card", () => {
  test("up and down stay in the column, and stop at its ends", () => {
    expect(stepTarget(COLUMNS, "b", "ArrowUp")).toEqual({
      status: "todo",
      index: 0,
    });
    expect(stepTarget(COLUMNS, "b", "ArrowDown")).toBeNull();
    expect(stepTarget(COLUMNS, "a", "ArrowUp")).toBeNull();
  });

  test("left and right keep the card's height, or the bottom of a shorter column", () => {
    expect(stepTarget(COLUMNS, "b", "ArrowRight")).toEqual({
      status: "in_progress",
      index: 1,
    });
    expect(stepTarget(COLUMNS, "b", "ArrowLeft")).toEqual({
      status: "backlog",
      index: 0,
    });
    expect(stepTarget(COLUMNS, "c", "ArrowRight")).toEqual({
      status: "done",
      index: 0,
    });
  });

  test("the last column has no right, and the first no left", () => {
    const board = placeAt(COLUMNS, "c", "done", 0) ?? [];
    expect(stepTarget(board, "c", "ArrowRight")).toBeNull();
    const back = placeAt(COLUMNS, "a", "backlog", 0) ?? [];
    expect(stepTarget(back, "a", "ArrowLeft")).toBeNull();
  });

  test("names the card it lands after, never a position", () => {
    const board = placeAt(COLUMNS, "a", "in_progress", 1) ?? [];
    expect(slotOf(board, "a")).toEqual({
      status: "in_progress",
      index: 1,
      count: 2,
    });
    expect(afterTaskIdOf(board, "a")).toBe("c");
    expect(afterTaskIdOf(board, "c")).toBeNull();
    expect(placeAt(COLUMNS, "gone", "todo", 0)).toBeNull();
  });
});
