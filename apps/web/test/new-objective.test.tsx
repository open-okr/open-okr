// @vitest-environment jsdom
import { TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Starting an objective from the top of the screen (S-13).
 *
 * Two defects the field review found, both invisible to an end-to-end spec
 * that fills a field in one event: a keystroke in the "why now" field sent
 * focus back to the title, and the topbar's `+ New` did nothing when the
 * reader was already on the screen.
 */

vi.mock("../app/goals/editor-actions.ts", () => ({
  addObjective: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const { NewObjectiveButton } = await import("../app/goals/new-objective.tsx");

let root: Root;
let container: HTMLDivElement;

async function render(props: { initiallyOpen?: boolean }) {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <NewObjectiveButton
          cycleId="c"
          level="team"
          refusal={null}
          kinds={["aspirational"]}
          defaultKind="aspirational"
          askReason="required"
          {...props}
        />
      </TranslationsProvider>,
    );
  });
}

const inputs = () =>
  [...container.querySelectorAll<HTMLInputElement>("input")].filter(
    (input) => input.type !== "hidden",
  );

/** One keystroke's worth of change, the way React hears it. */
async function keystroke(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("the new objective field", () => {
  test("keeps the caret in the reason while it is typed", async () => {
    await render({ initiallyOpen: true });
    const [title, reason] = inputs();
    expect(document.activeElement).toBe(title);
    await keystroke(title as HTMLInputElement, "Make renewals boring");
    await act(async () => {
      reason?.focus();
    });
    for (const value of ["B", "Be", "Bec", "Because"]) {
      await keystroke(reason as HTMLInputElement, value);
      expect(document.activeElement).toBe(reason);
    }
    expect((title as HTMLInputElement).value).toBe("Make renewals boring");
  });

  test("opens when the topbar's + New arrives on a screen already showing it", async () => {
    await render({ initiallyOpen: false });
    expect(inputs()).toHaveLength(0);
    await render({ initiallyOpen: true });
    expect(inputs().length).toBeGreaterThan(0);
  });
});
