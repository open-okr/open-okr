// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  KeyboardRegistryProvider,
  ShortcutOverlay,
  TranslationsProvider,
} from "@openokr/ui";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The keyboard shortcuts UIUX-PLAN §4 names in its Keyboard row (plan 0.7.0,
 * U2): `/` search, `c` create, `[` and `]` on a detail screen, `j`, `k` and
 * `x` on a list, each listed in the `?` overlay where it works.
 *
 * How each key behaves on its own is proved in `packages/ui`
 * (`test/keyboard.test.tsx`). What is proved here is that the screens are
 * wired to it: the topbar's search, `+ New`, the initiative page's
 * neighbours and the proposal queue.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: () => undefined }),
  usePathname: () => "/initiatives",
}));

const applyProposalsAction = vi.fn();
const dismissProposalsAction = vi.fn();
vi.mock("../app/admin/agents/actions", () => ({
  applyProposalsAction: (ids: string[]) => applyProposalsAction(ids),
  dismissProposalsAction: (ids: string[]) => dismissProposalsAction(ids),
}));

const { TopbarSearchField } = await import("../lib/topbar-search.tsx");
const { NewMenu } = await import("../lib/new-menu.tsx");
const { PreviousNext } = await import("../lib/previous-next.tsx");
const { ProposalQueue } = await import(
  "../app/admin/agents/proposal-queue.tsx"
);

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  push.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function draw(node: ReactNode) {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <KeyboardRegistryProvider>
          {node}
          <ShortcutOverlay />
        </KeyboardRegistryProvider>
      </TranslationsProvider>,
    );
  });
}

/** One key, the way a browser sends it, from whatever has the focus. */
async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
  });
}

/** What the `?` overlay lists, as its text. */
async function overlay(): Promise<string> {
  await press("?", { shiftKey: true });
  return document.querySelector('[role="dialog"]')?.textContent ?? "";
}

describe("/ goes to the search box", () => {
  test("puts the caret in the topbar's search, which sends what is typed to the search page", async () => {
    await draw(<TopbarSearchField />);
    await press("/");
    const field = document.activeElement as HTMLInputElement;
    expect(field.type).toBe("search");
    expect(field.name).toBe("q");
    expect(field.form?.getAttribute("action")).toBe("/search");
  });

  test("is listed in the overlay", async () => {
    await draw(<TopbarSearchField />);
    expect(await overlay()).toContain("Go to the search box");
  });
});

describe("c opens + New", () => {
  const items = [
    {
      key: "initiative",
      label: "Initiative",
      icon: null,
      href: "/initiatives#title",
      screens: ["/initiatives"],
    },
    {
      key: "task",
      label: "Task",
      icon: null,
      href: "/board#title",
      screens: ["/board"],
    },
  ];

  test("opens the menu of what the reader may create", async () => {
    await draw(<NewMenu items={items} />);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await press("c");
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      "Initiative",
    );
  });

  test("is listed in the overlay", async () => {
    await draw(<NewMenu items={items} />);
    expect(await overlay()).toContain("Create something new");
  });
});

describe("[ and ] on a detail screen", () => {
  const previous = { href: "/initiatives/a", label: "Previous initiative" };
  const next = { href: "/initiatives/c", label: "Next initiative" };

  test("go to the one before and the one after, which are links as well", async () => {
    await draw(<PreviousNext previous={previous} next={next} />);
    const links = [...container.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    );
    expect(links).toEqual(["/initiatives/a", "/initiatives/c"]);
    await press("]");
    expect(push).toHaveBeenLastCalledWith("/initiatives/c");
    await press("[");
    expect(push).toHaveBeenLastCalledWith("/initiatives/a");
  });

  test("offer no key, and no link, where there is no neighbour", async () => {
    await draw(<PreviousNext previous={null} next={next} />);
    expect(container.querySelectorAll("a")).toHaveLength(1);
    await press("[");
    expect(push).not.toHaveBeenCalled();
    const listed = await overlay();
    expect(listed).toContain("Next initiative");
    expect(listed).not.toContain("Previous initiative");
  });
});

describe("the proposal queue, a list whose rows can be chosen", () => {
  const proposals = ["one", "two"].map((id) => ({
    id,
    runId: null,
    action: `goals.${id}`,
    payload: {},
    subjectType: null,
    subjectId: null,
  }));

  test("j moves down the proposals and x chooses the one with the focus", async () => {
    await draw(<ProposalQueue proposals={proposals} />);
    await press("j");
    await press("j");
    await press("x");
    const boxes = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    expect(boxes.map((box) => box.checked)).toEqual([false, true]);
  });

  test("lists j, k and x in the overlay, and no e, because a proposal is not edited here", async () => {
    await draw(<ProposalQueue proposals={proposals} />);
    const listed = await overlay();
    expect(listed).toContain("Move to the next row");
    expect(listed).toContain("Choose the row");
    expect(listed).not.toContain("Edit the row");
  });
});

/**
 * The initiatives list and its page are server components that read the
 * database, so they cannot be drawn here. What can be checked is that they
 * are wired: the list's rows and edit control are marked for `KeyboardList`,
 * and the page puts its neighbours in `PreviousNext`. The keys themselves
 * are proved above and in `packages/ui`.
 */
describe("the initiatives list and page are wired", () => {
  const source = (path: string) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  test("the list marks its rows and its status control", () => {
    const list = source("../app/initiatives/page.tsx");
    expect(list).toContain("<KeyboardList edit={canEdit}>");
    expect(list).toContain("data-keyboard-row");
    expect(list).toContain("data-keyboard-edit");
  });

  test("the page offers the initiatives before and after it", () => {
    const page = source("../app/initiatives/[id]/page.tsx");
    expect(page).toContain("<PreviousNext");
  });
});
