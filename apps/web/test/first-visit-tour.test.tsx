// @vitest-environment jsdom
import { type Locale, TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The first-visit tour (UIUX-PLAN S-34, completeness review L-08).
 *
 * S-34: "Per user on first visit: a five-stop tour covering the Work Map, the
 * review inbox, a check-in, the cycle strip and ⌘K." Rendered for real in
 * jsdom, because the claims are about which stop is showing, what it outlines,
 * where focus goes and what is written when it ends. The write is replaced:
 * what it stores is proved against a database in
 * `packages/core/test/onboarding-and-tour.test.ts`, and the browser half is
 * `e2e/registration-to-dashboard.spec.ts`.
 */

const finishTour = vi.fn<() => Promise<{ error: string | null }>>();
vi.mock("../app/tour-actions.ts", () => ({
  finishTour: () => finishTour(),
}));

const { FirstVisitTour, TOUR_STOPS } = await import(
  "../app/first-visit-tour.tsx"
);

let host: HTMLDivElement;
let main: HTMLElement;
let root: Root;

const stopShown = () =>
  host.querySelector<HTMLElement>('[data-testid="tour-stop"]');
const button = (id: string) =>
  host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
const progress = () =>
  host.querySelector('[data-testid="tour-progress"]')?.textContent ?? "";
const outlined = () => document.documentElement.getAttribute("data-tour-stop");

const click = async (id: string) => {
  const target = button(id);
  if (!target) {
    throw new Error(`No ${id} button is on screen.`);
  }
  await act(async () => {
    target.click();
  });
};

async function mount(locale: Locale = "en") {
  await act(async () => {
    root.render(
      <TranslationsProvider locale={locale}>
        <FirstVisitTour />
      </TranslationsProvider>,
    );
  });
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // Where the shell's skip link lands, and where focus goes when the card
  // that held it is gone.
  main = document.createElement("main");
  main.id = "main-content";
  main.tabIndex = -1;
  host = document.createElement("div");
  main.append(host);
  document.body.append(main);
  root = createRoot(host);
  finishTour.mockReset();
  finishTour.mockResolvedValue({ error: null });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  main.remove();
});

describe("the five stops", () => {
  test("are S-34's, in S-34's order", () => {
    expect(TOUR_STOPS.map((stop) => stop.id)).toEqual([
      "work-map",
      "review",
      "check-in",
      "cycle-strip",
      "search",
    ]);
  });

  test("are walked with Next, each outlined as it shows, and Done ends it", async () => {
    await mount();
    expect(progress()).toContain("1 / 5");
    expect(button("tour-back")?.disabled).toBe(true);

    for (const [index, stop] of TOUR_STOPS.entries()) {
      expect(stopShown()?.dataset.stop).toBe(stop.id);
      expect(outlined()).toBe(stop.id);
      expect(progress()).toContain(`${index + 1} / ${TOUR_STOPS.length}`);
      if (index < TOUR_STOPS.length - 1) {
        await click("tour-next");
      }
    }

    // The last stop says Done, and there is no second button doing the same.
    expect(button("tour-next")?.textContent).toBe("Done");
    expect(button("tour-end")).toBeNull();
    expect(finishTour).not.toHaveBeenCalled();

    await click("tour-next");
    expect(finishTour).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="first-visit-tour"]')).toBeNull();
    // No outline left behind, and focus on the content rather than lost.
    expect(outlined()).toBeNull();
    expect(document.activeElement).toBe(main);
  });

  test("Back returns a stop, and gives focus to Next when it cannot go further", async () => {
    await mount();
    await click("tour-next");
    expect(outlined()).toBe("review");
    button("tour-back")?.focus();
    await click("tour-back");
    expect(outlined()).toBe("work-map");
    expect(button("tour-back")?.disabled).toBe(true);
    expect(document.activeElement).toBe(button("tour-next"));
  });

  test("the text of every stop is in both languages", async () => {
    for (const locale of ["en", "ms"] as const) {
      await mount(locale);
      const seen = new Set<string>();
      for (const _stop of TOUR_STOPS) {
        const text = stopShown()?.textContent ?? "";
        // A missing value would render the hole's own name.
        expect(text, locale).not.toMatch(/\{[A-Za-z]+\}/);
        seen.add(text);
        if (button("tour-end")) {
          await click("tour-next");
        }
      }
      expect(seen.size, locale).toBe(TOUR_STOPS.length);
      await act(async () => {
        root.unmount();
      });
      root = createRoot(host);
    }
  });
});

describe("ending it", () => {
  test("End the tour is the same write, from any stop", async () => {
    await mount();
    await click("tour-next");
    await click("tour-end");
    expect(finishTour).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="first-visit-tour"]')).toBeNull();
    expect(outlined()).toBeNull();
  });

  test("a refusal is said, and the tour stays", async () => {
    finishTour.mockResolvedValue({ error: "This workspace is frozen." });
    await mount();
    await click("tour-end");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "This workspace is frozen.",
    );
    expect(
      host.querySelector('[data-testid="first-visit-tour"]'),
    ).not.toBeNull();
    expect(outlined()).toBe("work-map");
  });
});

describe("its shape", () => {
  test("is a region named by its own heading, with no heading per stop", async () => {
    await mount();
    const section = host.querySelector("section");
    const labelledBy = section?.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(labelledBy)?.textContent).toBe(
      "Finding your way around",
    );
    // One heading for the card. A heading per stop would compete with the
    // Work Map's own for "Work map".
    expect(section?.querySelectorAll("h1, h2, h3, h4")).toHaveLength(1);
    // The stop is announced when it changes, since focus stays on the button.
    expect(stopShown()?.getAttribute("aria-live")).toBe("polite");
  });
});
