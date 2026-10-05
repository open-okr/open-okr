// @vitest-environment jsdom
import { TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * S-14's key result controls (P9-T08b): the value and the confidence, and
 * the "+ Add key result" row.
 *
 * **A changed confidence is a check-in**, because METHOD.md §3.2 puts it
 * there, so the claims here are about what the page asks before it sends
 * one: the line, and the status, carried forward from the last check-in.
 * The server actions are stubbed; what publishing does is proved in
 * `packages/core`, and the page end to end in `e2e/s13d-okr-drawer.spec.ts`.
 */

const updateKeyResult = vi.fn();
const addKeyResult = vi.fn();
const refresh = vi.fn();
vi.mock("../app/goals/[id]/actions.ts", () => ({
  updateKeyResult: (...args: unknown[]) => updateKeyResult(...args),
}));
vi.mock("../app/goals/editor-actions.ts", () => ({
  addKeyResult: (...args: unknown[]) => addKeyResult(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: () => undefined }),
}));

const { AddKeyResult, KeyResultUpdate } = await import(
  "../app/goals/[id]/key-result-update.tsx"
);

const KR = "Activation from 30% to 45%";

let root: Root;
let container: HTMLDivElement;

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">{node}</TranslationsProvider>,
    );
  });
}

const field = <T extends HTMLElement = HTMLInputElement>(label: string) =>
  container.querySelector<T>(`[aria-label="${label}"]`);

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function save() {
  await act(async () => {
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => new Promise((done) => setTimeout(done)));
}

const update = (lastStatus: "on_track" | "caution" | "off_track" | null) => (
  <KeyResultUpdate
    goalId="g"
    keyResult={{ id: "k", title: KR, currentValue: 33, confidence: 0.6 }}
    lastStatus={lastStatus}
  />
);

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  updateKeyResult.mockReset();
  updateKeyResult.mockResolvedValue({ error: null });
  addKeyResult.mockReset();
  addKeyResult.mockResolvedValue({ error: null, id: "new" });
  refresh.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("a key result's value and confidence", () => {
  test("a value alone is recorded, with no check-in asked for", async () => {
    await render(update("on_track"));
    await type(field(`New value for ${KR}`) as HTMLInputElement, "40");
    expect(
      container.querySelector('[data-testid="confidence-check-in"]'),
    ).toBeNull();
    await save();
    expect(updateKeyResult).toHaveBeenCalledWith({
      goalId: "g",
      keyResultId: "k",
      value: 40,
    });
    expect(refresh).toHaveBeenCalled();
  });

  test("nothing changed sends nothing", async () => {
    await render(update("on_track"));
    await save();
    expect(updateKeyResult).not.toHaveBeenCalled();
  });

  test("a changed confidence asks for its line, starts at the last status, and is sent as one", async () => {
    await render(update("caution"));
    await type(field(`Confidence for ${KR}`) as HTMLInputElement, "4");
    const status = field<HTMLSelectElement>(`Status for the check-in on ${KR}`);
    expect(status?.value).toBe("caution");
    await type(
      field(`Why the confidence in ${KR} moved`) as HTMLInputElement,
      "The partner channel closed in week three",
    );
    await save();
    expect(updateKeyResult).toHaveBeenCalledWith({
      goalId: "g",
      keyResultId: "k",
      confidence: 0.4,
      status: "caution",
      note: "The partner channel closed in week three",
    });
  });

  test("with no check-in yet the status starts unchosen, and the server's refusal is shown", async () => {
    updateKeyResult.mockResolvedValue({
      error:
        "Choose a status. A changed confidence is published as a check-in, and a check-in carries one.",
    });
    await render(update(null));
    await type(field(`Confidence for ${KR}`) as HTMLInputElement, "8");
    expect(
      field<HTMLSelectElement>(`Status for the check-in on ${KR}`)?.value,
    ).toBe("");
    await save();
    expect(updateKeyResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: null, confidence: 0.8 }),
    );
    expect(container.textContent).toContain("Choose a status.");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("+ Add key result", () => {
  const open = async () => {
    const button = [...container.querySelectorAll("button")].find((entry) =>
      entry.textContent?.includes("Add key result"),
    );
    await act(async () => button?.click());
    return field("Add key result") as HTMLInputElement;
  };

  const press = async (input: HTMLInputElement, key: string) => {
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
    await act(async () => new Promise((done) => setTimeout(done)));
  };

  test("writes nothing until Enter, then adds it owned by the champion and due at the cycle's end", async () => {
    await render(<AddKeyResult goalId="g" ownerId="m" dueOn="2027-03-31" />);
    const input = await open();
    await type(input, "Teams inviting a second member from 20% to 45%");
    expect(addKeyResult).not.toHaveBeenCalled();
    await press(input, "Enter");
    expect(addKeyResult).toHaveBeenCalledWith({
      goalId: "g",
      title: "Teams inviting a second member from 20% to 45%",
      ownerId: "m",
      dueOn: "2027-03-31",
    });
    expect(refresh).toHaveBeenCalled();
  });

  test("Escape leaves nothing behind", async () => {
    await render(<AddKeyResult goalId="g" ownerId="m" dueOn={null} />);
    const input = await open();
    await type(input, "Half a thought");
    await press(input, "Escape");
    expect(field("Add key result")).toBeNull();
    expect(addKeyResult).not.toHaveBeenCalled();
  });

  test("a refusal keeps what was typed beside the reason", async () => {
    addKeyResult.mockResolvedValue({
      error: "This workspace refuses that.",
      id: null,
    });
    await render(<AddKeyResult goalId="g" ownerId="m" dueOn={null} />);
    const input = await open();
    await type(input, "Weekly active teams from 40 to 70");
    await press(input, "Enter");
    expect(container.textContent).toContain("This workspace refuses that.");
    expect((field("Add key result") as HTMLInputElement).value).toBe(
      "Weekly active teams from 40 to 70",
    );
  });
});
