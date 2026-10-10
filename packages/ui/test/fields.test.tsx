import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { EmailInput } from "../src/fields/email-input.tsx";
import { SecretInput } from "../src/fields/secret-input.tsx";
import { TextInput } from "../src/fields/text-input.tsx";
import { CATALOGUES, translate } from "../src/i18n/catalogue.ts";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * The field kit's base (docs/design/guided-inputs.md §4.3, §4.4, §4.11).
 *
 * What the kit promises every field: a label, a description and an error
 * linked to the control (UIUX-PLAN §7), a format error shown when the person
 * leaves the field and never on the first keystroke, and the server's refusal
 * shown and announced beside the field it is about.
 */

const en = (key: string) => translate(CATALOGUES.en, key);

function inEnglish(children: ReactNode) {
  return render(
    <TranslationsProvider locale="en">{children}</TranslationsProvider>,
  );
}

describe("a text field", () => {
  it("is named by its label and described by its description", () => {
    inEnglish(
      <TextInput
        label="Workspace name"
        name="name"
        description="What everybody here will see."
      />,
    );

    const control = screen.getByLabelText("Workspace name");
    expect(control.tagName).toBe("INPUT");
    const described = (control.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain("What everybody here will see.");
  });

  it("shows the server's refusal, announced, and marks the field invalid", () => {
    inEnglish(
      <TextInput
        label="Workspace name"
        name="name"
        error="That name is taken."
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe("That name is taken.");
    expect(
      screen.getByLabelText("Workspace name").getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("waits until the person leaves the field to say what is wrong", async () => {
    const user = userEvent.setup();
    inEnglish(
      <TextInput
        label="Code word"
        name="word"
        check={(value) => (value.includes(" ") ? "One word, please." : null)}
      />,
    );
    const control = screen.getByLabelText("Code word");

    await user.type(control, "two words");
    expect(screen.queryByText("One word, please.")).toBeNull();
    // Held as the control's own validity already, so a form submitted from
    // the keyboard is stopped with the same sentence.
    expect((control as HTMLInputElement).validationMessage).toBe(
      "One word, please.",
    );

    await user.tab();
    expect(await screen.findByText("One word, please.")).not.toBeNull();
  });

  it("says how much of its limit is used once it is close", async () => {
    const user = userEvent.setup();
    inEnglish(<TextInput label="Title" name="title" maxLength={10} />);

    await user.type(screen.getByLabelText("Title"), "1234567");
    expect(screen.queryByText(/of 10 characters/)).toBeNull();
    await user.type(screen.getByLabelText("Title"), "8");
    expect(screen.getByText("8 of 10 characters")).not.toBeNull();
  });
});

describe("an email field", () => {
  it("refuses an address the server would, though the browser accepts it", async () => {
    const user = userEvent.setup();
    inEnglish(<EmailInput label="Email" name="email" />);

    await user.type(screen.getByLabelText("Email"), "priya@northwind");
    await user.tab();

    expect(await screen.findByText(en("fields.email.invalid"))).not.toBeNull();
  });

  it("accepts a whole address, and takes off the space a phone adds", async () => {
    const user = userEvent.setup();
    inEnglish(<EmailInput label="Email" name="email" />);
    const control = screen.getByLabelText("Email") as HTMLInputElement;

    await user.type(control, "priya@northwind.example ");
    await user.tab();

    expect(control.value).toBe("priya@northwind.example");
    expect(screen.queryByText(en("fields.email.invalid"))).toBeNull();
    expect(control.getAttribute("autocomplete")).toBe("email");
  });
});

describe("a secret field", () => {
  it("reveals what was typed with one toggle that keeps its name", async () => {
    const user = userEvent.setup();
    inEnglish(<SecretInput label="Password" name="password" />);
    const control = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", {
      name: en("fields.secret.showWhatYouTyped"),
    });

    expect(control.getAttribute("type")).toBe("password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await user.click(toggle);
    expect(control.getAttribute("type")).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe(
      en("fields.secret.showWhatYouTyped"),
    );
  });
});
