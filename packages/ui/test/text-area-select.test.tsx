import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { SelectInput } from "../src/fields/select-input.tsx";
import { TextArea } from "../src/fields/text-area.tsx";
import { TextInput } from "../src/fields/text-input.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * The plain prose box, the fixed-list dropdown, and a text field whose row
 * names it (docs/design/guided-inputs.md §4.3, §4.10): each labelled and
 * described the way every other field is.
 */

function inEnglish(children: ReactNode) {
  return render(
    <TranslationsProvider locale="en">
      <form>{children}</form>
    </TranslationsProvider>,
  );
}

const describedBy = (element: HTMLElement) =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" | ");

describe("a prose box", () => {
  it("is named, described, and grows rather than scrolling sideways", () => {
    inEnglish(
      <TextArea
        label="Why that decision"
        name="closeReason"
        description="Said once, read at the retrospective."
      />,
    );
    const box = screen.getByLabelText("Why that decision");
    expect(box.tagName).toBe("TEXTAREA");
    expect(box.className).toContain("[field-sizing:content]");
    expect(describedBy(box)).toContain("Said once, read at the retrospective.");
  });

  it("counts near the server's limit, and again from the start after a reset", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <TextArea label="Reason" name="reason" maxLength={10} />,
    );
    const box = screen.getByLabelText("Reason");
    await user.type(box, "abcdefg");
    expect(screen.queryByText(/of 10 characters/)).toBeNull();
    await user.type(box, "h");
    expect(screen.getByText("8 of 10 characters")).not.toBeNull();
    expect(describedBy(box)).toContain("8 of 10 characters");

    act(() => (container.querySelector("form") as HTMLFormElement).reset());
    expect(screen.queryByText(/of 10 characters/)).toBeNull();
  });

  it("shows the server's refusal, linked and announced", () => {
    inEnglish(
      <TextArea
        label="Reason"
        name="reason"
        error="Give at least 20 characters."
      />,
    );
    const box = screen.getByLabelText("Reason");
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe(
      "Give at least 20 characters.",
    );
    expect(describedBy(box)).toContain("Give at least 20 characters.");
  });
});

describe("a fixed-list dropdown", () => {
  it("stays the browser's own, named by its label even when the label is not drawn", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <SelectInput
        label="Outcome"
        hideLabel
        name="successStatus"
        defaultValue="achieved"
      >
        <option value="achieved">Achieved</option>
        <option value="missed">Missed</option>
      </SelectInput>,
    );
    const select = screen.getByRole("combobox", { name: "Outcome" });
    expect(select.tagName).toBe("SELECT");
    await user.selectOptions(select, "missed");
    expect(
      new FormData(container.querySelector("form") as HTMLFormElement).get(
        "successStatus",
      ),
    ).toBe("missed");
  });

  it("is described and refused the way a text field is", () => {
    inEnglish(
      <SelectInput
        label="Level"
        name="level"
        description="Where it sits in the tree."
        error="Choose a level this space can hold."
      >
        <option value="team">team</option>
      </SelectInput>,
    );
    const select = screen.getByRole("combobox", { name: "Level" });
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(select)).toBe(
      "Where it sits in the tree. | Choose a level this space can hold.",
    );
  });
});

describe("a text field inside a row", () => {
  it("is named by its label without drawing it", () => {
    inEnglish(<TextInput label="Key result title" hideLabel name="title" />);
    const box = screen.getByRole("textbox", { name: "Key result title" });
    expect(box).not.toBeNull();
    expect(screen.queryByText("Key result title")).toBeNull();
  });
});
