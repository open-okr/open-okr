import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { type CodeCharacters, CodeInput } from "../src/fields/code-input.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * The one-time code field (docs/design/guided-inputs.md §4.5): one cell per
 * character, drawn over one real input, so a password manager, a phone's
 * one-time-code autofill and a screen reader each see a single field.
 */

function Harness({
  groups,
  characters,
  onComplete,
  busy,
  autoComplete,
}: {
  readonly groups: readonly number[];
  readonly characters: CodeCharacters;
  readonly onComplete?: (value: string) => void;
  readonly busy?: boolean;
  readonly autoComplete?: string;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <TranslationsProvider locale="en">
      <CodeInput
        label="Code"
        groups={groups}
        characters={characters}
        value={value}
        onChange={setValue}
        onComplete={onComplete}
        busy={busy}
        error={error}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={() => {
          setValue("");
          setError("That code was not right.");
        }}
      >
        Refuse
      </button>
    </TranslationsProvider>
  );
}

const field = () => screen.getByLabelText("Code") as HTMLInputElement;

describe("a six-digit code", () => {
  it("is one field, drawn as six cells", () => {
    const { container } = render(<Harness groups={[6]} characters="digits" />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(container.querySelectorAll("[data-code-cell]")).toHaveLength(6);
    expect(field().getAttribute("inputmode")).toBe("numeric");
  });

  it("takes digits only, and fills the cells in order", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness groups={[6]} characters="digits" />);

    await user.type(field(), "1a2 3");
    expect(field().value).toBe("123");
    const cells = [...container.querySelectorAll("[data-code-cell]")].map(
      (cell) => cell.textContent,
    );
    expect(cells).toEqual(["1", "2", "3", "", "", ""]);
  });

  it("submits once, when the last cell is filled", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <Harness groups={[6]} characters="digits" onComplete={onComplete} />,
    );

    await user.type(field(), "12345");
    expect(onComplete).not.toHaveBeenCalled();
    await user.type(field(), "6");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456");

    // A seventh keystroke has nowhere to go, and is not a second submission.
    await user.type(field(), "7");
    expect(field().value).toBe("123456");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("fills every cell from one paste, spaces and all", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <Harness groups={[6]} characters="digits" onComplete={onComplete} />,
    );

    await user.click(field());
    await user.paste("123 456");
    expect(field().value).toBe("123456");
    expect(onComplete).toHaveBeenCalledExactlyOnceWith("123456");
  });

  it("clears, takes focus back and says why when a code is refused", async () => {
    const user = userEvent.setup();
    render(<Harness groups={[6]} characters="digits" />);
    await user.type(field(), "123");

    await user.click(screen.getByRole("button", { name: "Refuse" }));

    expect(field().value).toBe("");
    expect(screen.getByRole("alert").textContent).toBe(
      "That code was not right.",
    );
    expect(document.activeElement).toBe(field());
  });

  it("is read-only while the code is checked", () => {
    render(<Harness groups={[6]} characters="digits" busy />);
    expect(field().readOnly).toBe(true);
  });

  it("offers the phone's one-time-code autofill where asked", () => {
    render(
      <Harness groups={[6]} characters="digits" autoComplete="one-time-code" />,
    );
    expect(field().getAttribute("autocomplete")).toBe("one-time-code");
  });
});

describe("a backup code", () => {
  it("is two groups of five, keeps case, and takes a paste with its hyphen", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const { container } = render(
      <Harness
        groups={[5, 5]}
        characters="letters-and-digits"
        onComplete={onComplete}
      />,
    );
    expect(container.querySelectorAll("[data-code-group]")).toHaveLength(2);

    await user.click(field());
    await user.paste("abcDE-12345");
    expect(field().value).toBe("abcDE12345");
    expect(onComplete).toHaveBeenCalledExactlyOnceWith("abcDE12345");
  });
});

describe("a terminal login code", () => {
  it("upper-cases as typed and drops what the alphabet leaves out", async () => {
    const user = userEvent.setup();
    render(<Harness groups={[4, 4]} characters="device" />);

    // 0, O, 1, I and L are left out so a code read off a screen cannot be
    // mistyped, so they cannot be typed either.
    await user.type(field(), "ab0cdO1efIgLh");
    expect(field().value).toBe("ABCDEFGH");
  });
});

describe("focus", () => {
  it("is not taken until a code is refused", () => {
    render(<Harness groups={[6]} characters="digits" />);
    expect(document.activeElement).not.toBe(field());
  });
});
