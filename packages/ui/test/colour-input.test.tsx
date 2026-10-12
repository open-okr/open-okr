import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ColourInput } from "../src/fields/colour-input.tsx";
import { CATALOGUES, translate } from "../src/i18n/catalogue.ts";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * A colour, picked or typed (docs/design/guided-inputs.md §4.11): the picker
 * and the box are one value, and the caller's rule speaks as a colour is
 * chosen rather than after Save.
 */

const en = (key: string) => translate(CATALOGUES.en, key);

function inEnglish(children: ReactNode) {
  return render(
    <TranslationsProvider locale="en">
      <form>{children}</form>
    </TranslationsProvider>,
  );
}

const posted = (container: HTMLElement) =>
  new FormData(container.querySelector("form") as HTMLFormElement).get(
    "primaryColor",
  );

const picker = (container: HTMLElement) =>
  container.querySelector('input[type="color"]') as HTMLInputElement;

const noGreen = (hex: string) =>
  hex === "#22c55e" ? `${hex} reads as green` : null;

describe("a colour field", () => {
  it("opens on the saved colour, in the box and the picker", () => {
    const { container } = inEnglish(
      <ColourInput
        label="Primary colour"
        name="primaryColor"
        defaultValue="#7C3AED"
      />,
    );
    expect(picker(container).getAttribute("aria-label")).toBe(
      translate(CATALOGUES.en, "fields.colour.pick", {
        label: "Primary colour",
      }),
    );
    expect(picker(container).value).toBe("#7c3aed");
    expect(posted(container)).toBe("#7C3AED");
  });

  it("fills the box with a picked colour, and moves the picker with six typed digits", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <ColourInput label="Primary colour" name="primaryColor" />,
    );
    fireEvent.input(picker(container), { target: { value: "#336699" } });
    expect(posted(container)).toBe("#336699");

    const box = screen.getByRole("textbox", { name: "Primary colour" });
    await user.clear(box);
    await user.type(box, "#7c3aed");
    expect(picker(container).value).toBe("#7c3aed");
  });

  it("refuses a colour by the caller's rule the moment it is picked", () => {
    const { container } = inEnglish(
      <ColourInput
        label="Primary colour"
        name="primaryColor"
        check={noGreen}
      />,
    );
    fireEvent.input(picker(container), { target: { value: "#22c55e" } });

    expect(screen.getByRole("alert").textContent).toBe(
      "#22c55e reads as green",
    );
    const box = screen.getByRole("textbox", {
      name: "Primary colour",
    }) as HTMLInputElement;
    expect(box.validity.valid).toBe(false);
  });

  it("marks a half-typed colour only once the person leaves it", async () => {
    const user = userEvent.setup();
    inEnglish(<ColourInput label="Primary colour" name="primaryColor" />);
    const box = screen.getByRole("textbox", {
      name: "Primary colour",
    }) as HTMLInputElement;

    await user.type(box, "#33669");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(box.validity.valid).toBe(false);
    await user.tab();
    expect(screen.getByRole("alert").textContent).toBe(
      en("fields.colour.sixHexDigits"),
    );
  });

  it("takes empty as an answer, and goes back to the saved colour on reset", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <ColourInput
        label="Primary colour"
        name="primaryColor"
        defaultValue="#7c3aed"
      />,
    );
    const box = screen.getByRole("textbox", {
      name: "Primary colour",
    }) as HTMLInputElement;
    await user.clear(box);
    await user.tab();
    expect(box.validity.valid).toBe(true);
    expect(posted(container)).toBe("");

    act(() => (container.querySelector("form") as HTMLFormElement).reset());
    expect(posted(container)).toBe("#7c3aed");
  });
});
