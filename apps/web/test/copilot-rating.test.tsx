// @vitest-environment jsdom
import { TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The thumbs under a recorded answer (plan 0.9.0 FB1, copilot-feedback.md §4).
 *
 * Acceptance criteria:
 *   Given a recorded answer, when the member presses "Poor answer", then the
 *   rating is saved, the button is pressed and a note form asks what went
 *   wrong, with sharing unticked.
 *   Given the form, when they write a note, tick Share and press Send, then
 *   the write carries the note and the share.
 *   Given the form, when they press Escape, then it closes and the rating
 *   stays.
 *   Given a pressed thumb, when it is pressed again, then the rating is
 *   removed.
 *   Given a rating from a reload, then its thumb is drawn pressed.
 *   Given no `rate` for the turn, as while AI is off or an answer is still
 *   arriving, then no thumb is drawn.
 */

const actions = vi.hoisted(() => ({
  rateCopilotAnswerAction: vi.fn(
    async (): Promise<{ error: string | null }> => ({ error: null }),
  ),
  unrateCopilotAnswerAction: vi.fn(
    async (): Promise<{ error: string | null }> => ({ error: null }),
  ),
}));
vi.mock("../app/copilot/actions", () => actions);
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
}));

const { AssistantTurn } = await import("../app/copilot/turn");

const MESSAGE = "00000000-0000-4000-8000-0000000000a1";

let host: HTMLDivElement;
let root: Root;

const show = async (rate: Parameters<typeof AssistantTurn>[0]["rate"]) => {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <AssistantTurn
          text="Two goals are off track."
          arriving={false}
          steps={null}
          haltedReason={null}
          stopped={false}
          citations={[]}
          kept={null}
          cards={null}
          copyText="Two goals are off track."
          rate={rate}
        />
      </TranslationsProvider>,
    );
  });
};

const button = (name: string): HTMLButtonElement => {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (element) =>
      element.getAttribute("aria-label") === name ||
      element.textContent?.trim() === name,
  );
  if (!found) {
    throw new Error(`nothing named ${name}`);
  }
  return found;
};

const press = async (name: string) => {
  await act(async () => button(name).click());
};

beforeEach(() => {
  actions.rateCopilotAnswerAction.mockClear();
  actions.unrateCopilotAnswerAction.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("the thumbs under an answer", () => {
  test("a thumbs-down saves, shows as pressed and asks what went wrong", async () => {
    await show({ messageId: MESSAGE, initial: null });
    await press("Poor answer");

    expect(actions.rateCopilotAnswerAction).toHaveBeenCalledWith({
      messageId: MESSAGE,
      rating: "down",
    });
    expect(button("Poor answer").getAttribute("aria-pressed")).toBe("true");
    expect(button("Good answer").getAttribute("aria-pressed")).toBe("false");
    const form = document.querySelector('[data-testid="copilot-rating-note"]');
    expect(form).not.toBeNull();
    const share = form?.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(share?.checked).toBe(false);
  });

  test("Send writes the note and the share", async () => {
    await show({ messageId: MESSAGE, initial: null });
    await press("Poor answer");
    actions.rateCopilotAnswerAction.mockClear();

    const form = document.querySelector<HTMLFormElement>(
      '[data-testid="copilot-rating-note"]',
    );
    const input = form?.querySelector<HTMLInputElement>('input[name="note"]');
    const share = form?.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "It missed the blockers");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => share?.click());
    await press("Send");

    expect(actions.rateCopilotAnswerAction).toHaveBeenCalledWith({
      messageId: MESSAGE,
      rating: "down",
      note: "It missed the blockers",
      shared: true,
    });
    expect(
      document.querySelector('[data-testid="copilot-rating-note"]'),
    ).toBeNull();
  });

  test("Escape closes the form and the rating stays", async () => {
    await show({ messageId: MESSAGE, initial: null });
    await press("Poor answer");
    const input =
      document.querySelector<HTMLInputElement>('input[name="note"]');
    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(
      document.querySelector('[data-testid="copilot-rating-note"]'),
    ).toBeNull();
    expect(button("Poor answer").getAttribute("aria-pressed")).toBe("true");
    expect(actions.unrateCopilotAnswerAction).not.toHaveBeenCalled();
  });

  test("pressing the pressed thumb removes the rating", async () => {
    await show({
      messageId: MESSAGE,
      initial: { rating: "up", note: null, shared: false },
    });
    expect(button("Good answer").getAttribute("aria-pressed")).toBe("true");
    await press("Good answer");
    expect(actions.unrateCopilotAnswerAction).toHaveBeenCalledWith(MESSAGE);
    expect(button("Good answer").getAttribute("aria-pressed")).toBe("false");
  });

  test("a thumbs-up does not ask for a note", async () => {
    await show({ messageId: MESSAGE, initial: null });
    await press("Good answer");
    expect(actions.rateCopilotAnswerAction).toHaveBeenCalledWith({
      messageId: MESSAGE,
      rating: "up",
    });
    expect(
      document.querySelector('[data-testid="copilot-rating-note"]'),
    ).toBeNull();
  });

  test("says a refusal where the press was and leaves the thumb as it was", async () => {
    actions.rateCopilotAnswerAction.mockResolvedValueOnce({
      error: "You cannot rate this answer.",
    });
    await show({ messageId: MESSAGE, initial: null });
    await press("Good answer");
    expect(document.body.textContent).toContain("You cannot rate this answer.");
    expect(button("Good answer").getAttribute("aria-pressed")).toBe("false");
  });

  test("draws no thumb when the turn offers none", async () => {
    await show(null);
    expect(document.querySelector('[aria-label="Poor answer"]')).toBeNull();
    expect(document.querySelector('[aria-label="Good answer"]')).toBeNull();
  });
});
