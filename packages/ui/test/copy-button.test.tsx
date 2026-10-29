import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "../src/components/copy-button.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * A button that puts text on the clipboard
 * (docs/design/agent-setup-prompt.md §5). The refused path is real: an
 * instance served over plain HTTP on a LAN address has no clipboard at all.
 */

function inEnglish(children: ReactNode) {
  return render(
    <TranslationsProvider locale="en">{children}</TranslationsProvider>,
  );
}

/** Click, then let the clipboard promise settle. */
async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
});

describe("a copy button", () => {
  it("copies its text and says so, then goes back to its label", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn(async () => {});
    stubClipboard(writeText);
    inEnglish(<CopyButton text="the prompt">Copy setup prompt</CopyButton>);

    await press("Copy setup prompt");

    expect(writeText).toHaveBeenCalledWith("the prompt");
    expect(screen.getByRole("status").textContent).toBe("Copied");

    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("shows the text for copying by hand when the clipboard refuses", async () => {
    stubClipboard(async () => {
      throw new Error("NotAllowedError");
    });
    inEnglish(<CopyButton text="the prompt">Copy setup prompt</CopyButton>);

    await press("Copy setup prompt");

    expect(screen.getByRole("alert").textContent).toContain("Copy failed");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "the prompt",
    );
  });

  it("treats a missing clipboard as refused", async () => {
    inEnglish(<CopyButton text="the prompt">Copy setup prompt</CopyButton>);

    await press("Copy setup prompt");

    expect(screen.getByRole("alert")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "the prompt",
    );
  });
});
