// @vitest-environment jsdom
import { ThemeProvider, TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  EMPTY_ANSWER,
  type PaletteAnswer,
  type PaletteCommand,
  type PaletteHit,
  paletteGroups,
} from "../app/search/palette-groups.ts";

/**
 * The command palette (UIUX-PLAN §3 and §4 S-32, completeness review M-21).
 *
 * **What was wrong.** The palette jumped to a KPI by its short code and to
 * nothing else, offered no actions at all, and never asked the semantic half
 * of search. This proves the three halves the browser owns: which groups a
 * phrase produces, that the keyboard alone drives them, and that the AI half
 * is absent when the provider is.
 *
 * Rendered for real in jsdom rather than read as source, because the claims
 * are about keys and focus. The server actions are replaced: what they answer
 * is proved against a database in `packages/core/test/search-palette.test.ts`,
 * and the end-to-end half is `e2e/s32-search.spec.ts`.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: () => undefined }),
}));

const paletteSearchAction = vi.fn<(text: string) => Promise<PaletteAnswer>>();
const paletteRelatedAction =
  vi.fn<(text: string) => Promise<readonly PaletteHit[]>>();
vi.mock("../app/search/actions.ts", () => ({
  paletteSearchAction: (text: string) => paletteSearchAction(text),
  paletteRelatedAction: (text: string) => paletteRelatedAction(text),
}));

const setAppearance = vi.fn(async (_input: unknown) => ({ error: null }));
vi.mock("../lib/appearance-action.ts", () => ({
  setAppearance: (input: unknown) => setAppearance(input),
}));

const { CommandPalette } = await import("../app/search/palette.tsx");

const GOAL = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";
const RELATED = "33333333-3333-4333-8333-333333333333";

const ANSWER: PaletteAnswer = {
  goTo: [
    {
      entityType: "goal",
      entityId: GOAL,
      title: "Aurora launch lands",
      href: `/goals/${GOAL}`,
    },
  ],
  hits: [
    {
      entityType: "goal",
      entityId: GOAL,
      title: "Aurora launch lands",
      href: `/goals/${GOAL}`,
      snippet: "<b>Aurora</b> launch lands",
    },
    {
      entityType: "task",
      entityId: TASK,
      title: "Pricing copy",
      href: `/tasks/${TASK}`,
      snippet: "the <b>aurora</b> pricing page",
    },
  ],
  error: null,
};

const RELATED_HIT: PaletteHit = {
  entityType: "goal",
  entityId: RELATED,
  title: "Glacier retention",
  href: `/goals/${RELATED}`,
  snippet: "Glacier retention for returning customers",
};

const COMMANDS: readonly PaletteCommand[] = [
  {
    id: "switch-theme",
    title: "Switch to the dark theme",
    hint: null,
    href: null,
  },
  { id: "page-review", title: "Review", hint: "Page", href: "/review" },
  {
    id: "page-admin-general",
    title: "General",
    hint: "Admin settings",
    href: "/admin/general",
  },
];

describe("which groups a phrase produces", () => {
  test("before anything is typed, the actions are all there is", () => {
    const groups = paletteGroups("", ANSWER, [], COMMANDS);
    expect(groups.map((group) => group.id)).toEqual(["actions"]);
    expect(groups[0]?.rows).toHaveLength(COMMANDS.length);
  });

  test("a phrase gives Go to first, then results, then matching actions", () => {
    const groups = paletteGroups("aurora", ANSWER, [], COMMANDS);
    expect(groups.map((group) => group.id)).toEqual(["goTo", "results"]);
    // The goal is under Go to, so the results do not offer it a second time.
    expect(groups[1]?.rows.map((row) => row.href)).toEqual([`/tasks/${TASK}`]);
    expect(groups[0]?.rows[0]?.kind).toBe("search.objective");
  });

  test("an action is found by its hint as well as its title", () => {
    const groups = paletteGroups("settings", EMPTY_ANSWER, [], COMMANDS);
    expect(groups.map((group) => group.id)).toEqual(["actions"]);
    expect(groups[0]?.rows.map((row) => row.title)).toEqual(["General"]);
  });

  test("with no provider there is no Related group at all", () => {
    const groups = paletteGroups("retention", ANSWER, [], COMMANDS);
    expect(groups.map((group) => group.id)).not.toContain("related");
  });

  test("with one, what full text missed is its own group", () => {
    const groups = paletteGroups(
      "retention",
      ANSWER,
      // One the words already found is dropped, because they are the
      // stronger reason to show it.
      [RELATED_HIT, { ...ANSWER.hits[1], snippet: "x" } as PaletteHit],
      COMMANDS,
    );
    const related = groups.find((group) => group.id === "related");
    expect(related?.rows.map((row) => row.href)).toEqual([`/goals/${RELATED}`]);
  });

  test("a command that runs in place carries no link", () => {
    const [actions] = paletteGroups("theme", EMPTY_ANSWER, [], COMMANDS);
    expect(actions?.rows[0]?.command).toBe("switch-theme");
    expect(actions?.rows[0]?.href).toBeNull();
  });
});

describe("the palette, driven by the keyboard alone", () => {
  let host: HTMLDivElement;
  let root: Root;

  const wait = (ms: number) =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });

  const press = async (target: EventTarget, init: KeyboardEventInit) =>
    act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ...init }),
      );
    });

  const input = () =>
    host.querySelector<HTMLInputElement>('input[role="combobox"]');

  const type = async (text: string) => {
    const field = input();
    if (!field) {
      throw new Error("The palette is not open.");
    }
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(field, text);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Past the pause the palette waits for, and the answer after it.
    await wait(250);
  };

  const activeOption = () => {
    const id = input()?.getAttribute("aria-activedescendant");
    return id ? host.ownerDocument.getElementById(id) : null;
  };

  beforeEach(async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom has no matchMedia, and the theme provider asks it which theme
    // the system prefers.
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    // The theme provider keeps its choice here, and one test changes it.
    window.localStorage.clear();
    push.mockClear();
    setAppearance.mockClear();
    paletteSearchAction.mockReset();
    paletteRelatedAction.mockReset();
    paletteSearchAction.mockResolvedValue(ANSWER);
    paletteRelatedAction.mockResolvedValue([]);

    await mount({ semantic: false });
  });

  /** Renders the palette as the shell does, and opens it with ⌘K. */
  const mount = async ({ semantic }: { semantic: boolean }) => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <TranslationsProvider locale="en">
          <ThemeProvider>
            <CommandPalette
              canCreateObjective
              semantic={semantic}
              destinations={[
                {
                  id: "review",
                  label: "Review",
                  href: "/review",
                  area: "page",
                },
                {
                  id: "admin-general",
                  label: "General",
                  href: "/admin/general",
                  area: "admin",
                },
              ]}
            />
          </ThemeProvider>
        </TranslationsProvider>,
      );
    });
    await press(window, { key: "k", ctrlKey: true });
  };

  const unmount = async () => {
    await act(async () => root.unmount());
    host.remove();
  };

  afterEach(unmount);

  test("opens with ⌘K on the input, and lists the actions before a word is typed", () => {
    expect(host.ownerDocument.activeElement).toBe(input());
    const group = host.querySelector('[data-testid="palette-group-actions"]');
    expect(group?.getAttribute("role")).toBe("group");
    const titles = [...host.querySelectorAll('[role="option"]')].map(
      (option) => option.textContent,
    );
    expect(titles.join(" | ")).toContain("New objective");
    expect(titles.join(" | ")).toContain("Switch to the dark theme");
    expect(titles.join(" | ")).toContain("General");
  });

  test("draws the groups a listbox may hold, each named by its heading", async () => {
    await type("aurora");

    const listbox = host.querySelector('[role="listbox"]');
    expect(listbox?.id).toBe("palette-listbox");
    expect(input()?.getAttribute("aria-controls")).toBe("palette-listbox");
    expect(input()?.getAttribute("aria-expanded")).toBe("true");

    // A listbox owns groups and options and nothing else, which is the rule
    // axe checks as aria-required-children.
    for (const child of listbox?.children ?? []) {
      expect(child.getAttribute("role")).toBe("group");
    }
    const headings = [...(listbox?.children ?? [])].map((group) => {
      const labelledBy = group.getAttribute("aria-labelledby") ?? "";
      return host.ownerDocument.getElementById(labelledBy)?.textContent;
    });
    expect(headings).toEqual(["Go to", "Search results", "Actions"]);
  });

  test("the arrows move the active row, and Enter opens it", async () => {
    await type("aurora");
    expect(activeOption()?.textContent).toContain("Aurora launch lands");
    expect(activeOption()?.getAttribute("aria-selected")).toBe("true");

    await press(input() as HTMLInputElement, { key: "ArrowDown" });
    expect(activeOption()?.textContent).toContain("Pricing copy");

    await press(input() as HTMLInputElement, { key: "ArrowUp" });
    await press(input() as HTMLInputElement, { key: "ArrowUp" });
    // Up from the first row wraps to the last, which is the page search.
    expect(activeOption()?.textContent).toContain(
      'Search everything for "aurora"',
    );

    await press(input() as HTMLInputElement, { key: "Home" });
    await press(input() as HTMLInputElement, { key: "Enter" });
    expect(push).toHaveBeenCalledWith(`/goals/${GOAL}`);
    expect(host.querySelector('[data-testid="palette"]')).toBeNull();
  });

  test("Tab stays in the dialog, and Escape closes it", async () => {
    await press(input() as HTMLInputElement, { key: "Tab" });
    expect(host.ownerDocument.activeElement).toBe(input());

    await press(window, { key: "Escape" });
    expect(host.querySelector('[data-testid="palette"]')).toBeNull();
  });

  test("an action runs an existing path rather than a new one", async () => {
    paletteSearchAction.mockResolvedValue(EMPTY_ANSWER);
    await type("dark");
    expect(activeOption()?.textContent).toContain("Switch to the dark theme");
    await press(input() as HTMLInputElement, { key: "Enter" });
    // The theme provider applies it and the member's own setting stores it,
    // the same two writes the avatar menu's control makes.
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(setAppearance).toHaveBeenCalledWith({ theme: "dark" });
    expect(push).not.toHaveBeenCalled();
  });

  test("with no provider, nothing is asked of it, and nothing is marked as AI", async () => {
    await type("retention");
    // The shell said there is no embedding model, or that the workspace
    // keeps retrieval here, so the Related group is not even requested.
    expect(paletteSearchAction).toHaveBeenCalledWith("retention");
    expect(paletteRelatedAction).not.toHaveBeenCalled();
    expect(
      host.querySelector('[data-testid="palette-group-related"]'),
    ).toBeNull();
    expect(host.textContent).not.toContain("Related");
  });

  test("with one, what the semantic index found is its own group", async () => {
    await unmount();
    await mount({ semantic: true });
    paletteRelatedAction.mockResolvedValue([RELATED_HIT]);
    await type("retention");
    expect(paletteRelatedAction).toHaveBeenCalledWith("retention");
    const group = host.querySelector('[data-testid="palette-group-related"]');
    expect(group?.textContent).toContain("Related");
    expect(group?.textContent).toContain("Glacier retention");
  });

  test("says so when nothing matches, and when the search fails", async () => {
    paletteSearchAction.mockResolvedValue(EMPTY_ANSWER);
    await type("zzzz");
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Nothing matches. Only what you can already open is here.",
    );
    // And the page search is still offered below it, so a phrase that
    // matched nothing still has somewhere to go.
    expect(host.textContent).toContain('Search everything for "zzzz"');

    paletteSearchAction.mockRejectedValue(new Error("offline"));
    await type("again");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "The search did not answer. Try again.",
    );
  });
});
