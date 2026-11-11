// @vitest-environment jsdom
import { TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Plan 0.8.0 T1: a Start tour or Skip tour dialog on a first sign-in, then one
// step at a time with the step's area lit, ending with Start drafting OKRs.

const actions = vi.hoisted(() => ({
  finishTour: vi.fn(async () => ({ error: null })),
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("../app/tour-actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { ENDED_KEY, ProductTour, startTourAgain } = await import(
  "../lib/product-tour"
);

let host: HTMLDivElement;
let root: Root;
let shell: HTMLDivElement;

/** The shell's pieces the steps point at, with a size jsdom will not give. */
const drawShell = (withAsk: boolean) => {
  shell = document.createElement("div");
  shell.innerHTML = `
    <nav>
      <a href="/">Home</a>
      <a href="/review">Updates</a>
      <a href="/goals">Goals</a>
    </nav>
    <header class="topbar-shell"><label><input type="search" /></label></header>
    ${withAsk ? '<span data-tour-target="ask-ai">Ask AI</span>' : ""}
  `;
  document.body.appendChild(shell);
  for (const element of shell.querySelectorAll<HTMLElement>("a, label, span")) {
    element.getBoundingClientRect = () =>
      ({
        top: 10,
        left: 10,
        width: 80,
        height: 20,
        right: 90,
        bottom: 30,
      }) as DOMRect;
    element.scrollIntoView = () => {};
  }
};

const render = async (
  props: Partial<Parameters<typeof ProductTour>[0]> = {},
) => {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <ProductTour
          offered
          demo={false}
          canDraft
          askAvailable
          instanceName="OKRGoal"
          {...props}
        />
      </TranslationsProvider>,
    );
  });
};

const press = async (testId: string) => {
  const button = host.querySelector<HTMLButtonElement>(
    `[data-testid="${testId}"]`,
  );
  if (!button) {
    throw new Error(`no ${testId}`);
  }
  await act(async () => button.click());
};

const key = async (name: string) => {
  const dialog = host.querySelector('[role="dialog"]');
  await act(async () => {
    dialog?.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true }),
    );
  });
};

const stepId = () =>
  host.querySelector("[data-step]")?.getAttribute("data-step");

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  window.localStorage.clear();
  drawShell(true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  shell.remove();
});

describe("the welcome", () => {
  test("is offered to a member who has not finished the tour", async () => {
    await render();
    expect(
      host.querySelector('[data-testid="tour-welcome"]')?.textContent,
    ).toContain("Welcome to OKRGoal");
  });

  test("is not offered once the member finished it, or this browser ended it", async () => {
    await render({ offered: false });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(host);
    window.localStorage.setItem(ENDED_KEY, "1");
    await render();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  test("Skip ends the tour for good, on the member and in the browser", async () => {
    await render();
    await press("tour-skip");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(actions.finishTour).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(ENDED_KEY)).toBe("1");
  });

  test("Escape is the same as Skip", async () => {
    await render();
    await key("Escape");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(actions.finishTour).toHaveBeenCalledTimes(1);
  });
});

describe("the steps", () => {
  test("go one at a time, numbered, leaving out what is not on screen", async () => {
    await render();
    await press("tour-start");
    // No cycle strip on screen, so five of the six.
    expect(stepId()).toBe("home");
    expect(host.querySelector('[data-testid="tour-count"]')?.textContent).toBe(
      "1 of 5",
    );
    expect(host.querySelector('[data-testid="tour-light"]')).not.toBeNull();
    for (const id of ["review", "goals", "search", "ask"]) {
      await press("tour-next");
      expect(stepId()).toBe(id);
    }
  });

  test("the arrow keys go forward and back", async () => {
    await render();
    await press("tour-start");
    await key("ArrowRight");
    expect(stepId()).toBe("review");
    await key("ArrowLeft");
    expect(stepId()).toBe("home");
  });

  test("leave out Ask AI when the copilot cannot answer", async () => {
    await render({ askAvailable: false });
    await press("tour-start");
    expect(host.querySelector('[data-testid="tour-count"]')?.textContent).toBe(
      "1 of 4",
    );
  });

  test("end with Start drafting OKRs, which opens the cycle page", async () => {
    await render();
    await press("tour-start");
    for (let step = 0; step < 4; step += 1) {
      await press("tour-next");
    }
    const last = host.querySelector('[data-testid="tour-next"]');
    expect(last?.textContent).toBe("Start drafting OKRs");
    await press("tour-next");
    expect(router.push).toHaveBeenCalledWith("/cycle");
    expect(actions.finishTour).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  test("end with Finish for somebody who cannot draft, and stay put", async () => {
    await render({ canDraft: false });
    await press("tour-start");
    for (let step = 0; step < 4; step += 1) {
      await press("tour-next");
    }
    expect(host.querySelector('[data-testid="tour-next"]')?.textContent).toBe(
      "Finish",
    );
    await press("tour-next");
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("on a demo and when taken again", () => {
  test("a demo remembers in the browser and writes nothing to the shared member", async () => {
    await render({ demo: true, offered: false });
    expect(host.querySelector('[data-testid="tour-welcome"]')).not.toBeNull();
    await press("tour-skip");
    expect(actions.finishTour).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(ENDED_KEY)).toBe("1");
  });

  test("Take the tour again starts at the first step", async () => {
    await render({ offered: false });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => startTourAgain());
    expect(stepId()).toBe("home");
  });
});

// UAT 0.8.0 F-02: on a phone the steps light the bottom bar, and the card was
// drawn below it, off the screen, with everything else dimmed.
describe("where the card sits", () => {
  test("above an area in the lower half of the screen", async () => {
    for (const link of shell.querySelectorAll<HTMLElement>("nav a")) {
      link.getBoundingClientRect = () =>
        ({
          top: window.innerHeight - 50,
          left: 0,
          width: 80,
          height: 40,
          right: 80,
          bottom: window.innerHeight - 10,
        }) as DOMRect;
    }
    await render();
    await press("tour-start");
    const card = host.querySelector<HTMLElement>('[data-testid="tour-card"]');
    expect(card?.style.top).toBe("");
    expect(Number.parseFloat(card?.style.bottom ?? "")).toBeGreaterThan(0);
  });

  test("below an area in the upper half, as before", async () => {
    await render();
    await press("tour-start");
    const card = host.querySelector<HTMLElement>('[data-testid="tour-card"]');
    expect(card?.style.bottom).toBe("");
    expect(Number.parseFloat(card?.style.top ?? "")).toBeGreaterThan(0);
  });
});
